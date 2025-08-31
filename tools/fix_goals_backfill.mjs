import 'dotenv/config';
import fs from 'node:fs';
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const manifest = JSON.parse(fs.readFileSync('./manifest.json','utf8'));

const DB_GOALS = manifest.goals;
const DB_PROJECTS = manifest.projects; // lo acabamos de guardar en el paso 1

if (!DB_GOALS || !DB_PROJECTS) {
  throw new Error('Faltan IDs: asegúrate de que manifest.json tiene "goals" y "projects".');
}

// Descubre nombre del título en Proyectos (propiedad tipo 'title')
const projectsDb = await notion.databases.retrieve({ database_id: DB_PROJECTS });
const projectsTitleProp = Object.entries(projectsDb.properties).find(([,v]) => v.type === 'title')?.[0];
if (!projectsTitleProp) throw new Error('No se encontró propiedad de título en la DB de Proyectos.');

// Carga schema de Goals y localiza propiedades
const goalsDb = await notion.databases.retrieve({ database_id: DB_GOALS });

// Select "Proyecto" (el que viene del CSV)
const GOAL_SELECT_PROY = 'Proyecto';
if (!goalsDb.properties[GOAL_SELECT_PROY] || goalsDb.properties[GOAL_SELECT_PROY].type !== 'select') {
  throw new Error('En goals no existe select "Proyecto" o no es de tipo select.');
}

// Relación a Proyectos (detectamos la relación que apunta a DB_PROJECTS)
const goalsRelationProp =
  Object.entries(goalsDb.properties)
    .find(([,v]) => v.type === 'relation' && v.relation?.database_id === DB_PROJECTS)?.[0]
  ?? 'Proyecto ↔'; // fallback por nombre si coincide

if (!goalsDb.properties[goalsRelationProp] || goalsDb.properties[goalsRelationProp].type !== 'relation') {
  throw new Error('No se encontró la relación a Proyectos en goals.');
}

// Filtra goals que tengan select "Proyecto" lleno y la relación vacía
const filter = {
  and: [
    { property: GOAL_SELECT_PROY, select: { is_not_empty: true } },
    { property: goalsRelationProp, relation: { is_empty: true } }
  ]
};

let cursor, done = 0;
do {
  const q = await notion.databases.query({ database_id: DB_GOALS, start_cursor: cursor, filter });
  for (const page of q.results) {
    const projName = page.properties[GOAL_SELECT_PROY]?.select?.name;
    if (!projName) continue;

    // Busca o crea el proyecto por título
    const found = await notion.databases.query({
      database_id: DB_PROJECTS,
      filter: { property: projectsTitleProp, title: { equals: projName } }
    });
    let projPage = found.results[0];
    if (!projPage) {
      projPage = await notion.pages.create({
        parent: { database_id: DB_PROJECTS },
        properties: { [projectsTitleProp]: { title: [{ text: { content: projName } }] } }
      });
      console.log('➕ creado proyecto:', projName);
    }

    // Enlaza relación
    await notion.pages.update({
      page_id: page.id,
      properties: { [goalsRelationProp]: { relation: [{ id: projPage.id }] } }
    });
    done++;
    console.log('🔗 enlazado goal →', projName);
  }
  cursor = q.has_more ? q.next_cursor : undefined;
} while (cursor);

console.log('✔ Listo. Relaciones añadidas en goals:', done);
