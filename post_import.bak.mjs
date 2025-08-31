import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import 'dotenv/config';
import { Client } from '@notionhq/client';

const {
  NOTION_TOKEN,
  NOTION_PARENT_PAGE_ID,
  DB_PREFIX = '7H_',
  DRY_RUN
} = process.env;

if (!NOTION_TOKEN || !NOTION_PARENT_PAGE_ID) {
  console.error('Falta NOTION_TOKEN o NOTION_PARENT_PAGE_ID en .env');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const ROOT = process.cwd();
const CSV_DIR = path.join(ROOT, 'csv');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const readCSV = (p) => parse(fs.readFileSync(p, 'utf-8'), { columns: true, skip_empty_lines: true });

function title(text) { return [{ type:'text', text:{ content:String(text) } }] }

function getDistinctProjects() {
  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
  const set = new Set();
  for (const file of files) {
    const rows = readCSV(path.join(CSV_DIR, file));
    for (const r of rows) {
      if (r['Proyecto'] && String(r['Proyecto']).trim()) set.add(String(r['Proyecto']).trim());
    }
  }
  return [...set];
}

async function ensureProjectsDB() {
  const payload = {
    parent: { type:'page_id', page_id: NOTION_PARENT_PAGE_ID },
    title: title(`${DB_PREFIX}Proyectos`),
    properties: {
      'Nombre': { type:'title', title:{} },
      'Estado': { type:'select', select:{ options: [
        { name:'Activo' }, { name:'En pausa' }, { name:'Completado' }, { name:'Archivado' }
      ]}},
      'Área': { type:'select', select:{ options:[
        { name:'Furcelay' }, { name:'Abitae' }, { name:'Productividad' }, { name:'General' }
      ]}},
      'Dueño': { type:'people', people:{} },
      'Notas': { type:'rich_text', rich_text:{} },
    }
  };
  if (DRY_RUN) {
    console.log('[DRY] Crear DB Proyectos');
    return { id: 'dry_projects' };
  }
  const db = await notion.databases.create(payload);
  console.log('Creada DB Proyectos:', db.id);
  await sleep(200);
  return db;
}

async function createProjects(dbProjects, names) {
  const map = {};
  for (const name of names) {
    const payload = {
      parent: { database_id: dbProjects.id },
      properties: { 'Nombre': { title: title(name) } }
    };
    if (DRY_RUN) {
      console.log('[DRY] + Proyecto', name);
      map[name] = `dry_${name}`;
    } else {
      const page = await notion.pages.create(payload);
      map[name] = page.id;
      await sleep(150);
    }
  }
  return map;
}

async function addRelationToDB(dbId, relationName, projectsDbId) {
  if (DRY_RUN) {
    console.log(`[DRY] Añadir relación ${relationName} a ${dbId}`);
    return;
  }
  await notion.databases.update({
    database_id: dbId,
    properties: {
      [relationName]: { type:'relation', relation:{ database_id: projectsDbId } }
    }
  });
  console.log('Añadida relación en DB', dbId);
  await sleep(150);
}

async function allPages(database_id) {
  let cursor = undefined;
  const out = [];
  do {
    const page = await notion.databases.query({ database_id, start_cursor: cursor, page_size: 100 });
    out.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
    await sleep(100);
  } while (cursor);
  return out;
}

function getSelectName(prop) {
  if (!prop || prop.type !== 'select') return null;
  return prop.select?.name || null;
}

async function backfillRelations(dbId, relationName, projectsMap) {
  if (DRY_RUN) {
    console.log(`[DRY] Vincular páginas en ${dbId}`);
    return;
  }
  const pages = await allPages(dbId);
  for (const p of pages) {
    const props = p.properties || {};
    const projectName = getSelectName(props['Proyecto']) || null;
    const projId = projectName ? projectsMap[projectName] : null;
    if (!projId) continue;
    await notion.pages.update({
      page_id: p.id,
      properties: {
        [relationName]: { relation: [{ id: projId }] }
      }
    });
    await sleep(120);
  }
  console.log('Backfill relaciones OK en', dbId);
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('No existe manifest.json. Ejecuta primero "npm run import".');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const projectNames = getDistinctProjects();
  const dbProjects = await ensureProjectsDB();
  const projectsMap = await createProjects(dbProjects, projectNames);
  // Bases a las que se añadirá la relación Proyecto ↔
  const relationTargets = [
    { key:'tasks_kanban', relation:'Proyecto ↔' },
    { key:'backburner', relation:'Proyecto ↔' },
    { key:'references', relation:'Proyecto ↔' },
    { key:'riesgos', relation:'Proyecto ↔' },
    { key:'goals', relation:'Proyecto ↔' },
  ];
  for (const tgt of relationTargets) {
    const dbId = manifest[tgt.key];
    if (!dbId) { console.warn('No encontrado en manifest:', tgt.key); continue; }
    await addRelationToDB(dbId, tgt.relation, dbProjects.id);
    await backfillRelations(dbId, tgt.relation, projectsMap);
  }
  fs.writeFileSync(path.join(ROOT, 'projects_db.json'), JSON.stringify({ id: dbProjects.id, map: projectsMap }, null, 2), 'utf-8');
  console.log('Listo: relaciones y proyectos creados.');
}

main().catch(e => { console.error(e); process.exit(1); });