// verify.mjs — QA automática para 7H_* en Notion
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { Client } from '@notionhq/client';
import yaml from 'js-yaml';
import { parse } from 'csv-parse/sync';

const {
  NOTION_TOKEN,
  NOTION_PARENT_PAGE_ID,
  DB_PREFIX = '7H_',
} = process.env;

if (!NOTION_TOKEN || !NOTION_PARENT_PAGE_ID) {
  console.error('❌ Falta NOTION_TOKEN o NOTION_PARENT_PAGE_ID en .env');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const ROOT = process.cwd();
const CSV_DIR = path.join(ROOT, 'csv');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const MAPPING = yaml.load(fs.readFileSync(path.join(ROOT, 'docs', 'mapping.yml'), 'utf-8'));

// Mapa de claves manifest -> bloques de mapping.yml
const KEYMAP = {
  tasks_kanban: 'db_tasks_kanban',
  backburner: 'db_backburner',
  references: 'db_references',
  riesgos: 'db_riesgos',
  roles: 'db_roles',
  mission: 'db_mission',
  goals: 'db_goals',
  weekly_planner: 'db_weekly_planner',
  habits_tracker: 'db_habits_tracker',
};

const CSV_NAME = {
  tasks_kanban: 'db_tasks_kanban.csv',
  backburner: 'db_backburner.csv',
  references: 'db_references.csv',
  riesgos: 'db_riesgos.csv',
  roles: 'db_roles.csv',
  mission: 'db_mission.csv',
  goals: 'db_goals.csv',
  weekly_planner: 'db_weekly_planner.csv',
  habits_tracker: 'db_habits_tracker.csv',
};

function readCSVRows(fn) {
  const p = path.join(CSV_DIR, fn);
  if (!fs.existsSync(p)) return [];
  return parse(fs.readFileSync(p, 'utf-8'), { columns: true, skip_empty_lines: true });
}

async function allPages(database_id) {
  let cursor;
  const out = [];
  do {
    const page = await notion.databases.query({ database_id, start_cursor: cursor, page_size: 100 });
    out.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

function normType(t) {
  // Notion devuelve 'rich_text', 'select', 'multi_select', 'date', 'people', 'status', 'url', 'checkbox', 'number', etc.
  return t;
}

function expect(cond, okMsg, errMsg, issues) {
  if (cond) console.log('✅', okMsg);
  else { console.error('❌', errMsg); issues.push(errMsg); }
}

(async () => {
  const issues = [];
  const report = {};

  for (const [key, dbId] of Object.entries(MANIFEST)) {
    if (!dbId) continue;
    const mapKey = KEYMAP[key];
    const csvName = CSV_NAME[key];
    const cfg = MAPPING.databases[mapKey];
    if (!cfg) {
      console.warn(`⚠️ No hay mapping para ${key} (${dbId})`);
      continue;
    }

    // 1) Esquema de la DB vs mapping.yml
    const db = await notion.databases.retrieve({ database_id: dbId });
    const schema = db.properties || {};
    const wantTitle = cfg.title; // ej: "Título" o "Semana" o "Objetivo"
    const wantProps = cfg.properties || {};

    // Comprobar que existe una propiedad de Title con ese nombre
    // (En Notion el "Title" es una property con type 'title')
    const titleOk = Object.entries(schema).some(([propName, prop]) => prop.type === 'title' && propName === wantTitle);
    expect(titleOk, `[${key}] Title "${wantTitle}" OK`,
      `[${key}] Falta Title "${wantTitle}"`, issues);

    // Tipos esperados
    for (const [propName, expectedType] of Object.entries(wantProps)) {
      const s = schema[propName];
      expect(!!s, `[${key}] Prop "${propName}" existe`,
        `[${key}] Falta prop "${propName}"`, issues);
      if (s) {
        const got = normType(s.type);
        expect(got === expectedType,
          `[${key}] Prop "${propName}" tipo OK (${got})`,
          `[${key}] Prop "${propName}" tipo esperado "${expectedType}" pero Notion devolvió "${got}"`,
          issues
        );
      }
    }

    // 2) Conteos: filas CSV vs páginas en Notion
    const csvRows = readCSVRows(csvName);
    const pages = await allPages(dbId);
    report[key] = { csv: csvRows.length, notion: pages.length };
    expect(pages.length === csvRows.length,
      `[${key}] Conteo OK (CSV=${csvRows.length} vs Notion=${pages.length})`,
      `[${key}] Conteo NO coincide (CSV=${csvRows.length} vs Notion=${pages.length})`,
      issues
    );

    // 3) Relación "Proyecto ↔" (si aplica)
    const relationName = 'Proyecto ↔';
    const hasRelation = !!schema[relationName] && schema[relationName].type === 'relation';
    if (['tasks_kanban','backburner','references','riesgos','goals'].includes(key)) {
      expect(hasRelation,
        `[${key}] Relación "${relationName}" existe`,
        `[${key}] Falta relación "${relationName}"`, issues);

      if (hasRelation) {
        // Heurística: si en CSV hay "Proyecto" no vacío, deberíamos ver relación poblada
        const expectedLinked = csvRows.filter(r => (r['Proyecto']||'').trim()).length;
        // Cuenta cuántas páginas en Notion tienen alguna relación
        let gotLinked = 0;
        for (const p of pages) {
          const props = p.properties || {};
          const rel = props[relationName];
          if (rel && rel.type === 'relation' && (rel.relation||[]).length > 0) gotLinked++;
        }
        // Permitimos cierta tolerancia (p.ej. 0 si CSV no traía proyectos)
        const ok = expectedLinked === gotLinked;
        expect(ok,
          `[${key}] Backfill de relación OK (esperadas=${expectedLinked}, con relación=${gotLinked})`,
          `[${key}] Backfill relación parcial (esperadas=${expectedLinked}, con relación=${gotLinked})`,
          issues
        );
        report[key].relation = { expectedLinked, gotLinked };
      }
    }
  }

  fs.writeFileSync('verification_report.json', JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n— Resumen —');
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) {
    console.error('\n❌ Hallazgos:\n- ' + issues.join('\n- '));
    process.exit(2);
  } else {
    console.log('\n✅ Verificación OK: esquema, conteos y relaciones consistentes.');
  }
})().catch(e => { console.error(e); process.exit(1); });
