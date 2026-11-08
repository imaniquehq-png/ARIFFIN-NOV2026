import {registerFinance} from './finance.js';
import {registerGold} from './gold.js';
import {registerReports} from './reports.js';
import {registerControl} from './control.js';
import {registerReconcile} from './reconcile.js';
import {registerDashboard} from './dashboard.js';
import {demoWorkspace,demoUser} from './demo.js';
import {materialize,applyNewEvents} from './events.mjs';
import {icon} from './icons.js';

const groups=[
 ['Ruang kerja',[['dashboard','Ringkasan','dashboard'],['requests','Permohonan dana','wallet'],['sales','Jualan & bayaran','sales']]],
 ['Operasi emas',[['purchases','Pembelian emas','gold'],['locks','MKS Lock','lock'],['processing','Proses tarik','process'],['deliveries','Penerimaan emas','box'],['shipments','Penghantaran kilang','truck'],['assays','Keputusan assay','assay']]],
 ['Pengurusan',[['agents','Ejen & pembekal','users'],['refineries','Kilang','factory'],['reports','Laporan','chart'],['documents','Dokumen PDF','file'],['einvoices','e-Invois','sales'],['import','Import data','upload'],['audit','Jejak audit','history'],['settings','Tetapan & akses','settings']]]
];
const routes=Object.fromEntries(groups.flatMap(([group,rows])=>rows.map(([key,name,glyph])=>[key,{group,name,glyph}])));
const pages=new Map(),events=new Map(),dlg=document.querySelector('#dialog');
let state,version=0,files={},legacySummary=null,session={},demo,training=false,route='dashboard',params={},actionSeq=0,lastFocus,toastTimer;
const euroles={management:'Pengurusan',accountant:'Akauntan',staff:'Staf'};
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fm=(n,places)=>Number(n||0).toLocaleString('en-MY',{minimumFractionDigits:places,maximumFractionDigits:places});
const actId=fn=>{const id='b'+(++actionSeq);events.set(id,fn);return id};
const button=(label,fn,style='secondary')=>'<button type="button" class="btn '+esc(style)+'" data-action="'+actId(fn)+'">'+esc(label)+'</button>';
const glyphButton=(text,fn,glyph,style='secondary')=>'<button type="button" class="btn '+esc(style)+'" data-action="'+actId(fn)+'">'+icon(glyph,17)+esc(text)+'</button>';
const link=(label,fn)=>'<button type="button" class="text-link" data-action="'+actId(fn)+'">'+esc(label)+'</button>';
const toast=(message,error=false)=>{const el=document.querySelector('#toast');el.textContent=message;el.className='visible'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',4500)};
async function api(path,data){
  const r=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','x-aj-client':'operasi'},body:JSON.stringify(data)});
  let out;try{out=await r.json()}catch{throw new Error('Pelayan tidak dapat dihubungi. Cuba semula.')}
  if(!r.ok)throw Object.assign(new Error(out.error||'Permintaan gagal.'),{status:r.status});return out;
}
async function refresh(){
  if(training){state=demo.state;files=demo.files;version=demo.events.length;legacySummary=null}
  else {const out=await api('/api/state');({state,version,files}=out);legacySummary=out.legacySummary||null}
  state.files=files;
}
function fileUrl(id){return training?(id==='gambar-contoh'?'/bullion.jpg':id==='dokumen-contoh'?'/contoh.pdf':files[id]?.url||''):'/api/file/'+encodeURIComponent(id)}
async function upload(file){
  if(!(file instanceof File) || !file.size)throw new Error('Pilih fail terlebih dahulu.');
  if(file.size>10*1024*1024)throw new Error('Had setiap fail ialah 10 MB.');
  let item;
  if(training){
    if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Pilih JPG, PNG, WebP atau PDF.');
    item={id:'F-'+crypto.randomUUID(),name:file.name,type:file.type,size:file.size,url:URL.createObjectURL(file)};
  }else{
    const r=await fetch('/api/file',{method:'POST',headers:{'x-aj-client':'operasi','x-file-name':encodeURIComponent(file.name)},body:file});
    item=await r.json();if(!r.ok)throw new Error(item.error);
  }
  files[item.id]=item;return item.id;
}
let retry;
async function batch(commands){
  if(training){const additions=applyNewEvents(demo.events,commands,demoUser,files,new Date().toISOString());demo.events.push(...additions);demo.state=materialize(demo.events,files)}
  else {
    const key=JSON.stringify([version,commands]);if(retry?.key!==key)retry={key,token:crypto.randomUUID()};
    try{await api('/api/act',{version,commands,token:retry.token});retry=null}catch(e){if(e.status===409){await refresh();retry=null}throw e}
  }
  await refresh();
}
function close(){if(dlg.open)dlg.close()}
function dialog(title,html){
  if(!dlg.open)lastFocus=document.activeElement;
  dlg.innerHTML='<div class="modal-head"><h2 id="modal-title">'+esc(title)+'</h2><button class="icon-btn" data-close aria-label="Tutup">'+icon('x')+'</button></div><div class="modal-body">'+html+'</div>';
  dlg.setAttribute('aria-labelledby','modal-title');if(!dlg.open)dlg.showModal();
}
dlg.addEventListener('close',()=>{if(lastFocus?.isConnected)lastFocus.focus()});
dlg.addEventListener('click',e=>{if(e.target.closest('[data-close]') || e.target===dlg)close()});
function fieldMarkup(f){
  const key=esc(f.key),val=esc(f.value??''),type=f.type||'text';
  const attrs=' name="'+key+'" id="fld-'+key+'" '+(f.required?'required ':'')+['step','min','max','accept','placeholder','autocomplete','maxlength'].filter(k=>f[k]!=null).map(k=>k+'="'+esc(f[k])+'"').join(' ');
  const opts=(f.options||[]).map(o=>typeof o==='object'?o:{label:o,value:o});
  let input;
  if(type==='select')input='<select'+attrs+(f.multiple?' multiple':'')+'>'+(!f.value?'<option value="">Pilih…</option>':'')+opts.map(o=>'<option value="'+esc(o.value)+'" '+(String(o.value)===String(f.value)?'selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select>';
  else if(type==='textarea')input='<textarea'+attrs+' rows="3">'+val+'</textarea>';
  else if(type==='checkbox')return '<label class="check-field"><input type="checkbox"'+attrs+(f.value?' checked':'')+'>'+esc(f.label)+'</label>';
  else input='<input type="'+esc(type)+'"'+attrs+(type==='file'?(f.multiple?' multiple':''):' value="'+val+'"')+'>';
  return '<div class="field"><label for="fld-'+key+'">'+esc(f.label)+(f.required?' <i aria-hidden="true">*</i>':'')+'</label>'+input+(f.help?'<small>'+esc(f.help)+'</small>':'')+'</div>';
}
function form({title,description,fields,onSubmit,submitLabel='Simpan',accountForm=false}){
  dialog(title,'<form class="entry-form">'+(description?'<p class="form-intro">'+esc(description)+'</p>':'')+'<div class="form-fields">'+fields.map(fieldMarkup).join('')+'</div><div class="form-error" role="alert" hidden></div><div class="form-foot"><button type="button" class="btn secondary" data-close>Batal</button><button type="submit" class="btn primary">'+esc(submitLabel)+'</button></div></form>');
  const el=dlg.querySelector('form');el.addEventListener('submit',async e=>{
    e.preventDefault();if(el.dataset.busy)return;el.dataset.busy='1';
    const save=el.querySelector('[type=submit]'),err=el.querySelector('.form-error');save.disabled=true;save.textContent='Menyimpan…';err.hidden=true;
    try{
      const values={};for(const f of fields){const field=el.elements.namedItem(f.key);
        if(f.type==='file'){if(field.files.length){const ids=[];for(const file of field.files)ids.push(await upload(file));values[f.key]=f.multiple?ids:ids[0]}else values[f.key]=f.value||''}
        else if(f.type==='checkbox')values[f.key]=field.checked;
        else if(f.type==='select' && f.multiple) values[f.key]=Array.from(field.selectedOptions,o=>o.value);
        else values[f.key]=field.value.trim();
      }
      await onSubmit(values);if(el.isConnected){close();render();toast('Rekod disimpan.')}
    }catch(ex){err.textContent=ex.message;err.hidden=false;err.scrollIntoView({block:'nearest'})}
    finally{delete el.dataset.busy;save.disabled=false;save.textContent=submitLabel}
  });
  if(training && !accountForm){
    const note=document.createElement('p');note.className='training-notice';note.textContent='Latihan sesi ini. Rekod contoh dipadam apabila halaman dimuat semula.';
    el.prepend(note);
  }
}
function table(heads,rows){return '<div class="table-scroll"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+String(cell??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function show({title,subtitle,actions,body}){
  const main=document.querySelector('#main');
  main.innerHTML='<div class="page-title"><div><h1>'+esc(title)+'</h1>'+(subtitle?'<p>'+esc(subtitle)+'</p>':'')+'</div><div class="actions">'+(actions||'')+'</div></div>'+body;
  document.title=title+' · Ariffin Jewels';
}
function go(key,p={}){
  if(!pages.has(key))return;
  close();document.body.classList.remove('nav-open');
  const q=new URLSearchParams(Object.entries(p).filter(([,v])=>v!==undefined));
  const hash='#'+key+(q.size?'?'+q:'');if(location.hash!==hash)history.pushState(null,'',hash);
  route=key;params={...p};render();window.scrollTo({top:0});
}
function readRoute(){
  const [k,q]=location.hash.slice(1).split('?');
  if(k==='legacy'||(k==='reports'&&/^history(?:-|$)/.test(new URLSearchParams(q).get('type')||''))){
    route='dashboard';params={};
    history.replaceState(null,'','#dashboard');return;
  }
  route=pages.has(k)?k:'dashboard';params=Object.fromEntries(new URLSearchParams(q));if(params.new)params.new=params.new==='true';
}
function quick(){
  dialog('Rekod baharu','<div class="quick-list">'+[['requests','Permohonan dana','wallet'],['purchases','Pembelian emas','gold'],['deliveries','Penghantaran ke Ariffin','box'],['shipments','Penghantaran ke kilang','truck'],['sales','Invois jualan','sales'],['agents','Ejen baharu','users']].map(([key,label,glyph])=>'<button data-action="'+actId(()=>go(key,{new:true}))+'"><span class="icon-tile mint">'+icon(glyph)+'</span>'+esc(label)+icon('right',16)+'</button>').join('')+'</div>');
}
function search(){
  dialog('Cari rekod','<label class="sr" for="search-input">Rujukan, nama atau pemilik</label><input id="search-input" placeholder="Rujukan, nama atau pemilik…" autocomplete="off"><div id="search-results"></div>');
  const el=dlg.querySelector('#search-input'),out=dlg.querySelector('#search-results');
  function list(){const q=el.value.toLowerCase().trim();const maps={requests:'requests',purchases:'purchases',deliveries:'deliveries',dispatches:'shipments',assays:'assays',sales:'sales',agents:'agents',refineries:'refineries',einvoices:'einvoices'};
    const results=[];for(const [k,page] of Object.entries(maps)){for(const r of state[k]){const label=[r.id,r.name,r.owner,r.code,r.invoiceNo,r.reportNo,r.prNo,r.reference].filter(Boolean).join(' · ');if(label.toLowerCase().includes(q))results.push([page,r.id,label])}}
    out.innerHTML='<div class="pick-results">'+results.slice(-35).reverse().map(([page,id,label])=>'<button data-action="'+actId(()=>go(page,{id}))+'"><strong>'+esc(label)+'</strong><small>'+routes[page].name+'</small></button>').join('')+'</div>'+(!results.length?'<p class="empty">Tiada rekod sepadan.</p>':'');
  }
  el.oninput=list;list();el.focus();
}
function authForm(){
  if(!session.local){location.assign('/signin-with-chatgpt?returnTo=/');return}
  const setup=session.setup;form({accountForm:true,title:setup?'Buka ruang kerja sebenar':'Log masuk ke ruang kerja',description:setup?'Daftarkan akaun pengurusan pertama untuk mula merekod transaksi sebenar.':'Gunakan akaun yang didaftarkan oleh pengurusan.',submitLabel:setup?'Daftar dan masuk':'Log masuk',fields:[
    ...(setup?[{key:'name',label:'Nama pengurus',required:true}]:[]),{key:'email',label:'E-mel',type:'email',required:true,autocomplete:'username'},
    {key:'password',label:'Kata laluan',type:'password',required:true,autocomplete:setup?'new-password':'current-password',help:setup?'Sekurang-kurangnya 12 aksara.':''}
  ],onSubmit:async vals=>{await api(setup?'/api/setup':'/api/login',vals);sessionStorage.setItem('aj-mode','live');location.reload()}});
}
async function switchMode(){
  if(training && !session.user)return authForm();
  training=!training;sessionStorage.setItem('aj-mode',training?'demo':'live');if(training && !demo)demo=demoWorkspace();
  await refresh();go('dashboard');
}
function accountMenu(){
  const u=ui.user;
  dialog('Ruang kerja','<div class="account-info"><strong>'+esc(u.name)+'</strong><p>'+esc(training?'Data contoh untuk latihan sesi ini.':u.email+' · '+euroles[u.role])+'</p></div><div class="actions">'+button(training?'Buka ruang sebenar':'Cuba data contoh',()=>{close();return switchMode()},'primary')+(!training?button('Tetapan & akses',()=>go('settings')):'')+(!training?button('Log keluar',async()=>{if(session.local){await api('/api/logout',{});sessionStorage.removeItem('aj-mode');location.reload()}else location.assign('/signout-with-chatgpt?returnTo=/')}):'')+'</div>');
}
function render(){
  events.clear();const u=ui.user;const info=routes[route]||routes.dashboard;
  const navTop=document.querySelector('.side-nav')?.scrollTop||0;
  document.querySelector('#app').innerHTML='<aside class="sidebar"><a class="brand" href="#dashboard"><img src="/mark.svg" alt=""><span>Ariffin Jewels<small>OPERASI EMAS</small></span></a><nav class="side-nav" aria-label="Navigasi utama">'+groups.map(([g,rows])=>'<p class="nav-title">'+g+'</p>'+rows.map(([key,name,glyph])=>'<a class="nav-item '+(route===key?'selected':'')+'" '+(route===key?'aria-current="page"':'')+' href="#'+key+'">'+icon(glyph,18)+'<span>'+name+'</span></a>').join('')).join('')+'</nav><button class="profile" data-action="'+actId(accountMenu)+'"><span class="avatar">'+esc(u.name.split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase())+'</span><span><b>'+esc(u.name)+'</b><small>'+esc(euroles[u.role])+'</small></span>'+icon('down',15)+'</button></aside><button class="nav-backdrop" aria-label="Tutup menu" data-action="'+actId(()=>document.body.classList.remove('nav-open'))+'"></button><div class="workspace"><header class="topbar"><div class="breadcrumb"><button class="icon-btn menu-toggle" aria-label="Buka menu" data-action="'+actId(()=>document.body.classList.toggle('nav-open'))+'">'+icon('menu')+'</button><span>'+esc(info.group)+'</span>'+icon('right',13)+'<b>'+esc(info.name)+'</b></div><div class="top-tools"><button class="search-button" data-action="'+actId(search)+'">'+icon('search',16)+'<span>Cari rekod</span><kbd>/</kbd></button><button class="mode-chip '+(training?'sample':'')+'" data-action="'+actId(accountMenu)+'"><i></i>'+ (training?'Data contoh':'Ruang sebenar')+icon('down',12)+'</button></div></header><main id="main" tabindex="-1"></main></div>';
  document.querySelector('.side-nav').scrollTop=navTop;
  if(training)document.querySelector('.top-tools').insertAdjacentHTML('beforeend',link('Buka ruang sebenar',()=>switchMode()));
  const result=pages.get(route)(params);if(result?.catch)result.catch(e=>toast(e.message,true));
  if(params.new!==undefined){delete params.new;const q=new URLSearchParams(params);history.replaceState(null,'','#'+route+(q.size?'?'+q:''))}
}
const ui={get state(){return state},get files(){return files},get user(){return training?demoUser:session.user},get session(){return session},get demo(){return training},
  get legacySummary(){return legacySummary},refresh,
  page:(k,fn)=>pages.set(k,fn),go,esc,rm:n=>n==null?'—':'RM '+fm(n,2),g:n=>n==null?'—':fm(n,3)+' g',date:v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—',
  badge:(label,tone='neutral')=>'<span class="badge '+esc(tone)+'">'+esc(label)+'</span>',btn:button,glyphButton,link,bind:actId,icon,table,show,dialog,close,form,rerender:render,quick,toast,fileUrl,upload,batch,act:(action,data)=>batch([{action,data}]),api,
  file:(id,label)=>id?'<a class="text-link" target="_blank" rel="noopener" href="'+esc(fileUrl(id))+'">'+esc(label||files[id]?.name||'Buka lampiran')+'</a>':'—',
  section:(title,html)=>'<section class="panel"><header class="panel-head"><h2>'+esc(title)+'</h2></header>'+html+'</section>',
  can:(...roles)=>roles.includes(ui.user?.role),openLive:()=>training?switchMode():go('dashboard')};
registerReconcile(ui);registerDashboard(ui);registerFinance(ui);registerGold(ui);registerReports(ui);registerControl(ui);
document.addEventListener('click',async e=>{const a=e.target.closest('[data-action]');if(a){e.preventDefault();try{await events.get(a.dataset.action)?.()}catch(err){toast(err.message,true)}return}
 const anchor=e.target.closest('a[href^="#"]');if(anchor && anchor.hash!=='#main' && pages.has(anchor.hash.slice(1))){e.preventDefault();go(anchor.hash.slice(1))}});
window.addEventListener('popstate',()=>{close();readRoute();render()});
document.addEventListener('keydown',e=>{if(e.key==='/' && !dlg.open && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){e.preventDefault();search()}});
async function init(){session=await api('/api/session');training=!session.user || sessionStorage.getItem('aj-mode')==='demo';
  if(session.needsOperationsImport)await api('/api/legacy/apply',{});
  if(session.user&&!session.hasLegacy&&sessionStorage.getItem('aj-mode')==null){const live=await api('/api/state');training=live.version===0&&!live.legacySummary?.rows}
  if(training)demo=demoWorkspace();await refresh();readRoute();render()}
init().catch(e=>{document.querySelector('#app').innerHTML='<div class="boot"><h1>Operasi Ariffin Jewels</h1><p>'+esc(e.message)+'</p><button class="btn primary" id="reload">Cuba semula</button></div>';document.querySelector('#reload').onclick=()=>location.reload()});

