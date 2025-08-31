// import.mjs — versión mejorada para la carga de bases de datos 7 Hábitos en Notion
// Esta versión agrega idempotencia básica: antes de crear una base de datos con el prefijo
// 7H_ comprueba si ya existe una con el mismo nombre. Si existe, no crea una nueva, sino
// reutiliza la existente. Esto evita duplicar bases si el script se ejecuta varias veces.
// Para forzar siempre la creación de una nueva base (por ejemplo en una migración limpia),
// defina la variable de entorno FORCE_CREATE_DB a "1".

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import * as yaml from 'js-yaml';
import 'dotenv/config';
import { Client } from '@notionhq/client';

const {
  NOTION_TOKEN,
  NOTION_PARENT_PAGE_ID,
  DB_PREFIX = '7H_',
  DRY_RUN,
  FORCE_CREATE_DB
} = process.env;

if (!NOTION_TOKEN || !NOTION_PARENT_PAGE_ID) {
  console.error('Falta NOTION_TOKEN o NOTION_PARENT_PAGE_ID en .env/Secrets');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const ROOT = process.cwd();
const CSV_DIR = path.join(ROOT, 'csv');
const DOCS_DIR = path.join(ROOT, 'docs');

// Cargar el mapeo de bases de datos y propiedades
let MAPPING = { databases: {} };
try {
  MAPPING = yaml.load(fs.readFileSync(path.join(DOCS_DIR, 'mapping.yml'), 'utf-8')) || { databases: {} };
} catch (_) {
  // Si no existe mapping.yml es opcional; se usarán valores por defecto
}

// Dormir unos milisegundos entre llamadas a la API para no saturar Notion
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Convertir un texto plano en el formato rich text que espera Notion para títulos
const titleRich = (text) => [{ type: 'text', text: { content: String(text) } }];

// Funciones para generar propiedades según el tipo
function toStatusProperty(valuesSet) {
  const base = [
    { name: 'Por hacer' },
    { name: 'En curso' },
    { name: 'Hecho' },
    { name: 'Bloqueado' },
  ];
  const extra = [...valuesSet]
    .filter(v => v && !base.find(o => o.name === v))
    .map(v => ({ name: v }));
  return { type: 'status', status: { options: [...base, ...extra] } };
}
const toSelectProperty = (valuesSet) =>
  ({ type: 'select', select: { options: [...valuesSet].filter(Boolean).map(v => ({ name: v })) } });

function toMultiSelectProperty(valuesSet) {
  const opts = new Set();
  for (const raw of valuesSet) {
    if (!raw) continue;
    String(raw).split(';').map(s => s.trim()).filter(Boolean).forEach(v => opts.add(v));
  }
  return { type: 'multi_select', multi_select: { options: [...opts].map(v => ({ name: v })) } };
}
const toCheckboxProperty = () => ({ type: 'checkbox', checkbox: {} });
const toURLProperty = () => ({ type: 'url', url: {} });
const toRichTextProperty = () => ({ type: 'rich_text', rich_text: {} });
const toNumberProperty = () => ({ type: 'number', number: { format: 'number' } });
const toPeopleProperty = () => ({ type: 'people', people: {} });
const toDateProperty = () => ({ type: 'date', date: {} });

// Obtener esquema de mapeo para una base de datos según su nombre (sin prefijo)
function getSchemaFor(dbKey) {
  const dbSpecs = MAPPING.databases || {};
  return {
    title: (dbSpecs[dbKey]?.title) || (dbSpecs[`db_${dbKey}`]?.title),
    properties: (dbSpecs[dbKey]?.properties) || (dbSpecs[`db_${dbKey}`]?.properties) || {}
  };
}

// Obtener el nombre de la columna que será título en la base de datos
function getTitleKey(schema) {
  return schema.title || 'Título';
}

// Inferir la propiedad de Notion según el tipo declarado en mapping.yml
function inferProperty(schema, key, columnValues) {
  const t = schema.properties?.[key];
  if (!t) return null;
  switch (t) {
    case 'select': return toSelectProperty(new Set(columnValues));
    case 'multi_select': return toMultiSelectProperty(columnValues);
    case 'checkbox': return toCheckboxProperty();
    case 'url': return toURLProperty();
    case 'rich_text': return toRichTextProperty();
    case 'number': return toNumberProperty();
    case 'people': return toPeopleProperty();
    case 'date': return toDateProperty();
    case 'status': return toStatusProperty(new Set(columnValues));
    default: return toRichTextProperty();
  }
}

// *** NUEVO ***: Busca una base de datos existente por nombre. Devuelve el objeto si existe o null.
async function findDatabaseByName(name) {
  const res = await notion.search({ query: name, filter: { property: 'object', value: 'database' } });
  const found = res.results.find(db => (db.title?.[0]?.plain_text || '') === name);
  return found || null;
}

// Crear una base de datos en Notion con esquema dado e inferir propiedades
async function createDatabase(dbKey, schema, dataset) {
  const titleKey = getTitleKey(schema);
  const properties = {};
  const columns = Object.keys(dataset[0] || {});
  for (const col of columns) {
    if (col === titleKey) continue;
    const values = dataset.map(r => r[col]).filter(v => v !== undefined);
    const prop = inferProperty(schema, col, values);
    if (prop) properties[col] = prop;
  }
  // Combinar fechas si existen para un campo "Fecha"
  if ('Fecha inicio' in properties || 'Fecha vencimiento' in properties) {
    properties['Fecha'] = toDateProperty();
    delete properties['Fecha inicio'];
    delete properties['Fecha vencimiento'];
  }

  const dbName = `${DB_PREFIX}${dbKey}`;
  // Si no se fuerza la creación y ya existe una DB con el mismo nombre, reutilizarla
  if (!FORCE_CREATE_DB) {
    const existing = await findDatabaseByName(dbName);
    if (existing) {
      console.log('La base de datos ya existe. Usando existente:', dbName, existing.id);
      return { id: existing.id, titleKey };
    }
  }

  const payload = {
    parent: { type: 'page_id', page_id: NOTION_PARENT_PAGE_ID },
    title: titleRich(dbName),
    properties: {
      [titleKey]: { type: 'title', title: {} },
      ...properties
    }
  };

  if (DRY_RUN) {
    console.log('[DRY] Crear DB:', dbName);
    return { id: `dry_${dbKey}`, titleKey };
  }

  const db = await notion.databases.create(payload);
  console.log('Creada DB', db.id, '→', db.title?.[0]?.plain_text);
  await sleep(200);
  return { ...db, titleKey };
}

// Normalizar valores checkbox a booleanos
function normalizeCheckbox(v) {
  if (v === true || v === 1 || v === '1') return true;
  const s = String(v || '').trim().toLowerCase();
  if (['true','sí','si','x','✓','check','ok','yes'].includes(s)) return true;
  return false;
}

function dateRangeFrom(row) {
  const start = (row['Fecha inicio'] || '').trim();
  const end = (row['Fecha vencimiento'] || '').trim();
  if (!start && !end) return null;
  return { start: start || end, end: end || undefined };
}

// Construir propiedades de página a partir de una fila del CSV
function buildPageProps(schema, row) {
  const titleKey = getTitleKey(schema);
  const props = {};
  for (const [key, val] of Object.entries(row)) {
    if (key === titleKey) continue;
    if (key === 'Fecha inicio' || key === 'Fecha vencimiento') continue;
    const t = schema.properties?.[key];
    if (!t) continue;
    switch (t) {
      case 'select':
        props[key] = { select: val ? { name: String(val) } : null }; break;
      case 'multi_select':
        props[key] = { multi_select: val ? String(val).split(';').map(s => ({ name: s.trim() })).filter(o => o.name) : [] }; break;
      case 'checkbox':
        props[key] = { checkbox: normalizeCheckbox(val) }; break;
      case 'url':
        props[key] = { url: val || null }; break;
      case 'rich_text':
        props[key] = { rich_text: val ? [{ type: 'text', text: { content: String(val).slice(0,2000) } }] : [] }; break;
      case 'number':
        props[key] = { number: val === '' || val === null || val === undefined ? null : Number(val) }; break;
      case 'people':
        props[key] = { people: [] }; break; // asignación de personas requiere IDs
      case 'date':
        props[key] = { date: val ? { start: String(val) } : null }; break;
      case 'status':
        props[key] = { status: val ? { name: String(val) } : null }; break;
      default:
        props[key] = { rich_text: val ? [{ type: 'text', text: { content: String(val) } }] : [] };
    }
  }
  const dr = dateRangeFrom(row);
  if (dr) props['Fecha'] = { date: dr };
  return props;
}

// Insertar todas las filas de un dataset en la base de datos
async function insertRows(db, dbKey, schema, dataset) {
  const titleKey = getTitleKey(schema);
  for (const row of dataset) {
    const titleVal = row[titleKey] || '(sin título)';
    const properties = buildPageProps(schema, row);
    const payload = {
      parent: { database_id: db.id },
      properties: {
        [titleKey]: { title: [{ type: 'text', text: { content: String(titleVal) } }] },
        ...properties
      }
    };
    if (DRY_RUN) {
      console.log(`[DRY] + fila → ${titleVal}`);
    } else {
      await notion.pages.create(payload);
      await sleep(120);
    }
  }
  console.log(`Importadas ${dataset.length} filas en ${dbKey}`);
}

// Función principal: recorre todos los CSV y crea las bases de datos e inserta los datos
async function main() {
  const manifest = {};
  if (!fs.existsSync(CSV_DIR)) {
    console.error('No existe la carpeta csv; cree una con los archivos db_*.csv');
    process.exit(1);
  }
  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
  for (const file of files) {
    const dbKey = file.replace(/^db_/, '').replace(/\.csv$/i, '');
    const csvPath = path.join(CSV_DIR, file);
    const dataset = parse(fs.readFileSync(csvPath, 'utf-8'), { columns: true, skip_empty_lines: true });
    const schema = getSchemaFor(dbKey);
    const db = await createDatabase(dbKey, schema, dataset);
    manifest[dbKey] = db.id;
    if (!DRY_RUN) await insertRows(db, dbKey, schema, dataset);
  }
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log('Manifest guardado en manifest.json');
}

main().catch(err => {
  console.error('Error:', err?.stack || err?.message || err);
  process.exit(1);
});