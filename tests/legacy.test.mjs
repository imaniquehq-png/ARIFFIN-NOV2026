import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {api} from '../src/api.mjs';
import {migrateLocalDatabase} from '../src/local-migrations.mjs';

const migrations=fileURLToPath(new URL('../drizzle',import.meta.url));
const origin='https://operasi.example';
const source={id:'test-archive',title:'Sumber ujian',url:'https://docs.google.com/spreadsheets/d/test-archive/edit'};
const sheet={sheetId:0,title:'Tab ujian',role:'supplier',partner:'Pembekal ujian',headers:['Catatan',null,'Tarikh','Jumlah','Tarikh emas']};
const row={rowNo:8,kind:'both',values:['  keterangan  ','', '03/04/01','1,000.00','04/08/2001',null],
  formulas:{D:'=SUM(500,500)'},notes:{C:'Tarikh asal'},links:{A:'https://contoh.invalid/bukti'},rawValues:[null,null,36984,1000,37107]};
const example={source,sheet,rows:[row]};

async function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  await migrateLocalDatabase(db,migrations);
  function prepare(sql,values=[]){
    const q=db.prepare(sql);
    return {bind:(...a)=>prepare(sql,a),all:()=>({results:q.all(...values)}),first:()=>q.get(...values)||null,run:()=>({meta:q.run(...values)})};
  }
  const env={DB:{prepare,batch(stmts){
    db.exec('BEGIN');try{const out=stmts.map(s=>s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
  }}};
  const call=(route,payload,user='boss')=>api(new Request(origin+route,{method:payload===undefined?'GET':'POST',
    headers:{origin,...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@ujian.invalid'}:{})},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})}),env);
  assert.equal((await (await call('/api/session')).json()).user.role,'management');
  await call('/api/members',{role:'staff',name:'Pembantu ujian',email:'staff@ujian.invalid'});
  return {db,call};
}

test('lejar terhad kepada ahli dan direkodkan tanpa mengubah data operasi',async()=>{
  const {db,call}=await fixture();
  try {
    const anonymous=await (await call('/api/session',undefined,null)).json();
    assert.equal(Object.hasOwn(anonymous,'hasLegacy'),false);
    assert.equal((await call('/api/legacy',undefined,null)).status,401);
    assert.equal((await call('/api/legacy/import',example,'staff')).status,403);
    assert.equal((await call('/api/legacy/import',example,null)).status,401);
    const upload=await call('/api/legacy/import',example);
    assert.equal(upload.status,200);
    const first=await upload.json();
    assert.deepEqual([first.sheetId,first.inserted,first.unchanged,first.total],['0',1,0,1]);
    assert.match(first.batchDigest,/^[0-9a-f]{64}$/);
    assert.equal((await (await call('/api/session',undefined,'staff')).json()).hasLegacy,true);
    const archive=await (await call('/api/legacy',undefined,'staff')).json();
    assert.deepEqual(archive.sources,[source]);
    assert.deepEqual(archive.sheets,[{...sheet,sourceId:source.id,sheetId:'0'}]);
    assert.deepEqual(archive.rows,[{...row,sourceId:source.id,sheetId:'0'}]);
    const state=await (await call('/api/state',undefined,'staff')).json();
    assert.deepEqual(state.legacySummary,{rows:1,sheets:1,sources:1});
    assert.equal(state.state.purchases.length,0);
    assert.equal(state.version,0);
    const reversed=Object.fromEntries(Object.entries(row).reverse());
    const repeat=await (await call('/api/legacy/import',{...example,rows:[reversed]})).json();
    assert.deepEqual([repeat.inserted,repeat.unchanged,repeat.total,repeat.batchDigest],[0,1,1,first.batchDigest]);
  }finally{db.close();}
});

test('percanggahan menggulung balik seluruh kumpulan, koordinat sama pada tab lain dibenarkan',async()=>{
  const {db,call}=await fixture();
  try {
    await call('/api/legacy/import',example);
    const fresh={...row,rowNo:7};
    const modified={...row,notes:{C:'Catatan berbeza'}};
    const conflict=await call('/api/legacy/import',{...example,rows:[fresh,modified]});
    assert.equal(conflict.status,409);
    assert.deepEqual((await conflict.json()).conflict,{source:false,sheet:false,rows:[8]});
    const after=await (await call('/api/legacy')).json();
    assert.deepEqual(after.rows.map(r=>r.rowNo),[8]);
    assert.deepEqual(after.rows[0].notes,row.notes);
    const other=await call('/api/legacy/import',{...example,sheet:{...sheet,sheetId:'1'},rows:[modified]});
    assert.equal(other.status,200);
    const differentSource=await call('/api/legacy/import',{...example,source:{...source,title:'Tajuk baharu'},rows:[]});
    assert.equal(differentSource.status,409);
    assert.equal((await differentSource.json()).conflict.source,true);
    assert.equal((await call('/api/legacy/import',{...example,sheet:{...sheet,title:'Tab lain'},rows:[]})).status,409);
    assert.equal((await call('/api/legacy/import',{...example,rows:[row,row]})).status,400);
    assert.equal((await call('/api/legacy/import',{...example,rows:[{...row,sheetId:'99'}]})).status,400);
    const sixty=Array.from({length:60},(_,i)=>({...row,rowNo:i+100,kind:'calculation'}));
    const all=await (await call('/api/legacy/import',{...example,rows:sixty})).json();
    assert.equal(all.inserted,60);
    const retry=await (await call('/api/legacy/import',{...example,rows:sixty.reverse()})).json();
    assert.equal(retry.batchDigest,all.batchDigest);
    assert.equal(retry.unchanged,60);
    assert.equal((await call('/api/legacy/import',{...example,rows:[...sixty,fresh]})).status,400);
  }finally{db.close();}
});

test('migrasi setempat mengekalkan pangkalan data versi asal dan boleh diulang',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(await readFile(new URL('../drizzle/0000_operations.sql',import.meta.url),'utf8'));
    db.prepare('INSERT INTO aj_members(id,email,name,role) VALUES(?,?,?,?)').run('asal','asal@ujian.invalid','Pengurus','management');
    await migrateLocalDatabase(db,migrations);
    await migrateLocalDatabase(db,migrations);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM aj_members').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM aj_legacy_rows').get().n,0);
    assert.deepEqual(db.prepare('SELECT tag FROM aj_local_migrations ORDER BY tag').all().map(x=>x.tag),['0000_operations','0001_legacy_journals']);
  }finally{db.close();}
});

test('bacaan berhalaman menggunakan sempadan konsisten semasa import serentak', async()=>{
  const {db,call}=await fixture();
  try {
    for(let offset=0;offset<300;offset+=60) {
      const rows=Array.from({length:60},(_,i)=>({...row,rowNo:offset+i+2}));
      assert.equal((await call('/api/legacy/import',{...example,rows})).status,200);
    }
    const earlier=await call('/api/legacy');
    await call('/api/legacy/import',{...example,rows:[{...row,rowNo:500}]});
    const snapshot=await earlier.json();
    assert.equal(snapshot.rows.length,300);
    assert.equal(new Set(snapshot.rows.map(x=>x.rowNo)).size,300);
    assert.equal(snapshot.rows.at(-1).rowNo,301);
    assert.equal((await (await call('/api/legacy')).json()).rows.length,301);
  }finally{db.close();}
});
