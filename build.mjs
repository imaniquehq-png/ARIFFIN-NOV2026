import {cp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root,'dist');
const modules = new Map();
const symbols = name => '$module_' + name.replace(/[^a-zA-Z0-9_]/g,'_');

// Each local module runs in its own lexical scope. The deliberately small module
// format rejects unsupported imports/exports instead of leaving network imports in a Worker.
async function bundle(name, visiting = new Set()) {
  if (modules.has(name)) return;
  if (visiting.has(name)) throw new Error('Circular Worker dependency at ' + name);
  visiting.add(name);
  const contents = await readFile(path.join(root,'src',name),'utf8');
  const pattern = /^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([a-z0-9-]+\.mjs)['"];?\s*$/gm;
  for (const item of contents.matchAll(pattern)) await bundle(item[2], visiting);
  const bindings = [];
  const body = contents
    .replace(pattern, (whole,imports,dependency) => {
      if (!/^[A-Za-z0-9_,\s]+$/.test(imports)) throw new Error('Unsupported import in ' + name);
      return 'const {' + imports + '} = ' + symbols(dependency) + ';\n';
    })
    .replace(/^export\s+((?:async\s+)?function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (whole,declaration,key) => {
      bindings.push(key);
      return declaration + ' ' + key;
    });
  if (/^\s*(?:export|import)\s/m.test(body)) throw new Error('Unsupported Worker module declaration in ' + name);
  modules.set(name,'const '+symbols(name)+' = (() => {\n'+body+'\nreturn {'+bindings.join(',')+'};\n})();');
  visiting.delete(name);
}

const mime = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.md':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp',
  '.ico':'image/x-icon','.woff2':'font/woff2','.pdf':'application/pdf'
};
const assets = Object.create(null);
async function addAsset(filename, url) {
  const bytes=await readFile(filename);
  const type=mime[path.extname(filename)] || 'application/octet-stream';
  const text=type.startsWith('text/') || type.startsWith('application/json') || type==='image/svg+xml';
  if(Object.hasOwn(assets,url))throw new Error('Duplicate static path '+url);
  assets[url]={type,text,body:bytes.toString(text?'utf8':'base64'),etag:'"'+createHash('sha256').update(bytes).digest('hex').slice(0,32)+'"'};
}
async function staticDirectory(folder,prefix='') {
  for (const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    if (entry.name.startsWith('.')) continue;
    const name=path.join(folder,entry.name), url=prefix+'/'+entry.name;
    if(entry.isDirectory())await staticDirectory(name,url);
    else if(entry.isFile())await addAsset(name,url);
    else throw new Error('Unsupported public asset: '+name);
  }
}

await bundle('api.mjs');
await staticDirectory(path.join(root,'public'));
for(const name of ['ledger.mjs','gold.mjs','events.mjs','reconciliation.mjs']) await addAsset(path.join(root,'src',name),'/'+name);
if(!assets['/index.html'])throw new Error('Missing index.html');
const manifest=JSON.parse(await readFile(path.join(root,'.openai','hosting.json'),'utf8'));
if(!manifest.project_id || manifest.static || manifest.d1!=='DB' || manifest.r2!=='BUCKET')
  throw new Error('Hosting must declare the project ID and the DB and BUCKET bindings for a Worker.');
const entry=await readFile(path.join(root,'worker','entry.mjs'),'utf8');
const code=[...modules.values(),'const api = '+symbols('api.mjs')+'.api;',
  'const staticAssets = '+JSON.stringify(assets)+';',entry].join('\n');
await mkdir(path.join(output,'server'),{recursive:true});
await mkdir(path.join(output,'.openai'),{recursive:true});
await writeFile(path.join(output,'server','index.js'),code);
await cp(path.join(root,'.openai','hosting.json'),path.join(output,'.openai','hosting.json'));
await cp(path.join(root,'drizzle'),path.join(output,'.openai','drizzle'),{recursive:true});
console.log('Worker siap: '+Object.keys(assets).length+' aset, '+Buffer.byteLength(code)+' bait.');
