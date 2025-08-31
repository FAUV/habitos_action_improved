import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { Client } from '@notionhq/client';
import yaml from 'js-yaml';
import { parse } from 'csv-parse/sync';

const { NOTION_TOKEN } = process.env;
if (!NOTION_TOKEN) { console.error('Falta NOTION_TOKEN'); process.exit(1); }
const notion = new Client({ auth: NOTION_TOKEN });

const ROOT = process.cwd();
const CSV_DIR = path.join(ROOT, 'csv');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const MAPPING = yaml.load(fs.readFileSync(path.join(ROOT, 'docs', 'mapping.yml'), 'utf-8'));

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

function readCSV(fn) {
  const p = path.join(CSV_DIR, fn);
  if (!fs.existsSync(p)) return [];
  return parse(fs.readFileSync(p, 'utf-8'), { columns: true, skip_empty_lines: true });
}
function toCheckbox(v){ const s=String(v||'').trim().toLowerCase(); return ['1','true','si','sí','x','✓'].includes(s); }
function toMulti(v){ return String(v||'').split(/[,;|]/).map(s=>s.trim()).filter(Boolean).map(name=>({name})); }

function buildProps(cfg, row) {
  const props = {};
  props[cfg.title] = { title: [{ type:'text', text:{ content:String(row[cfg.title]||'') } }] };
  for (const [name, type] of Object.entries(cfg.properties||{})) {
    const val = row[name];
    if (val==null || String(val).trim()==='') continue;
    if (type==='select') props[name] = { select: { name: String(val) } };
    else if (type==='multi_select') props[name] = { multi_select: toMulti(val) };
    else if (type==='date') props[name] = { date: { start: String(val) } };
    else if (type==='rich_text') props[name] = { rich_text: [{ type:'text', text:{ content:String(val) } }] };
    else if (type==='url') props[name] = { url: String(val) };
    else if (type==='checkbox') props[name] = { checkbox: toCheckbox(val) };
    else if (type==='number') { const n = Number(val); if (!Number.isNaN(n)) props[name] = { number: n }; }
  }
  return props;
}

async function findByTitle(database_id, titleProp, titleText){
  const q = await notion.databases.query({
    database_id,
    page_size: 1,
    filter: { property: titleProp, title: { equals: String(titleText||'') } }
  });
  return q.results[0];
}

async function upsertRow(dbId, cfg, row){
  const titleText = String(row[cfg.title]||'').trim();
  if (!titleText) return;
  const props = buildProps(cfg, row);
  const exists = await findByTitle(dbId, cfg.title, titleText);
  if (exists) {
    await notion.pages.update({ page_id: exists.id, properties: props });
    console.log('update: ' + titleText);
  } else {
    await notion.pages.create({ parent:{ database_id: dbId }, properties: props });
    console.log('create: ' + titleText);
  }
}

(async ()=>{
  for (const [key, dbId] of Object.entries(MANIFEST)) {
    if (!dbId) continue;
    const mapKey = KEYMAP[key];
    const cfg = MAPPING.databases[mapKey];
    const csv = readCSV(CSV_NAME[key]);
    if (!cfg || csv.length===0) continue;
    console.log('['+key+'] upsert ' + csv.length + ' filas...');
    for (const row of csv) await upsertRow(dbId, cfg, row);
  }
  console.log('upsert_rows terminado');
})();
