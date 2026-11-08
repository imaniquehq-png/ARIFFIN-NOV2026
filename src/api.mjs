import {assertOk,applyNewEvents,materialize} from './events.mjs';
import {digest,passwordHash,fileType} from './security.mjs';
import {importLegacy,legacySummary,readLegacy} from './legacy.mjs';
import {needsOperationsImport,migrateOperations} from './import-operations.mjs';

const publicMember = u => ({id:u.id,name:u.name,email:u.email,role:u.role});
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const query=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const first=async(db,sql,...args)=>db.prepare(sql).bind(...args).first();
function validateEmail(e){assertOk(typeof e==='string' && e.length<=180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),'Masukkan alamat e-mel yang sah.');return e.trim().toLowerCase()}
function validateName(n){assertOk(typeof n==='string' && n.trim().length>=2 && n.length<=100,'Nama perlu mengandungi 2 hingga 100 aksara.');return n.trim()}
function validatePass(p){assertOk(typeof p==='string' && p.length>=12 && p.length<=256,'Gunakan kata laluan antara 12 hingga 256 aksara.');return p}
function tokenOf(req){return /(?:^|;\s*)aj_session=([a-zA-Z0-9-]+)/.exec(req.headers.get('cookie')||'')?.[1]||''}
async function loginSession(env,req,member){
  const token=crypto.randomUUID()+crypto.randomUUID();
  await env.DB.prepare('INSERT INTO aj_sessions VALUES(?,?,?)').bind(await digest(token),member.id,Date.now()+12*3600000).run();
  return json({ok:true},200,{'Set-Cookie':'aj_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200'+(new URL(req.url).protocol==='https:'?'; Secure':'')});
}
async function limitBody(req,max){
  assertOk(Number(req.headers.get('content-length')||0)<=max,'Fail atau permintaan terlalu besar.',413);
  const reader=req.body?.getReader();assertOk(reader,'Tiada data dihantar.');
  let size=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Object.assign(new Error('Saiz melebihi had.'),{status:413})}chunks.push(value)}
  const data=new Uint8Array(size);let pos=0;for(const c of chunks){data.set(c,pos);pos+=c.length}return data.buffer;
}
async function body(req){try{return JSON.parse(new TextDecoder().decode(await limitBody(req,2000000)))}catch(e){if(e.status)throw e;throw new Error('Format permintaan tidak sah.')}}
async function identity(req,env){
  if(env.LOCAL){
    const token=tokenOf(req);if(!token)return null;
    return first(env.DB,'SELECT m.* FROM aj_members m JOIN aj_sessions s ON s.member_id=m.id WHERE s.token=? AND s.expires>? AND m.active=1',await digest(token),Date.now());
  }
  const uid=req.headers.get('oai-authenticated-user-id');
  const email=req.headers.get('oai-authenticated-user-email')?.toLowerCase();
  if(!uid || !email)return null;
  const db=env.DB;const id='host-'+uid;
  // Owner-private hosting authenticates the initial workspace owner. Later accounts require an explicit member entry.
  const rawName=req.headers.get('oai-authenticated-user-full-name')||email.split('@')[0];
  let name=rawName;try{if(req.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')name=decodeURIComponent(rawName)}catch{}
  await db.prepare("INSERT OR IGNORE INTO aj_members(id,email,name,role) SELECT ?,?,?,'management' WHERE NOT EXISTS(SELECT 1 FROM aj_members)").bind(id,email,name.slice(0,100)).run();
  return first(db,'SELECT * FROM aj_members WHERE email=? AND active=1',email);
}
async function allEvents(db){return (await query(db,'SELECT body FROM aj_events ORDER BY seq')).map(r=>JSON.parse(r.body))}
async function allFiles(db){return Object.fromEntries((await query(db,'SELECT id,name,type,size FROM aj_files')).map(r=>[r.id,r]))}
async function perform(req,env,path,user) {
  const db=env.DB;
  const isPost=req.method==='POST';
  if(path==='/api/session' && !isPost)return json({user:user?publicMember(user):null,local:!!env.LOCAL,setup:!await first(db,'SELECT id FROM aj_members LIMIT 1'),
    ...(user?{hasLegacy:!!await first(db,'SELECT id FROM aj_legacy_sources LIMIT 1'),
      needsOperationsImport:user.role==='management' && await needsOperationsImport(db)}:{})});
  if(path==='/api/setup' && isPost && env.LOCAL){
    assertOk(!await first(db,'SELECT id FROM aj_members LIMIT 1'),'Akaun pengurusan telah disediakan.',409);
    const b=await body(req), email=validateEmail(b.email),name=validateName(b.name),pass=await passwordHash(validatePass(b.password));
    const id=crypto.randomUUID();const inserted=await db.prepare("INSERT INTO aj_members(id,email,name,role,password) SELECT ?,?,?,'management',? WHERE NOT EXISTS(SELECT 1 FROM aj_members)").bind(id,email,name,pass).run();
    assertOk(inserted.meta.changes===1,'Akaun pertama sudah didaftarkan.',409);
    return loginSession(env,req,{id});
  }
  if(path==='/api/login' && isPost && env.LOCAL){
    const b=await body(req),email=validateEmail(b.email),now=Date.now();
    const attempt=await first(db,'SELECT * FROM aj_attempts WHERE email=?',email);
    assertOk(!attempt || attempt.until_time<now || attempt.attempts<12,'Terlalu banyak cubaan. Cuba semula selepas 15 minit.',429);
    const member=await first(db,'SELECT * FROM aj_members WHERE email=? AND active=1',email);
    const hash=await passwordHash(String(b.password||'').slice(0,256),member?.password?.split('.')[0]||'aj-unavailable');
    if(!member?.password || hash!==member.password){
      await db.prepare('INSERT INTO aj_attempts VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET attempts=CASE WHEN until_time < ? THEN 1 ELSE attempts+1 END, until_time=CASE WHEN until_time < ? THEN excluded.until_time ELSE until_time END').bind(email,now+900000,now,now).run();
      throw Object.assign(new Error('E-mel atau kata laluan tidak sepadan.'),{status:401});
    }
    await db.prepare('DELETE FROM aj_attempts WHERE email=?').bind(email).run();
    return loginSession(env,req,member);
  }
  assertOk(user,'Log masuk dengan akaun yang mempunyai akses.',401);
  if(path==='/api/legacy/apply' && isPost){
    assertOk(user.role==='management','Akses pengurusan diperlukan.',403);
    const [events,files]=await Promise.all([allEvents(db),allFiles(db)]);
    return json(await migrateOperations(db,events,files,user));
  }
  if(path==='/api/legacy' && !isPost)return readLegacy(db);
  if(path==='/api/legacy/import' && isPost){
    assertOk(user.role==='management','Hanya pengurusan boleh mengimport lejar sejarah.',403);
    return json(await importLegacy(db,await body(req),user));
  }
  if(path==='/api/logout' && isPost && env.LOCAL){
    await db.prepare('DELETE FROM aj_sessions WHERE token=?').bind(await digest(tokenOf(req))).run();
    return json({ok:true},200,{'Set-Cookie':'aj_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
  }
  if(path==='/api/state' && !isPost){
    const [events,files,summary]=await Promise.all([allEvents(db),allFiles(db),legacySummary(db)]);
    const state=materialize(events,files);
    return json({state,version:events.at(-1)?.seq||0,files,legacySummary:summary});
  }
  if(path==='/api/act' && isPost){
    const b=await body(req);assertOk(typeof b.token==='string' && /^[a-z0-9-]{20,80}$/i.test(b.token),'Kunci transaksi tidak sah.');
    const token=user.id+'/'+b.token+'/';
    if(await first(db,'SELECT seq FROM aj_events WHERE token=?',token+'0'))return json({ok:true,repeated:true});
    const [events,files]=await Promise.all([allEvents(db),allFiles(db)]);
    assertOk(b.version===(events.at(-1)?.seq||0),'Rekod telah berubah. Data dimuat semula. Semak sebelum menyimpan lagi.',409);
    const adds=applyNewEvents(events,b.commands,user,files,new Date().toISOString());
    try{await db.batch(adds.map((e,i)=>db.prepare('INSERT INTO aj_events(seq,token,body) VALUES(?,?,?)').bind(e.seq,token+i,JSON.stringify(e))))}
    catch(e){if(/unique|constraint/i.test(e.message))throw Object.assign(new Error('Rekod baharu telah diterima. Semak semula sebelum menyimpan.'),{status:409});throw e}
    return json({ok:true,version:adds.at(-1).seq});
  }
  if(path==='/api/file' && isPost){
    const data=await limitBody(req,10*1024*1024),type=fileType(data);
    assertOk(type,'Muat naik JPG, PNG, WebP atau PDF yang sah.');
    const id='F-'+crypto.randomUUID(),name=decodeURIComponent(req.headers.get('x-file-name')||'Lampiran').replace(/[\x00-\x1F\x7F]/g,'').slice(0,200)||'Lampiran';
    await env.BUCKET.put(id,data);try{await db.prepare('INSERT INTO aj_files VALUES(?,?,?,?,?)').bind(id,name,type,data.byteLength,user.id).run()}catch(e){await env.BUCKET.delete(id);throw e}
    return json({id,name,type,size:data.byteLength});
  }
  if(path.startsWith('/api/file/') && !isPost){
    const id=decodeURIComponent(path.slice(10));const file=await first(db,'SELECT * FROM aj_files WHERE id=?',id);assertOk(file,'Fail tidak dijumpai.',404);
    const obj=await env.BUCKET.get(id);assertOk(obj,'Fail tidak tersedia.',404);
    return new Response(obj.body,{headers:{'Content-Type':file.type,'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(file.name),'Content-Security-Policy':"sandbox",'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
  }
  if(path==='/api/password' && isPost && env.LOCAL){
    const b=await body(req);assertOk(user.password===await passwordHash(String(b.old||''),user.password.split('.')[0]),'Kata laluan semasa tidak sepadan.');
    const pass=await passwordHash(validatePass(b.password));
    await db.batch([db.prepare('UPDATE aj_members SET password=? WHERE id=?').bind(pass,user.id),db.prepare('DELETE FROM aj_sessions WHERE member_id=?').bind(user.id)]);
    return loginSession(env,req,user);
  }
  if(path==='/api/members'){
    assertOk(user.role==='management','Hanya pengurusan boleh mengurus akses.',403);
    if(!isPost)return json({members:await query(db,'SELECT id,name,email,role,active FROM aj_members ORDER BY name'),history:await query(db,'SELECT * FROM aj_access_log ORDER BY stamp DESC LIMIT 100')});
    const b=await body(req),role=b.role;assertOk(['management','accountant','staff'].includes(role),'Peranan tidak sah.');
    const name=validateName(b.name);let id=b.id||crypto.randomUUID();
    let update;
    if(b.id){
      const other=await first(db,'SELECT * FROM aj_members WHERE id=?',id);
      assertOk(other,'Pengguna tidak dijumpai.');assertOk(b.active===true||b.active===false,'Status akses tidak sah.');
      assertOk(id!==user.id || (role==='management' && b.active),'Akaun pengurusan sendiri mesti kekal aktif.');
      update=db.prepare('UPDATE aj_members SET name=?,role=?,active=? WHERE id=?').bind(name,role,b.active?1:0,id);
    }else{
      const email=validateEmail(b.email);assertOk(!await first(db,'SELECT id FROM aj_members WHERE email=?',email),'E-mel telah didaftarkan.');
      update=db.prepare('INSERT INTO aj_members(id,email,name,role,password) VALUES(?,?,?,?,?)').bind(id,email,name,role,env.LOCAL?await passwordHash(validatePass(b.password)):null);
    }
    await db.batch([update,db.prepare('INSERT INTO aj_access_log VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),new Date().toISOString(),user.name,id,(b.id?'Kemas kini':'Tambah')+' '+name+' / '+role+' / '+(b.active===false?'nyahaktif':'aktif'))]);
    return json({ok:true});
  }
  throw Object.assign(new Error('Laluan tidak dijumpai.'),{status:404});
}
export async function api(req,env){
  try{
    const u=new URL(req.url);
    assertOk(['GET','POST'].includes(req.method),'Kaedah tidak disokong.',405);
    if(req.method==='POST')assertOk(req.headers.get('origin')===u.origin || (!req.headers.get('origin') && req.headers.get('x-aj-client')==='operasi'),'Sumber permintaan tidak sah.',403);
    const user=await identity(req,env);
    return await perform(req,env,u.pathname,user);
  }catch(e){
    const system=/SQLITE|D1_ERROR|no such table|TypeError|Cannot read properties/i.test(e.message);
    if(system)console.error('Ralat storan/API',e.message);
    return json({error:system?'Operasi storan gagal. Semak log pelayan.':e.message,...(e.legacyConflict?{conflict:e.legacyConflict}:{})},e.status||(system?500:400));
  }
}
