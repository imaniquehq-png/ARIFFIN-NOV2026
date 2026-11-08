import {applyLedger} from './ledger.mjs';
import {applyGold} from './gold.mjs';
import {downloadFile} from './report-pdf.js';

const fields={
  name:'Nama',code:'Kod',bank:'Bank',account:'Nombor akaun',method:'Kaedah harga',gramsPerTael:'Gram setiap tahil',advancePercent:'Peratus pendahuluan',
  requestId:'No. permohonan',agentId:'Kod ejen',refineryId:'Kod kilang',date:'Tarikh',requested:'Jumlah diminta',approved:'Jumlah diluluskan',reason:'Sebab',purpose:'Tujuan',
  amount:'Jumlah RM',proof:'Bukti bank',bankRef:'Rujukan bank',refundRequestId:'Payment Request pulangan kilang',owner:'Pemilik emas',type:'Jenis emas',purity:'Mutu',weight:'Berat gram',price:'Harga seunit',photo:'Gambar emas',
  invoiceNo:'No. invois pembekal',invoiceFile:'Fail invois',purchaseId:'No. lot pembelian',lotId:'No. lot',number:'No. MKS Lock',dateTime:'Tarikh dan masa',mode:'Pilihan tarik',operator:'Pengendali',
  before:'Berat sebelum',after:'Berat selepas',beforePhoto:'Gambar sebelum',afterPhoto:'Gambar selepas',note:'Catatan',lotIds:'Senarai no. lot',deliveryId:'No. penghantaran',
  receivedDate:'Tarikh penerimaan',receivedWeights:'Timbangan mengikut lot',dispatchId:'No. penghantaran kilang',document:'Dokumen sokongan',prNo:'No. PR',prDate:'Tarikh PR',
  reportNo:'No. laporan assay',file:'Fail dokumen',shipmentId:'No. pesanan penghantaran',saleId:'No. invois jualan',adjustment:'Pelarasan RM',directCost:'Kos langsung RM',
  status:'Status',reference:'Rujukan e-Invois',supplementId:'No. tambahan',
};
const definition=(label,required,optional='',roles='')=>({label,required:required.split(' '),optional:optional.split(' ').filter(Boolean),roles:roles.split(' ').filter(Boolean)});
const finance='management accountant',manager='management';
export const importTypes={
  'agent.create':definition('Ejen dan pembekal','name code bank account method','gramsPerTael'),
  'refinery.create':definition('Kilang','name code gramsPerTael','advancePercent'),
  'request.create':definition('Permohonan bayaran','agentId date requested purpose'),
  'request.approve':definition('Kelulusan permohonan','requestId approved','',manager),
  'request.reject':definition('Penolakan permohonan','requestId reason','',manager),
  'request.transfer':definition('Pindahan kepada ejen','requestId date amount bankRef proof','',finance),
  'purchase.create':definition('Pembelian emas','requestId owner date type purity weight price photo','invoiceNo invoiceFile'),
  'purchase.invoice':definition('Invois pembekal','purchaseId date invoiceNo invoiceFile'),
  'purchase.confirm':definition('Pengesahan bil pembelian','purchaseId date','','accountant'),
  'request.return':definition('Pemulangan dana','requestId date amount bankRef proof','',finance),
  'request.supplement':definition('Permohonan tambahan','requestId date amount reason'),
  'request.supplementApprove':definition('Kelulusan tambahan','requestId supplementId','',manager),
  'request.supplementReject':definition('Penolakan tambahan','requestId supplementId','',manager),
  'request.close':definition('Penutupan permohonan','requestId','','accountant'),
  'mks.lock':definition('MKS Lock','lotId number dateTime price weight'),
  'process.save':definition('Proses tarik','lotId mode date','operator before after beforePhoto afterPhoto note'),
  'delivery.create':definition('Penghantaran ke Ariffin Jewels','date lotIds photo','weight'),
  'delivery.receive':definition('Timbangan penerimaan','deliveryId receivedDate receivedWeights','note'),
  'dispatch.create':definition('Penghantaran ke kilang','refineryId date lotIds photo document','weight'),
  'dispatch.pr':definition('PR kilang','dispatchId prNo prDate'),
  'assay.create':definition('Keputusan assay','dispatchId lotId date reportNo before after purity file','note'),
  'sale.create':definition('Jualan kepada kilang','shipmentId date weight price'),
  'sale.receive':definition('Terimaan daripada kilang','saleId date amount bankRef proof','',finance),
  'sale.refundRequest':definition('Permohonan pulangan kepada kilang','saleId date amount purpose'),
  'sale.refundApprove':definition('Kelulusan pulangan kepada kilang','saleId refundRequestId approved','',manager),
  'sale.refundReject':definition('Penolakan pulangan kepada kilang','saleId refundRequestId reason','',manager),
  'sale.refund':definition('Pemulangan lebihan kepada kilang','saleId refundRequestId date amount bankRef proof','',finance),
  'sale.finalize':definition('Pengesahan jualan akhir','saleId date adjustment directCost note','',finance),
  'einvoice.record':definition('Rekod e-Invois','date reference status file','purchaseId saleId',finance),
};
const fileKeys=new Set(['proof','file','document','photo','beforePhoto','afterPhoto','invoiceFile']);
const photoKeys=new Set(['photo','beforePhoto','afterPhoto']);
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const aliases={agentId:['ejen','agent','agent code','kod agent'],code:['kod agent','kod ejen','kod kilang'],name:['nama syarikat','nama ejen','nama kilang'],date:['tarikh transaksi'],weight:['berat','berat asal','berat g'],requested:['jumlah permohonan'],account:['no akaun','akaun bank'],gramsPerTael:['gram per tahil','gram per tael'],method:['kaedah'],owner:['pemilik'],refineryId:['kilang'],photo:['gambar','nama fail gambar']};
export function parseSheet(source) {
  const txt=source.replace(/^\uFEFF/,'');
  if(!txt.trim())throw Error('Pilih fail CSV atau tampal data bersama tajuk lajur.');
  const header=txt.split(/\r?\n/,1)[0], sep=['\t',',',';'].sort((a,b)=>header.split(b).length-header.split(a).length)[0];
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  function push(){row.push(cell);cell='';closed=false;}
  function finish(){push();if(row.some(x=>x.trim()!==''))rows.push(row);row=[];}
  for(let n=0;n<txt.length;n++){
    const ch=txt[n];
    if(quoted){
      if(ch==='"'&&txt[n+1]==='"'){cell+='"';n++;}else if(ch==='"'){quoted=false;closed=true;}else cell+=ch;
    }else if(ch===sep){push();}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&txt[n+1]==='\n')n++;finish();}
    else if(ch==='"'&&!cell&&!closed)quoted=true;
    else if(ch==='"'||(closed&&!/\s/.test(ch)))throw Error('Petikan CSV tidak sah dalam rekod '+(rows.length+1)+'.');
    else if(!closed)cell+=ch;
  }
  if(quoted)throw Error('Petikan CSV belum ditutup.');
  finish();if(rows.length<2)throw Error('Fail perlu mengandungi tajuk lajur dan sekurang-kurangnya satu baris data.');
  const headers=rows.shift().map(x=>x.trim());
  if(headers.some(x=>!x)||new Set(headers.map(normalize)).size!==headers.length)throw Error('Setiap tajuk lajur perlu berisi dan unik.');
  if(rows.length>250)throw Error('Had setiap import ialah 250 baris. Pecahkan helaian kepada beberapa fail.');
  rows.forEach((r,n)=>{if(r.length!==headers.length)throw Error('Rekod '+(n+1)+' mempunyai '+r.length+' lajur. Tajuk mempunyai '+headers.length+' lajur.');});
  return {headers,rows};
}
function suggest(header,key){return [key,fields[key],...(aliases[key]||[])].map(normalize).includes(normalize(header));}
const iso=v=>{const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);return m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):v;};
const getKey=(state,name,v)=>state[name]?.find(r=>r.id===v||r.code?.toLowerCase()===v.toLowerCase()||r.name?.toLowerCase()===v.toLowerCase())?.id||v;
const headersCSV=arr=>'\uFEFF'+arr.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')+'\r\n';
function convert(k,v,state){
  if(k==='agentId')return getKey(state,'agents',v);if(k==='refineryId')return getKey(state,'refineries',v);
  if(k==='date'||k==='prDate'||k==='receivedDate')return iso(v);
  if(k==='lotIds')return v.split(/[|;]/).map(s=>s.trim()).filter(Boolean);
  if(k==='receivedWeights'){
    const pairs=v.split(/[|;]/).map(item=>item.split('=').map(s=>s.trim()));
    if(pairs.some(([a,b,...rest])=>!a||!b||rest.length)||new Set(pairs.map(([a])=>a)).size!==pairs.length)throw Error('Gunakan format LOT-000001=12.345|LOT-000002=9.120.');
    return Object.fromEntries(pairs);
  }
  if(k==='dateTime')return v.replace(' ','T');
  if(k==='mode')return ['skip','tidaktarik'].includes(normalize(v))?'skip':normalize(v)==='tarik'?'tarik':v;
  if(k==='method')return normalize(v)==='webuy'?'WeBuy':['tahil','tael'].includes(normalize(v))?'Tahil':v;
  return v;
}
const fileMime=f=>f.type||({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf'}[f.name.split('.').at(-1)?.toLowerCase()]||'');
export function prepareImport(type,sheet,mapping,media,state,user,knownFiles={}){
  const schema=importTypes[type], keys=[...schema.required,...schema.optional], assigned=keys.filter(k=>mapping[k]!==''&&mapping[k]!=null);
  const missing=schema.required.filter(k=>!assigned.includes(k));if(missing.length)throw Error('Padankan lajur '+missing.map(k=>fields[k]).join(', ')+'.');
  if(new Set(assigned.map(k=>mapping[k])).size!==assigned.length)throw Error('Setiap lajur helaian hanya boleh dipadankan sekali.');
  const tempState=structuredClone(state),tempFiles={...knownFiles},commands=[],errors=[],needed=new Map();
  let sequence=0;
  const ctx={now:new Date().toISOString(),user,files:tempFiles,id:prefix=>prefix+'-PRATONTON-'+(++sequence)};
  for(const [n,row] of sheet.rows.entries()){
    try{
      const data={};
      for(const k of assigned){
        const value=row[Number(mapping[k])]?.trim()||'';
        if(!value){if(schema.required.includes(k))throw Error('Isi '+fields[k]+'.');continue;}
        data[k]=convert(k,value,state);
        if(fileKeys.has(k)){
          const f=media.find(file=>file.name===value);
          if(f){
            const mime=fileMime(f);if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(mime)||f.size>10*1024*1024||f.size===0)throw Error('Lampiran '+value+' perlu JPG, PNG, WebP atau PDF, sehingga 10 MB.');
            data[k]='import:'+value;tempFiles[data[k]]={type:mime};needed.set(data[k],f);
          }else if(!Object.hasOwn(tempFiles,value))throw Error('Pilih lampiran '+value+' atau gunakan ID fail yang sudah dimuat naik.');
          if(photoKeys.has(k)&&!tempFiles[data[k]].type.startsWith('image/'))throw Error(fields[k]+' mesti fail gambar.');
        }
      }
      const cmd={action:type,data};
      // Match server validation without changing the live ledger. Invalid source rows stay out of the preview state.
      const next=structuredClone(tempState);
      const record=applyLedger(next,type,data,ctx)||applyGold(next,type,data,ctx);
      if(!record)throw Error('Jenis transaksi tidak dikenali.');
      Object.assign(tempState,next);commands.push(cmd);
    }catch(e){errors.push('Rekod '+(n+1)+' · '+e.message);}
  }
  return {commands,errors,needed};
}
export function registerSheetImport(ui) {
  const esc=v=>ui.esc(String(v??''));
  const reset=()=>({type:'agent.create',source:'',sheet:null,mapping:{},media:[],uploads:new Map(),error:'',preview:null,busy:false,done:0});
  let model=reset(), previousDemo=ui.demo;
  const schema=()=>importTypes[model.type];
  function render(){
    if(ui.demo!==previousDemo){model=reset();previousDemo=ui.demo;}
    const m=model, types=Object.entries(importTypes).filter(([,d])=>!d.roles.length||d.roles.includes(ui.user.role));
    if(!types.some(([type])=>type===m.type))m.type=types[0][0];
    let content='';
    if(m.done){
      content='<div class="aj-notice good" role="status"><strong>'+m.done+' rekod berjaya diimport.</strong></div>'+ui.btn('Import helaian lain',()=>{model=reset();render();},'secondary');
    }else{
      content='<div class="aj-field"><label for="imp-type">Jenis rekod</label><select id="imp-type">'+types.map(([k,d])=>'<option value="'+k+'"'+(k===m.type?' selected':'')+'>'+esc(d.label)+'</option>').join('')+'</select></div>';
      if(!m.sheet){
        content+='<p class="aj-help">Dalam Google Sheets, pilih Fail → Muat turun → Nilai dipisahkan koma (.csv), atau salin sel bersama tajuk lajur.</p><div class="aj-field"><label for="imp-csv">Fail CSV atau TSV</label><input type="file" id="imp-csv" accept=".csv,.tsv,text/csv,text/tab-separated-values"></div><div class="aj-field"><label for="imp-paste">Atau tampal data helaian</label><textarea id="imp-paste" rows="5" placeholder="Tajuk lajur dan baris data">'+esc(m.source)+'</textarea></div><div class="aj-actions">'+ui.btn('Padankan lajur',loadSheet,'primary')+ui.btn('Muat turun templat CSV',template,'secondary')+'</div>';
      }else{
        const d=schema(),keys=[...d.required,...d.optional];
        content+='<div class="aj-strip"><strong>'+m.sheet.rows.length+' rekod · '+m.sheet.headers.length+' lajur</strong>'+ui.btn('Tukar helaian',()=>{m.sheet=null;m.preview=null;m.error="";render();},'ghost')+'</div>';
        content+='<h3>Padanan lajur</h3><div class="aj-fields">'+keys.map(k=>'<label class="aj-field">'+esc(fields[k])+(d.required.includes(k)?' *':'')+'<select data-map="'+k+'"><option value="">Pilih lajur</option>'+m.sheet.headers.map((h,n)=>'<option value="'+n+'"'+(String(m.mapping[k])===String(n)?' selected':'')+'>'+esc(h)+'</option>').join('')+'</select></label>').join('')+'</div>';
        if(keys.some(k=>fileKeys.has(k)))content+='<div class="aj-field"><label for="imp-media">Lampiran asal</label><input type="file" multiple accept=".jpeg,.jpg,.png,.webp,.pdf" id="imp-media"><small>Isi nama fail penuh dalam lajur lampiran. Fail dipadankan mengikut nama.</small>'+ (m.media.length?'<small>'+esc(m.media.map(f=>f.name).join(', '))+'</small>':'')+'</div>';
        if(keys.includes('lotIds')||keys.includes('receivedWeights'))content+='<p class="aj-help">'+(keys.includes('lotIds')?'Asingkan nombor lot dengan |, contohnya LOT-000001|LOT-000002.':'Masukkan timbangan dalam format LOT-000001=12.345|LOT-000002=9.120.')+'</p>';
        if(keys.includes('requestId')||keys.includes('purchaseId')||keys.includes('lotId')||keys.includes('saleId'))content+='<p class="aj-help">Gunakan nombor rujukan transaksi yang telah direkod dalam sistem.</p>';
        if(!m.preview)content+=ui.btn('Semak '+m.sheet.rows.length+' rekod',preview,'primary');
        else{
          const p=m.preview;
          if(p.errors.length)content+='<div class="aj-notice bad" role="alert"><strong>'+p.errors.length+' rekod memerlukan pembetulan</strong><ul>'+p.errors.slice(0,20).map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul></div>';
          else content+='<div class="aj-notice good"><strong>'+p.commands.length+' rekod lulus semakan</strong></div>';
          const showkeys=keys.filter(k=>m.mapping[k]!==''&&m.mapping[k]!=null);
          content+=ui.table(showkeys.map(k=>fields[k]),m.sheet.rows.slice(0,10).map(row=>showkeys.map(k=>esc(row[m.mapping[k]]))));
          if(m.sheet.rows.length>10)content+='<small>Pratonton 10 daripada '+m.sheet.rows.length+' rekod.</small>';
          if(!p.errors.length)content+='<div class="aj-actions">'+ui.btn(m.busy?'Menyimpan…':'Import '+p.commands.length+' rekod',submit,'primary')+'</div>';
        }
      }
      if(m.error)content+='<div class="aj-notice bad" role="alert">'+esc(m.error)+'</div>';
    }
    ui.show({title:'Import Google Sheets',subtitle:'Bawa rekod sedia ada ke dalam sistem.',body:'<div class="aj-import">'+ui.section('Import helaian',content)+'</div>'});
    const select=document.getElementById('imp-type');
    if(select)select.onchange=()=>{model={...reset(),type:select.value};render();};
    document.querySelectorAll('[data-map]').forEach(el=>el.onchange=()=>{m.mapping[el.dataset.map]=el.value;m.preview=null;m.error='';render();});
    const media=document.getElementById('imp-media');
    if(media)media.onchange=()=>{m.media=[...media.files];m.error='';if(new Set(m.media.map(f=>f.name)).size!==m.media.length){m.media=[];m.error='Pilih fail dengan nama yang unik.';}m.preview=null;render();};
    if(m.busy)document.querySelectorAll('.aj-import button,.aj-import input,.aj-import select').forEach(el=>el.disabled=true);
  }
  function template(){const d=schema(); downloadFile(new Blob([headersCSV([...d.required,...d.optional].map(k=>fields[k]))],{type:'text/csv;charset=utf-8'}),'Templat-'+model.type+'.csv');}
  async function loadSheet(){
    const f=document.getElementById('imp-csv')?.files[0],paste=document.getElementById('imp-paste')?.value||'';
    try{
      if(f&&f.size>5*1024*1024)throw Error('Fail helaian melebihi 5 MB.');
      model.source=f?await f.text():paste;model.sheet=parseSheet(model.source);const d=schema();
      model.mapping=Object.fromEntries([...d.required,...d.optional].map(k=>{const n=model.sheet.headers.findIndex(h=>suggest(h,k));return [k,n===-1?'':String(n)];}));model.error='';
    }catch(e){model.error=e.message;}
    render();
  }
  function preview(){
    try{const m=model; m.preview=prepareImport(m.type,m.sheet,m.mapping,m.media,ui.state,ui.user,ui.state.files||{});m.error='';}
    catch(e){model.error=e.message;model.preview=null;}render();
  }
  async function submit(){
    const m=model;if(m.busy||!m.preview?.commands.length||m.preview.errors.length)return;
    m.busy=true;render();
    try{
      const uploads=new Map();
      for(const [key,f] of m.preview.needed){
        if(!m.uploads.has(f))m.uploads.set(f,await ui.upload(f));
        uploads.set(key,m.uploads.get(f));
      }
      const commands=m.preview.commands.map(cmd=>({action:cmd.action,data:Object.fromEntries(Object.entries(cmd.data).map(([k,v])=>[k,fileKeys.has(k)&&uploads.has(v)?uploads.get(v):v]))}));
      await ui.batch(commands);m.done=commands.length;m.error='';
    }catch(e){m.error=e.message;}finally{m.busy=false;render();}
  }
  ui.page('import',render);
}
