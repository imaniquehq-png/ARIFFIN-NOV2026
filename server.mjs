import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Readable} from 'node:stream';
import {api} from './src/api.mjs';
import {migrateLocalDatabase} from './src/local-migrations.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const store=process.env.AJ_DATA || path.join(root,'data');
await mkdir(path.join(store,'files'),{recursive:true});
const sql=new DatabaseSync(path.join(store,'operasi.sqlite'));
sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
await migrateLocalDatabase(sql,path.join(root,'drizzle'));
function statement(sqlText,values=[]){
  const stmt=sql.prepare(sqlText);
  return {bind:(...args)=>statement(sqlText,args),all:()=>({results:stmt.all(...values)}),first:()=>stmt.get(...values)||null,run:()=>({meta:stmt.run(...values)})};
}
const env={LOCAL:true,DB:{prepare:statement,batch(stmts){sql.exec('BEGIN IMMEDIATE');try{const result=stmts.map(s=>s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}},
  BUCKET:{async put(id,bytes){await writeFile(path.join(store,'files',id),new Uint8Array(bytes))},async get(id){try{return {body:await readFile(path.join(store,'files',id))}}catch{return null}},async delete(id){await unlink(path.join(store,'files',id))}}};
const media={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.pdf':'application/pdf','.md':'text/plain'};
const port=Number(process.env.AJ_PORT||4317);
const host=process.env.AJ_HOST||'127.0.0.1';
const server=http.createServer(async(req,res)=>{
  try{
    const base='http://'+req.headers.host;
    const url=new URL(req.url,base);let response;
    if(host==='127.0.0.1' && !['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)){
      res.writeHead(403);res.end('Nama hos tempatan tidak sah.');return;
    }
    if(url.pathname.startsWith('/api/')){
      const origin=process.env.AJ_ORIGIN||base;
      const request=new Request(origin+url.pathname+url.search,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      response=await api(request,env);
    }else{
      const pathname=decodeURIComponent(url.pathname);
      const isDomain=['/gold.mjs','/ledger.mjs','/events.mjs','/reconciliation.mjs'].includes(pathname);
      const dir=path.join(root,isDomain?'src':'public');
      const filename=path.resolve(dir,'.'+(pathname==='/'?'/index.html':pathname));
      if(!filename.startsWith(dir+path.sep))throw new Error('path');
      try{response=new Response(await readFile(filename),{headers:{'Content-Type':(media[path.extname(filename)]||'application/octet-stream')+(/\.(m?js|html|css)$/.test(filename)?'; charset=utf-8':''),'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}})}catch{response=new Response('Tidak dijumpai',{status:404})}
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){if(!res.headersSent)res.writeHead(400);res.end('Permintaan tidak sah.')}
});
server.on('error',e=>{console.error(e.message);process.exitCode=1;sql.close()});
server.listen(port,host,()=>console.log('Ariffin Jewels tersedia di http://'+host+':'+server.address().port));

