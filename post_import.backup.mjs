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
const readCSV = (p) =>
  parse(fs.readFileSync(p, 'utf-8'), { columns: true, skip_empty_lines: true });

const text = (s) => [{ type: 'text', text: { content: String(s ?? '') } }];
const plainTitle = (prop) =>
  (prop?.title || [])
    .map(t => t?.plain_text || t?.text?.content || '')
    .join('')
    .trim();

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('No existe manifest.json. Ejecuta primero "npm run import".');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}
function saveManifest(obj) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(obj, null, 2), 'utf-8');
}

function getDistinctProjectsFromCSVs() {
  const files = fs.existsSync(CSV_DIR)
    ? fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'))
    : [];
  const set = new Set();
  for (const file of files) {
    const rows = readCSV(path.join(CSV_DIR, file));
    for (const r of rows) {
      const v = (r['Proyecto'] ?? '').trim();
      if (v) set.add(v);
    }
  }
  return [...set];
}

// --- DB Proyectos: encontrar o crear (evitando duplicados) ---
async function findProjectsDBByManifestOrSearch(manifest) {
  // 1) Si manifest ya tiene projects, lo validamos
  if (manifest.projects) {
    try {
      const db = await notion.databases.retrieve({ database_id: manifest.projects });
      return db;
    } catch {
      console.warn('El ID de projects en manifest no es accesible/valido. Se intentará buscar por título.');
    }
  }

  // 2) Buscar por título con search (evita crear duplicados)
  const expectedTitle = `${DB_PREFIX}Proyectos`;
  const res = await notion.search({
    query: expectedTitle,
    filter: { property: 'object', value: 'database' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' }
  });

  const candidates = (res?.results || [])
    .filter(d => d.object === 'database' && d?.title?.[0]?.plain_text === expectedTitle);

  if (candidates.length > 0) {
    if (candidates.length > 1) {
      console.warn(`⚠️ Hay ${candidates.length} DBs con el mismo nombre "${expectedTitle}". Se usará la más reciente y NO se crearán nuevas.`);
    }
    return candidates[0];
  }
  return null;
}

async function ensureProjectsDB(manifest) {
  const existing = await findProjectsDBByManifestOrSearch(manifest);
  if (existing) {
    console.log('Reutilizando DB Proyectos:', existing.id);
    return existing;
  }

  // 3) Crear solo si no existe
  const payload = {
    parent: { type: 'page_id', page_id: NOTION_PARENT_PAGE_ID },
    title: text(`${DB_PREFIX}Proyectos`),
    properties: {
      'Nombre': { type: 'title', title: {} },
      'Estado': {
        type: 'select',
        select: {
          options: [
            { name: 'Activo' },
            { name: 'En pausa' },
            { name: 'Completado' },
            { name: 'Archivado' }
          ]
        }
      },
      'Área': {
        type: 'select',
        select: {
          options: [
            { name: 'Furcelay' },
            { name: 'Abitae' },
            { name: 'Productividad' },
            { name: 'General' }
          ]
        }
      },
      'Dueño': { type: 'people', people: {} },
      'Notas': { type: 'rich_text', rich_text: {} }
    }
  };

  if (DRY_RUN) {
    console.log('[DRY] Crear DB Proyectos');
    return { id: 'dry_projects', title: [{ plain_text: `${DB_PREFIX}Proyectos` }] };
  }

  const db = await notion.databases.create(payload);
  console.log('Creada DB Proyectos:', db.id);
  await sleep(200);
  return db;
}

// --- Utilidades DB: leer y crear proyectos sin duplicar ---
async function allPages(database_id) {
  let cursor;
  const out = [];
  do {
    const page = await notion.databases.query({ database_id, start_cursor: cursor, page_size: 100 });
    out.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
    await sleep(100);
  } while (cursor);
  return out;
}

async function getExistingProjectsMap(dbProjectsId) {
  if (DRY_RUN) return {}; // En DRY no tenemos DB real
  const pages = await allPages(dbProjectsId);
  const map = {};
  for (const p of pages) {
    const name = plainTitle(p.properties?.['Nombre']);
    if (name) {
      // si hay duplicados en la DB, prioriza la más reciente
      if (!map[name] || new Date(p.last_edited_time) > new Date(map[name]._time)) {
        map[name] = { id: p.id, _time: p.last_edited_time };
      }
    }
  }
  // Devuelve solo id
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.id]));
}

async function findProjectByName(dbProjectsId, name) {
  // Filtro exacto por titulo "Nombre" == name
  const res = await notion.databases.query({
    database_id: dbProjectsId,
    filter: {
      property: 'Nombre',
      title: { equals: name }
    },
    page_size: 1
  });
  return res.results?.[0] || null;
}

async function createMissingProjects(dbProjects, names) {
  const map = await getExistingProjectsMap(dbProjects.id);
  for (const name of names) {
    if (!name) continue;
    if (map[name]) {
      console.log('· Ya existe proyecto:', name);
      continue;
    }
    if (DRY_RUN) {
      console.log('[DRY] + Proyecto', name);
      map[name] = `dry_${name}`;
    } else {
      // doble verificación previa a crear
      const exists = await findProjectByName(dbProjects.id, name);
      if (exists) {
        map[name] = exists.id;
        console.log('· (race) Encontrado existente:', name);
      } else {
        const page = await notion.pages.create({
          parent: { database_id: dbProjects.id },
          properties: { 'Nombre': { title: text(name) } }
        });
        map[name] = page.id;
        console.log('+ Proyecto creado:', name);
        await sleep(140);
      }
    }
  }
  return map;
}

// --- Añadir/ajustar relación "Proyecto ↔" en tablas destino ---
async function ensureRelationProperty(dbId, relationName, projectsDbId) {
  if (DRY_RUN) {
    console.log(`[DRY] Verificar/Añadir relación ${relationName} en ${dbId}`);
    return;
  }
  const schema = await notion.databases.retrieve({ database_id: dbId });
  const props = schema.properties || {};
  const current = props[relationName];

  // Si existe y ya apunta a la DB correcta → OK
  if (current?.type === 'relation' && current.relation?.database_id === projectsDbId) {
    return;
  }

  // Si existe pero apunta a otra DB → actualizar
  // Si no existe → crear
  await notion.databases.update({
    database_id: dbId,
    properties: {
      [relationName]: {
        type: 'relation',
        relation: { database_id: projectsDbId, single_property: {} }
      }
    }
  });
  console.log('Añadida/actualizada relación en DB', dbId);
  await sleep(150);
}

function getSelectName(prop) {
  if (!prop || prop.type !== 'select') return null;
  return prop.select?.name || null;
}

async function safeBackfillRelations(dbId, relationName, projectsMap) {
  if (DRY_RUN) {
    console.log(`[DRY] Backfill ${dbId}`);
    return;
  }
  const pages = await allPages(dbId);
  let linked = 0;

  for (const p of pages) {
    const props = p.properties || {};
    const currentRel = props?.[relationName]?.relation ?? [];
    if (Array.isArray(currentRel) && currentRel.length > 0) {
      // Ya tiene relación → no tocar
      continue;
    }
    // Intentamos leer el select "Proyecto" (según tu esquema verificado)
    const projectName =
      getSelectName(props['Proyecto']) ||
      getSelectName(props['project']) ||
      getSelectName(props['Project']) ||
      null;

    if (!projectName) continue;
    const projId = projectsMap[projectName];
    if (!projId) continue;

    await notion.pages.update({
      page_id: p.id,
      properties: { [relationName]: { relation: [{ id: projId }] } }
    });
    linked++;
    await sleep(110);
  }
  console.log(`Backfill relaciones OK en ${dbId} (vinculados: ${linked})`);
}

// --- Preflight anti-duplicados (avisos) ---
async function warnDuplicatedProjectTitles(dbProjectsId) {
  if (DRY_RUN || dbProjectsId === 'dry_projects') return;
  const pages = await allPages(dbProjectsId);
  const byName = new Map();
  for (const p of pages) {
    const name = plainTitle(p.properties?.['Nombre']);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(p.id);
  }
  const dups = [...byName.entries()].filter(([, ids]) => ids.length > 1);
  if (dups.length) {
    console.warn('⚠️ Detectados proyectos duplicados por título:');
    for (const [name, ids] of dups) console.warn('  ·', name, '=>', ids.join(', '));
    console.warn('No se crearon nuevos duplicados; revisa si deseas archivar los extra.');
  }
}

// --- main ---
async function main() {
  const manifest = loadManifest();

  // 1) Asegurar DB Proyectos sin duplicar
  const dbProjects = await ensureProjectsDB(manifest);

  // 2) Guardar/actualizar en manifest (si no estaba)
  if (manifest.projects !== dbProjects.id) {
    manifest.projects = dbProjects.id;
    saveManifest(manifest);
    console.log('✔ manifest.json actualizado con projects =', dbProjects.id);
  }

  // 3) Extraer proyectos de CSVs y crearlos solo si faltan
  const projectNames = getDistinctProjectsFromCSVs();
  const projectsMap = await createMissingProjects(dbProjects, projectNames);

  // 4) Aviso si en la DB hay duplicados por título
  await warnDuplicatedProjectTitles(dbProjects.id);

  // 5) Añadir/actualizar relación y hacer backfill seguro
  const relationTargets = [
    { key: 'tasks_kanban', relation: 'Proyecto ↔' },
    { key: 'backburner', relation: 'Proyecto ↔' },
    { key: 'references', relation: 'Proyecto ↔' },
    { key: 'riesgos', relation: 'Proyecto ↔' },
    { key: 'goals', relation: 'Proyecto ↔' },
  ];

  for (const tgt of relationTargets) {
    const dbId = manifest[tgt.key];
    if (!dbId) { console.warn('No encontrado en manifest:', tgt.key); continue; }

    await ensureRelationProperty(dbId, tgt.relation, dbProjects.id);
    await safeBackfillRelations(dbId, tgt.relation, projectsMap);
  }

  // 6) Persistir un snapshot opcional de la DB de Proyectos
  fs.writeFileSync(
    path.join(ROOT, 'projects_db.json'),
    JSON.stringify({ id: dbProjects.id, map: projectsMap }, null, 2),
    'utf-8'
  );

  console.log('Listo: relaciones y proyectos creados/sin duplicar, backfill aplicado.');
}

main().catch(e => { console.error(e); process.exit(1); });
