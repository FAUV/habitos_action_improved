// schema_sync.mjs — asegura que TODAS las props de mapping.yml existan en cada DB 7H_*

import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { Client } from '@notionhq/client';
import yaml from 'js-yaml';

const {
  NOTION_TOKEN,
  DB_PREFIX = '7H_',
} = process.env;

if (!NOTION_TOKEN) {
  console.error('❌ Falta NOTION_TOKEN en .env');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const ROOT = process.cwd();
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

// Crea schema Notion para el tipo indicado en mapping.yml
function propertySchemaOf(type) {
  switch (type) {
    case 'select':        return { select: {} };
    case 'multi_select':  return { multi_select: {} };
    case 'date':          return { date: {} };
    case 'checkbox':      return { checkbox: {} };
    case 'url':           return { url: {} };
    case 'rich_text':     return { rich_text: {} };
    case 'number':        return { number: { format: 'number' } };
    case 'people':        return { people: {} };
    // No creamos 'status' por API (Notion no acepta options en creación vía API).
    // Si mapping tuviera 'status', recomendamos usar 'select' (como ya hicimos).
    default:
      throw new Error(`Tipo de propiedad no soportado: ${type}`);
  }
}

async function ensureProps(database_id, cfg, key) {
  const db = await notion.databases.retrieve({ database_id });
  const schema = db.properties || {};
  const wantProps = cfg.properties || {};

  const toAdd = {};
  for (const [propName, expectedType] of Object.entries(wantProps)) {
    const exists = !!schema[propName];
    if (!exists) {
      toAdd[propName] = propertySchemaOf(expectedType);
    }
  }

  if (Object.keys(toAdd).length) {
    await notion.databases.update({
      database_id,
      properties: toAdd,
    });
    console.log(`🧩 [${key}] Añadidas props: ${Object.keys(toAdd).join(', ')}`);
  } else {
    console.log(`✅ [${key}] Esquema ya completo`);
  }
}

(async () => {
  for (const [key, dbId] of Object.entries(MANIFEST)) {
    if (!dbId) continue;
    const mapKey = KEYMAP[key];
    const cfg = MAPPING.databases[mapKey];
    if (!cfg) {
      console.warn(`⚠️ No hay mapping para ${key} (${dbId})`);
      continue;
    }
    await ensureProps(dbId, cfg, key);
  }
  console.log('✅ schema_sync terminado');
})().catch(e => { console.error(e); process.exit(1); });
