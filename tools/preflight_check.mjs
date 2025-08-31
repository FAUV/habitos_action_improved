import 'dotenv/config';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const manifest = JSON.parse(fs.readFileSync('./manifest.json','utf8'));

const DB_NAMES = ['7H_Proyectos','Proyectos']; // nombres típicos a vigilar
const AUTO_DEDUPE = process.env.AUTO_DEDUPE === '1';

function titleOf(db){ return (db.title??[]).map(t=>t.plain_text||'').join('').trim(); }
function uniqById(arr){ return Array.from(new Map(arr.map(x=>[x.id,x])).values()); }

async function searchDbsByQuery(query){
  const out=[]; let cursor;
  do{
    const res=await notion.search({
      query, filter:{property:'object', value:'database'},
      sort:{direction:'descending', timestamp:'last_edited_time'},
      start_cursor: cursor
    });
    out.push(...res.results.filter(x=>x.object==='database'));
    cursor=res.has_more?res.next_cursor:undefined;
  }while(cursor);
  return out;
}

async function allPages(database_id){
  const out=[]; let cursor;
  do{
    const q=await notion.databases.query({ database_id, start_cursor:cursor });
    out.push(...q.results);
    cursor=q.has_more? q.next_cursor: undefined;
  }while(cursor);
  return out;
}

async function duplicateTitlesReport(database_id){
  const db = await notion.databases.retrieve({ database_id });
  const titleProp = Object.entries(db.properties).find(([,v])=>v.type==='title')?.[0];
  if(!titleProp) return [];
  const pages = await allPages(database_id);
  const map = new Map();
  for(const p of pages){
    const t=(p.properties?.[titleProp]?.title??[]).map(b=>b.plain_text||'').join('').trim();
    if(!t) continue;
    map.set(t,(map.get(t)||[]).concat(p.id));
  }
  return Array.from(map.entries()).filter(([,ids])=>ids.length>1).map(([name,ids])=>({name,ids}));
}

async function checkProjectsDuplicates(){
  const canonicalId = manifest.projects;
  const hits = uniqById((await Promise.all(DB_NAMES.map(n=>searchDbsByQuery(n)))) .flat());
  const dups = hits.filter(h=>h.id!==canonicalId);

  if(dups.length){
    console.log('⚠️  Detectadas DBs "Proyectos" duplicadas:',
      dups.map(d=>`${titleOf(d)} ${d.id}`).join(', '));
    if(!AUTO_DEDUPE){
      console.log('❌ Preflight aborta para evitar más duplicados. '+
                  'Solución: ejecuta `node tools/repair_projects.mjs` o exporta AUTO_DEDUPE=1.');
      process.exit(2);
    }else{
      console.log('🧹 AUTO_DEDUPE=1 → llamando a dedupe/repair antes de continuar…');
      // si existe tools/repair_projects.mjs úsalo, si no, al menos ejecuta dedupe.mjs
      const tryRepair = fs.existsSync('./tools/repair_projects.mjs')
        ? spawnSync('node',['tools/repair_projects.mjs'],{stdio:'inherit'})
        : spawnSync('node',['dedupe.mjs'],{stdio:'inherit'});
      if(tryRepair.status!==0){
        console.log('❌ No se pudo reparar automáticamente. Abortando.');
        process.exit(3);
      }
    }
  }
}

async function checkPageDuplicatesEveryDb(){
  for (const [key, dbId] of Object.entries(manifest)){
    if(!dbId) continue;
    const dups = await duplicateTitlesReport(dbId);
    if(dups.length){
      console.log(`⚠️  ${key}: títulos duplicados detectados (${dups.length} grupos).`);
      dups.slice(0,10).forEach(g=>console.log('   ·', g.name, '→', g.ids.length, 'pzs'));
      if(!AUTO_DEDUPE){
        console.log('❌ Preflight aborta para evitar crear más duplicados. '+
                    'Ejecuta `node dedupe.mjs` o exporta AUTO_DEDUPE=1.');
        process.exit(4);
      }else{
        console.log('🧹 AUTO_DEDUPE=1 → ejecutando dedupe y revalidando…');
        const r=spawnSync('node',['dedupe.mjs'],{stdio:'inherit'});
        if(r.status!==0){ console.log('❌ dedupe falló. Abortando.'); process.exit(5); }
        const again = await duplicateTitlesReport(dbId);
        if(again.length){
          console.log('❌ Persisten duplicados tras dedupe. Abortando.');
          process.exit(6);
        }
      }
    }
  }
}

(async ()=>{
  if(!process.env.NOTION_TOKEN){
    console.log('❌ Falta NOTION_TOKEN en entorno.');
    process.exit(7);
  }
  if(!manifest || typeof manifest!=='object'){
    console.log('❌ No pude leer manifest.json.');
    process.exit(8);
  }

  // 1) duplicados de la DB Proyectos
  await checkProjectsDuplicates();

  // 2) duplicados de páginas por título en TODAS las DBs del manifest
  await checkPageDuplicatesEveryDb();

  console.log('✅ Preflight OK: sin duplicaciones peligrosas.');
})();
