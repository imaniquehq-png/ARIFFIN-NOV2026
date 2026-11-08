import { assertOk } from './events.mjs';
import { digest } from './security.mjs';

const rowKinds = new Set(['cash','gold','both','note','calculation']);
const prohibitedKeys = new Set(['__proto__','prototype','constructor']);
const sourceSQL = 'INSERT INTO aj_legacy_sources(id,hash,body,imported_by,imported_at) VALUES(?,?,?,?,?) ON CONFLICT(id,hash) DO NOTHING';
const sheetSQL = 'INSERT INTO aj_legacy_sheets(source_id,sheet_id,hash,body,imported_by,imported_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id,sheet_id,hash) DO NOTHING';
const rowSQL = 'INSERT INTO aj_legacy_rows(source_id,sheet_id,row_no,hash,body,imported_by,imported_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id,sheet_id,row_no,hash) DO NOTHING';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const validText = value => typeof value === 'string' && value.trim().length>0 && value.length<=1000;
const cells = (v,label) => assertOk(Array.isArray(v) && v.length<=256 && v.every(c=>c===null || typeof c==='string'),label+' mesti senarai teks atau sel kosong, sehingga 256 lajur.');

function sortedJson(v,depth=0) {
  assertOk(depth<=20,'Struktur metadata terlalu dalam.');
  if(Array.isArray(v))return v.map(child=>sortedJson(child,depth+1));
  if(object(v)) {
    return Object.fromEntries(Object.keys(v).sort().map(key=>{
      assertOk(!prohibitedKeys.has(key),'Nama medan metadata tidak sah.');
      return [key,sortedJson(v[key],depth+1)];
    }));
  }
  return v;
}
async function stored(v) {
  const body=JSON.stringify(sortedJson(v));
  assertOk(new TextEncoder().encode(body).length<=1800000,'Rekod melebihi saiz DB yang disokong.');
  return {body,hash:await digest(body)};
}
function normalized(input) {
  assertOk(object(input) && object(input.source) && object(input.sheet),'Butiran sumber dan helaian diperlukan.');
  const {source,sheet,rows}=input;
  assertOk(validId(source.id) && validText(source.title),'ID atau tajuk sumber tidak sah.');
  let url;
  if(typeof source.url==='string' && source.url.length<=4000) {
    try{url=new URL(source.url);}catch{}
  }
  assertOk(url?.protocol==='https:' && !url.username && !url.password,'Pautan sumber mesti menggunakan HTTPS.');
  const sheetId=String(sheet.sheetId??'');
  assertOk((typeof sheet.sheetId==='string' || Number.isSafeInteger(sheet.sheetId)) && validId(sheetId) && validText(sheet.title),'ID atau tajuk helaian tidak sah.');
  assertOk(sheet.sourceId===undefined || sheet.sourceId===source.id,'ID sumber helaian tidak sepadan.');
  assertOk(['supplier','refinery'].includes(sheet.role) && validText(sheet.partner),'Nyatakan jenis dan nama rakan niaga.');
  cells(sheet.headers,'Tajuk lajur');
  assertOk(Array.isArray(rows) && rows.length<=60,'Had setiap kumpulan ialah 60 baris.');
  const rowNos=new Set();
  const records=rows.map(row=>{
    assertOk(object(row) && Number.isSafeInteger(row.rowNo) && row.rowNo>0 && row.rowNo<=10000000,'Nombor baris sumber tidak sah.');
    assertOk(!rowNos.has(row.rowNo),'Baris '+row.rowNo+' disenaraikan dua kali.');
    rowNos.add(row.rowNo);
    assertOk(rowKinds.has(row.kind),'Kategori baris '+row.rowNo+' tidak sah.');
    assertOk((row.sourceId===undefined || row.sourceId===source.id) && (row.sheetId===undefined || String(row.sheetId)===sheetId),'Baris '+row.rowNo+' merujuk helaian yang berlainan.');
    cells(row.values,'Nilai baris '+row.rowNo);
    return {...row,sourceId:source.id,sheetId};
  }).sort((a,b)=>a.rowNo-b.rowNo);
  return {source,sheet:{...sheet,sourceId:source.id,sheetId},rows:records};
}

export async function legacySummary(db) {
  return await db.prepare('SELECT (SELECT COUNT(*) FROM aj_legacy_rows) AS rows, (SELECT COUNT(*) FROM aj_legacy_sheets) AS sheets, (SELECT COUNT(*) FROM aj_legacy_sources) AS sources').first();
}

export async function readLegacy(db) {
  // Only append operations are possible. Capture all three high-water marks together, then stream bounded pages.
  const limits=await db.prepare('SELECT (SELECT COALESCE(MAX(rowid),0) FROM aj_legacy_sources) AS sources,(SELECT COALESCE(MAX(rowid),0) FROM aj_legacy_sheets) AS sheets,(SELECT COALESCE(MAX(rowid),0) FROM aj_legacy_rows) AS rows').first();
  const entries=[['sources','aj_legacy_sources'],['sheets','aj_legacy_sheets'],['rows','aj_legacy_rows']];
  const encoder=new TextEncoder();
  async function* chunks() {
    yield '{';
    let seenTable=false;
    for(const [key,table] of entries) {
      yield (seenTable?',':'')+'"'+key+'":[';
      seenTable=true;
      let last=0;
      while(last<limits[key]){
        const sql='WITH sizes AS (SELECT rowid AS pos,length(CAST(body AS BLOB)) AS bytes FROM '+table+
          ' WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 256), budget AS (SELECT pos,bytes,SUM(bytes) OVER (ORDER BY pos) AS total FROM sizes) '+
          'SELECT rowid AS position,body FROM '+table+' WHERE rowid IN (SELECT pos FROM budget WHERE total-bytes<4000000) ORDER BY rowid';
        const result=await db.prepare(sql).bind(last,limits[key]).all();
        if(!result.results.length)break;
        for(const row of result.results){
          yield (last?',':'')+row.body;
          last=row.position;
        }
      }
      yield ']';
    }
    yield '}';
  }
  const it=chunks();
  const stream=new ReadableStream({
    async pull(controller) {
      const next=await it.next();
      if(next.done)controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel(){return it.return();}
  });
  return new Response(stream,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

export async function importLegacy(db,input,user) {
  assertOk(user?.role==='management','Hanya pengurusan boleh mengimport lejar sejarah.',403);
  const {source,sheet,rows}=normalized(input);
  const [src,tab,...items]=await Promise.all([source,sheet,...rows].map(stored));
  const stamp=new Date().toISOString();
  const statements=[
    db.prepare(sourceSQL).bind(source.id,src.hash,src.body,user.id,stamp),
    db.prepare(sheetSQL).bind(source.id,sheet.sheetId,tab.hash,tab.body,user.id,stamp),
    ...rows.map((r,i)=>db.prepare(rowSQL).bind(source.id,sheet.sheetId,r.rowNo,items[i].hash,items[i].body,user.id,stamp)),
  ];
  let result;
  try {
    // Exact fingerprints are idempotent. A different fingerprint at the same source coordinate hits
    // the primary key and rolls back this entire transaction, including any preceding new rows.
    result=await db.batch(statements);
  }catch(error){
    if(!/unique|constraint/i.test(String(error.message)))throw error;
    const foundSource=await db.prepare('SELECT hash FROM aj_legacy_sources WHERE id=?').bind(source.id).first();
    const foundSheet=await db.prepare('SELECT hash FROM aj_legacy_sheets WHERE source_id=? AND sheet_id=?').bind(source.id,sheet.sheetId).first();
    const existing=await db.prepare('SELECT row_no,hash FROM aj_legacy_rows WHERE source_id=? AND sheet_id=? AND row_no IN (SELECT value FROM json_each(?))')
      .bind(source.id,sheet.sheetId,JSON.stringify(rows.map(r=>r.rowNo))).all();
    const hashes=new Map(existing.results.map(r=>[r.row_no,r.hash]));
    const conflict={ source:!!foundSource && foundSource.hash!==src.hash,sheet:!!foundSheet && foundSheet.hash!==tab.hash,
      rows:rows.filter((r,i)=>hashes.has(r.rowNo) && hashes.get(r.rowNo)!==items[i].hash).map(r=>r.rowNo) };
    if(!conflict.source && !conflict.sheet && !conflict.rows.length)throw error;
    const at=[conflict.source?'butiran sumber':'',conflict.sheet?'butiran helaian':'',conflict.rows.length?'baris '+conflict.rows.join(', '):''].filter(Boolean).join(', ');
    throw Object.assign(new Error('Percanggahan pada '+at+'. Seluruh kumpulan dikekalkan seperti sebelum import.'),{status:409,legacyConflict:conflict});
  }
  const inserted=result.slice(2).reduce((sum,r)=>sum+Number(r.meta.changes),0);
  const count=await db.prepare('SELECT COUNT(*) AS n FROM aj_legacy_rows WHERE source_id=? AND sheet_id=?').bind(source.id,sheet.sheetId).first();
  const batchDigest=await digest(JSON.stringify([src.hash,tab.hash,...items.map(r=>r.hash)]));
  return {sourceId:source.id,sheetId:sheet.sheetId,inserted,unchanged:rows.length-inserted,total:count.n,batchDigest};
}
