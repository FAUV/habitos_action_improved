#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@notionhq/client';
import YAML from 'js-yaml';

/**
 * Deduplica TODAS las DB del manifest:
 * - Agrupa por “clave natural” (título o fecha, según DB)
 * - Mantiene la última editada
 * - Archiva duplicados
 * - (Opcional) si está en Notion pero NO en CSV, también archiva
 */

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const ROOT = process.cwd();
const manifestPath = path.join(ROOT, 'manifest.json');
const mappingPath  = path.join(ROOT, 'docs', 'mapping.yml');

// --- utilidades CSV ---
function readCSV(fp) {
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const headers = lines[0].split(',').map(s => s.trim());
  const rows = lines.slice(1).map(line => {
    const cols = line.split(',').map(s => s.trim());
    const o = {};
    headers.forEach((h,i) => o[h] = cols[i] ?? '');
    return o;
  });
  return rows;
}

// --- lectura de archivos base ---
if (!fs.existsSync(manifestPath)) {
  console.error('❌ No existe manifest.json. Ejecuta primero: npm run dry o npm run import');
  process.exit(1);
}
const MANIFEST = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const MAPPING  = fs.existsSync(mappingPath) ? YAML.load(fs.readFileSync(mappingPath, 'utf8')) : {};

// relación clave: nombre archivo csv
const CSV_NAME = {
  backburner:      'csv/db_backburner.csv',
  goals:           'csv/db_goals.csv',
  habits_tracker:  'csv/db_habits_tracker.csv',
  mission:         'csv/db_mission.csv',
  references:      'csv/db_references.csv',
  riesgos:         'csv/db_riesgos.csv',
  roles:           'csv/db_roles.csv',
  tasks_kanban:    'csv/db_tasks_kanban.csv',
  weekly_planner:  'csv/db_weekly_planner.csv',
};

// Propiedad “título”/clave natural por DB
// (si existe mapping.yml se usará de ahí, si no, estos defaults)
const TITLE_PROP_DEFAULT = {
  backburner:     'Título',
  goals:          'Objetivo',
  habits_tracker: 'Fecha',         // clave por fecha
  mission:        'Declaración',
  references:     'Título',
  riesgos:        'Riesgo',
  roles:          'Rol',
  tasks_kanban:   'Título',
  weekly_planner: 'Semana',        // clave por fecha/semana
};

// Extrae el nombre de propiedad “título” desde mapping.yml si existe
function getTitlePropFromMapping(dbKey) {
  try {
    const cfg = MAPPING?.databases?.[dbKey];
    if (!cfg) return null;
    // El primer campo con tipo "title" en mapping.yml
    for (const [propName, propType] of Object.entries(cfg.properties || {})) {
      if (propType === 'title') return propName;
    }
  } catch {}
  return null;
}

function plainTextFromTitle(titleArr = []) {
  return titleArr.map(t => t.plain_text || '').join('').trim();
}

function getDateStr(d) {
  // normaliza a YYYY-MM-DD (solo fecha)
  if (!d) return '';
  if (d.start) d = d.start;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toISOString().slice(0,10);
}

function keyForPage(dbKey, page, titleProp) {
  const props = page.properties || {};
  const prop = props[titleProp];
  if (!prop) return '';

  if (prop.type === 'title') {
    return plainTextFromTitle(prop.title);
  }
  if (prop.type === 'date') {
    return getDateStr(prop.date);
  }
  if (prop.type === 'rich_text') {
    return (prop.rich_text?.[0]?.plain_text || '').trim();
  }
  if (prop.type === 'select') {
    return prop.select?.name || '';
  }
  // fallback: intentar title de página
  if (props['Name']?.type === 'title') {
    return plainTextFromTitle(props['Name'].title);
  }
  return '';
}

async function queryAll(dbId) {
  const results = [];
  let cursor = undefined;
  do {
    const r = await notion.databases.query({ database_id: dbId, start_cursor: cursor });
    results.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return results;
}

(async () => {
  // 1) build mapa de claves permitidas DESDE CSV (para archivar “fuera de CSV”)
  const allowByDb = {};
  for (const [dbKey, csvRelPath] of Object.entries(CSV_NAME)) {
    const csvPath = path.join(ROOT, csvRelPath);
    const rows = readCSV(csvPath);
    const titleFromMapping = getTitlePropFromMapping(dbKey);
    const titleProp = titleFromMapping || TITLE_PROP_DEFAULT[dbKey];

    const allow = new Set();
    for (const row of rows) {
      const v = row[titleProp] || row['Título'] || row['Objetivo'] || row['Fecha'] || row['Declaración'] || row['Semana'] || '';
      // normaliza fechas si corresponde
      if (['Fecha','Semana'].includes(titleProp)) {
        allow.add(getDateStr(v));
      } else {
        allow.add(String(v).trim());
      }
    }
    allowByDb[dbKey] = { allow, titleProp };
  }

  let totalArchivedOutside = 0;
  let totalArchivedDupes = 0;

  // 2) para cada DB del manifest, deduplicar y archivar fuera de CSV
  for (const [dbKey, dbId] of Object.entries(MANIFEST)) {
    if (!dbId) continue;
    if (!allowByDb[dbKey]) continue;

    const { allow, titleProp } = allowByDb[dbKey];
    const pages = await queryAll(dbId);

    // agrupar por clave natural
    const groups = new Map();
    for (const p of pages) {
      const k = keyForPage(dbKey, p, titleProp);
      const arr = groups.get(k) || [];
      arr.push(p);
      groups.set(k, arr);
    }

    let archivedOutside = 0;
    let archivedDupes = 0;

    // 2.1) archivar fuera de CSV
    for (const [k, arr] of groups.entries()) {
      const inCsv = k && allow.has(k);
      if (!inCsv && k !== '') {
        for (const p of arr) {
          await notion.pages.update({ page_id: p.id, archived: true });
          archivedOutside++;
        }
        groups.delete(k);
      }
    }

    // 2.2) dentro de cada grupo válido, conservar la última y archivar duplicados
    for (const [k, arr] of groups.entries()) {
      if (arr.length <= 1) continue;
      arr.sort((a,b) => new Date(b.last_edited_time) - new Date(a.last_edited_time));
      const keep = arr[0];
      for (const p of arr.slice(1)) {
        await notion.pages.update({ page_id: p.id, archived: true });
        archivedDupes++;
      }
      const titleText = keyForPage(dbKey, keep, titleProp) || '(sin título)';
      console.log(`↻ [${dbKey}] keep "${titleText}" (${keep.id}) — archived ${arr.length-1} dupes`);
    }

    totalArchivedOutside += archivedOutside;
    totalArchivedDupes   += archivedDupes;

    console.log(`🧹 ${dbKey}: archivadas ${archivedOutside} fuera de CSV, ${archivedDupes} duplicados`);
  }

  console.log(`✅ dedupe terminado. Totales → fuera de CSV: ${totalArchivedOutside}, duplicados: ${totalArchivedDupes}`);
})().catch(e => { console.error(e); process.exit(1); });
