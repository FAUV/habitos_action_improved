import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { Client } from '@notionhq/client';
import { parse } from 'csv-parse/sync';
import yaml from 'js-yaml';

const { NOTION_TOKEN } = process.env;
if (!NOTION_TOKEN) { console.error('❌ Falta NOTION_TOKEN'); process.exit(1); }

const notion = new Client({ auth: NOTION_TOKEN });
const ROOT = process.cwd();
const CSV_DIR = path.join(ROOT, 'csv');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const MAPPING = yaml.load(fs.readFileSync(path.join(ROOT, 'docs', 'mapping.yml'), 'utf-8'));

function readCSVRows(fn) {
  const p = path.join(CSV_DIR, fn);
  if (!fs.existsSync(p)) return [];
  return parse(fs.readFileSync(p, 'utf-8'), { columns: true, skip_empty_lines: true });
}

async function allPages(database_id) {
  let cursor, out = [];
  do {
    const page = await notion.databases.query({ database_id, start_cursor: cursor, page_size: 100 });
    out.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

function getTitleFromPage(page, titlePropName) {
  const prop = page.properties?.[titlePropName];
  if (!prop || prop.type !== 'title') return '';
  return (prop.title?.map(x => x.plain_text).join('') || '').trim();
}

function normalizeTitle(s) {
  return String(s||'')
    .normalize('NFD').replace(/\p{Diacritic}/gu,'') // quita tildes
    .toLowerCase().replace(/\s+/g,' ').trim();
}

(async () => {
  const key = 'backburner';
  const dbId = MANIFEST[key];
  const cfg = MAPPING.databases['db_backburner'];
  const titleProp = cfg.title; // "Título"

  const csvRows = readCSVRows('db_backburner.csv');
  const allow = new Set(csvRows.map(r => normalizeTitle(r[titleProp])));

  const pages = await allPages(dbId);

  // agrupar páginas por título normalizado
  const groups = new Map();
  for (const p of pages) {
    const t = getTitleFromPage(p, titleProp);
    const n = normalizeTitle(t);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(p);
  }

  let archivedNotInCsv = 0;
  let archivedDupes = 0;

  for (const [normTitle, arr] of groups) {
    // vacíos: archivar todos
    if (!normTitle) {
      for (const p of arr) { await notion.pages.update({ page_id: p.id, archived: true }); archivedNotInCsv++; }
      continue;
    }

    if (!allow.has(normTitle)) {
      // títulos no listados en CSV -> archivar todos
      for (const p of arr) { await notion.pages.update({ page_id: p.id, archived: true }); archivedNotInCsv++; }
    } else if (arr.length > 1) {
      // duplicados con mismo título permitido -> conservar 1 y archivar el resto
      const sorted = arr.slice().sort((a,b) => {
        const la = new Date(a.last_edited_time).getTime();
        const lb = new Date(b.last_edited_time).getTime();
        // conservar la más reciente
        return lb - la;
      });
      const keep = sorted[0];
      for (const p of sorted.slice(1)) {
        await notion.pages.update({ page_id: p.id, archived: true });
        archivedDupes++;
      }
      console.log(`↻ keep "${getTitleFromPage(keep, titleProp)}" (${keep.id}) — archived ${sorted.length-1} dupes`);
    }
  }

  console.log(`🧹 backburner: archivadas ${archivedNotInCsv} fuera de CSV, ${archivedDupes} duplicados`);
})();
