import {materialize} from './events.mjs';
import {importPartners,importFinance} from './import-ledger.mjs';
import {importGold} from './import-gold.mjs';

// For a private migration, set the source workbook ID and the expected row count per sheet.
const workbook = '';
const sourceRows = new Map();
const marker = 'native-import/'+workbook+'/0';

export async function needsOperationsImport(db) {
  if (!workbook || !sourceRows.size) return false;
  return !!await db.prepare('SELECT 1 AS needed FROM aj_legacy_sources WHERE id=? AND NOT EXISTS (SELECT 1 FROM aj_events WHERE token=?)').bind(workbook,marker).first();
}

export function nativeChanges(state,sheets) {
  const before = new Map();
  for(const [key,rows] of Object.entries(state)) {
    if(Array.isArray(rows)) before.set(key,new Map(rows.map(r=>[r.id,JSON.stringify(r)])));
  }
  const partners=importPartners(state,sheets);
  importGold(state,sheets,partners);
  importFinance(state,sheets,partners);
  const changes=[];
  for(const [key,rows] of Object.entries(state)) {
    if(!Array.isArray(rows) || ['audit','history','corrections'].includes(key))continue;
    const existing=before.get(key);
    const seen=new Set();
    for(const row of rows) {
      if(!row.id || seen.has(row.id))throw Error('Rujukan data berulang atau kosong: '+key+' '+row.id);
      seen.add(row.id);
      const encoded=JSON.stringify(row);
      const prior=existing?.get(row.id);
      if(prior===encoded)continue;
      if(prior){
        const previous=JSON.parse(prior);
        const patch=Object.fromEntries(Object.entries(row).filter(([k,v])=>k==='id'||JSON.stringify(previous[k])!==JSON.stringify(v)));
        changes.push({key,row:patch});
      }else changes.push({key,row});
    }
  }
  return changes;
}

export async function migrateOperations(db,events,files,user) {
  if(!await needsOperationsImport(db))return {saved:0};
  const {results:tabs}=await db.prepare('SELECT body FROM aj_legacy_sheets WHERE source_id=?').bind(workbook).all();
  const sheets=[];
  for(const {body} of tabs) {
    const sheet=JSON.parse(body), expected=sourceRows.get(String(sheet.sheetId));
    if(!expected)throw Error('Helaian sumber berubah. Semak salinan asal.');
    const {results}=await db.prepare('SELECT body FROM aj_legacy_rows WHERE source_id=? AND sheet_id=? ORDER BY row_no').bind(workbook,String(sheet.sheetId)).all();
    if(results.length!==expected)throw Error('Import sumber belum lengkap: '+sheet.title);
    sheets.push({sheet,rows:results.map(result=>JSON.parse(result.body))});
  }
  if(sheets.length!==sourceRows.size)throw Error('Import memerlukan semua helaian yang ditetapkan.');
  sheets.sort((a,b)=>[...sourceRows.keys()].indexOf(String(a.sheet.sheetId))-[...sourceRows.keys()].indexOf(String(b.sheet.sheetId)));
  const changes=nativeChanges(materialize(events,files),sheets);
  if(!changes.length)throw Error('Tiada rekod operasi dapat dipadankan.');
  const stamp=new Date().toISOString(), seq=events.at(-1)?.seq||0;
  const operator={id:user.id,name:user.name,role:user.role};
  // Commit the whole workbook together. A concurrent save or migration rolls back all batches.
  const statements=[];
  const batchSize=50;
  for(let start=0;start<changes.length;start+=batchSize){
    const index=statements.length;
    const event={seq:seq+index+1,now:stamp,user:operator,action:'sheet.records',
      data:{source:workbook,entries:changes.slice(start,start+batchSize)}};
    statements.push(db.prepare('INSERT INTO aj_events(seq,token,body) VALUES(?,?,?)')
      .bind(event.seq,'native-import/'+workbook+'/'+index,JSON.stringify(event)));
  }
  try {await db.batch(statements);}
  catch(e) {
    if(!await needsOperationsImport(db))return {saved:0};
    if(/unique|constraint/i.test(e.message))throw Object.assign(Error('Rekod telah berubah. Muat semula untuk menyelesaikan import.'),{status:409});
    throw e;
  }
  return {saved:changes.length};
}
