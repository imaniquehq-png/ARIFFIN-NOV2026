import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import '../build.mjs';

// Import from data: to prove the deployed Worker does not need source-tree imports.
const built=await readFile(new URL('../dist/server/index.js',import.meta.url));
const {default:worker}=await import('data:text/javascript;base64,'+built.toString('base64'));
const url='https://operasi.example';
const get=(path,env={},options={})=>worker.fetch(new Request(url+path,options),env);
test('Worker serves shell, complete static files and revocable cache validators',async()=>{
  const response=await get('/');
  assert.equal(response.status,200);
  assert.match(await response.text(),/<title>Ariffin Jewels/);
  const jpeg=await get('/bullion.jpg');
  assert.equal(jpeg.headers.get('content-type'),'image/jpeg');
  assert.deepEqual(Buffer.from(await jpeg.arrayBuffer()),await readFile(new URL('../public/bullion.jpg',import.meta.url)));
  assert.equal((await get('/bullion.jpg',{}, {headers:{'if-none-match':jpeg.headers.get('etag')}})).status,304);
  for(const route of ['/ledger.mjs','/gold.mjs','/events.mjs','/vendor/pdf-lib.esm.min.js'])
    assert.match((await get(route)).headers.get('content-type'),/javascript/);
  assert.equal((await get('/__proto__')).status,404);
  assert.equal((await get('/data/operasi.sqlite')).status,404);
  assert.equal((await get('/.openai/hosting.json')).status,404);
  assert.equal((await get('/index.html',{}, {method:'POST'})).status,405);
});

test('Hosted identity, migrated DB, attachment, write and replay work in the bundled module',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    const schema=new URL('../dist/.openai/drizzle/',import.meta.url);
    const {entries}=JSON.parse(await readFile(new URL('meta/_journal.json',schema),'utf8'));
    for(const entry of entries)db.exec(await readFile(new URL(entry.tag+'.sql',schema),'utf8'));
    function prepare(sql,binds=[]) {
      const st=db.prepare(sql);
      return {bind:(...args)=>prepare(sql,args),all:()=>({results:st.all(...binds)}),first:()=>st.get(...binds)||null,run:()=>({meta:st.run(...binds)})};
    }
    const objects=new Map();
    const env={DB:{prepare,batch(stmts){db.exec('BEGIN');try{const rs=stmts.map(s=>s.run());db.exec('COMMIT');return rs;}catch(e){db.exec('ROLLBACK');throw e;}}},
      BUCKET:{put:(id,bytes)=>objects.set(id,new Uint8Array(bytes)),get:id=>({body:objects.get(id)}),delete:id=>objects.delete(id)}};
    const headers={'oai-authenticated-user-id':'member1','oai-authenticated-user-email':'test@example.test',origin:url};
    assert.equal((await get('/api/state',env)).status,401);
    const session=await (await get('/api/session',env,{headers})).json();
    assert.equal(session.user.role,'management');
    const b={version:0,token:'test-worker-event-token-000001',commands:[
      {action:'agent.create',data:{name:'Ejen ujian',code:'TEST',method:'WeBuy',bank:'Bank ujian',account:'01234'}}
    ]};
    const write=()=>get('/api/act',env,{method:'POST',headers,body:JSON.stringify(b)});
    assert.equal((await write()).status,200);
    assert.equal((await (await write()).json()).repeated,true);
    const read=await (await get('/api/state',env,{headers})).json();
    assert.equal(read.state.agents.length,1);
    assert.equal(read.version,1);
    const pdf='%PDF-1.4\n%%EOF';
    const file=await (await get('/api/file',env,{method:'POST',headers:{...headers,'x-file-name':'ujian.pdf'},body:pdf})).json();
    assert.ok(file.id);
    assert.equal(await (await get('/api/file/'+file.id,env,{headers})).text(),pdf);
    const stranger={...headers,'oai-authenticated-user-id':'member2','oai-authenticated-user-email':'asing@example.test'};
    assert.equal((await get('/api/state',env,{headers:stranger})).status,401);
  }finally{db.close();}
});
