const roleNames = { management: 'Pengurusan', accountant: 'Akauntan', staff: 'Staf' };
const actionNames = {
  'reconciliation.request':'Mohon padanan rekod','reconciliation.approve':'Lulus padanan rekod','reconciliation.reject':'Tolak padanan rekod',
  'sale.refundRequest':'Permohonan pulangan kepada kilang','sale.refundApprove':'Lulus permohonan pulangan kilang','sale.refundReject':'Tolak permohonan pulangan kilang',
  'sale.refund':'Pulangkan lebihan kilang','custody.create':'Rekod lot jagaan','custody.cost':'Sahkan kos lot jagaan','delivery.issue':'Keluarkan borang penghantaran',
  'sheet.records':'Import data Google Sheets',
  'agent.create':'Daftar ejen', 'refinery.create':'Daftar kilang', 'request.create':'Permohonan bayaran',
  'request.approve':'Lulus permohonan', 'request.reject':'Tolak permohonan', 'request.transfer':'Pindahan kepada ejen',
  'request.return':'Pemulangan dana', 'request.close':'Tutup permohonan', 'request.supplement':'Mohon tambahan',
  'request.supplementApprove':'Lulus tambahan', 'request.supplementReject':'Tolak tambahan', 'purchase.create':'Pembelian emas',
  'purchase.invoice':'Serahan invois pembekal', 'purchase.confirm':'Pengesahan bil belian', 'mks.lock':'MKS Lock',
  'process.save':'Pilihan proses emas', 'delivery.create':'Penghantaran ke Ariffin Jewels', 'delivery.receive':'Sahkan terima emas',
  'dispatch.create':'Penghantaran ke kilang', 'dispatch.pr':'Rekod PR kilang', 'assay.create':'Keputusan assay',
  'sale.create':'Invois jualan kilang', 'sale.receive':'Terima bayaran kilang', 'sale.finalize':'Muktamadkan jualan',
  'einvoice.record':'Rekod e-Invois', 'correction.request':'Mohon pembetulan', 'correction.approve':'Lulus pembetulan', 'correction.reject':'Tolak pembetulan',
};
const labels = {
  kind:'Jenis padanan',fields:'Butiran padanan',evidence:'Bukti sumber',proposal:'Permohonan padanan',costProof:'Bukti kos',formFile:'Borang penghantaran dikeluarkan',refundRequestId:'Payment Request pulangan kilang',
  id:'ID', requestId:'Permohonan bayaran', agentId:'Ejen', refineryId:'Kilang', purchaseId:'Lot belian', lotId:'Lot emas',
  lotIds:'Senarai lot', deliveryId:'Penghantaran ke Ariffin Jewels', dispatchId:'Penghantaran ke kilang', shipmentId:'Penghantaran ke kilang',
  saleId:'Invois jualan', supplementId:'Permohonan tambahan', name:'Nama', code:'Kod', bank:'Nama bank', account:'Nombor akaun',
  method:'Kaedah harga', gramsPerTael:'Gram setiap tahil', advancePercent:'Pendahuluan (%)', owner:'Pemilik emas', type:'Jenis emas',
  date:'Tarikh transaksi', dateTime:'Tarikh & masa (MY)', requested:'Jumlah diminta (RM)', approved:'Jumlah diluluskan (RM)',
  purpose:'Tujuan', amount:'Amaun (RM)', bankRef:'Rujukan bank', proof:'Bukti transaksi bank', reason:'Sebab',
  purity:'Mutu emas (‰)', weight:'Berat (g)', price:'Harga seunit', photo:'Gambar emas', file:'Lampiran', invoiceNo:'Nombor invois pembekal',
  invoiceFile:'Salinan invois pembekal', invoiceDate:'Tarikh invois', number:'Nombor MKS Lock', mode:'Pilihan proses',
  operator:'Pihak yang menjalankan proses', before:'Berat sebelum (g)', after:'Berat selepas (g)', beforePhoto:'Gambar sebelum tarik',
  afterPhoto:'Gambar selepas tarik', note:'Catatan', receivedDate:'Tarikh penerimaan', receivedWeights:'Berat penerimaan bagi setiap lot (g)',
  document:'Dokumen sokongan', prNo:'Nombor PR', prDate:'Tarikh PR', reportNo:'Nombor laporan assay', adjustment:'Pelarasan (RM)',
  directCost:'Kos langsung (RM)', reference:'Rujukan e-Invois', status:'Status', target:'No. catatan asal', values:'Nilai yang dipohon',
  request:'No. permohonan pembetulan', priceUnit:'Unit harga lock',
};
const references = { requestId:'requests',agentId:'agents',refineryId:'refineries',purchaseId:'purchases',lotId:'purchases',
  deliveryId:'deliveries',dispatchId:'dispatches',shipmentId:'dispatches',saleId:'sales',supplementId:'supplements' };
const uploads = new Set(['proof','photo','file','invoiceFile','beforePhoto','afterPhoto','document','evidence','costProof','formFile']);
const images = new Set(['photo','beforePhoto','afterPhoto']);
const numbers = new Set(['gramsPerTael','advancePercent','requested','approved','amount','purity','weight','price','before','after','adjustment','directCost']);
const dateFields = new Set(['date','invoiceDate','receivedDate','prDate']);
const opt = (value,label) => ({value,label});
const field = (key,label,type='text',extra={}) => ({key,label,type,required:true,...extra});
const options = obj => Object.entries(obj).map(([value,label]) => opt(value,label));
const readTime = value => new Intl.DateTimeFormat('ms-MY',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function registerControl(ui) {
  const esc = value => ui.esc(String(value ?? ''));
  const btn = (label,click,kind='secondary') => ui.btn(label,click,kind);
  const actions = (...items) => '<div class="actions">' + items.filter(Boolean).join('') + '</div>';
  const blank = message => '<div class="empty">' + esc(message) + '</div>';
  const paragraph = message => '<p class="muted">' + esc(message) + '</p>';
  const tag = status => status === 'approved' ? ui.badge('Diluluskan','green') : status === 'rejected' ? ui.badge('Ditolak','red') : ui.badge('Menunggu kelulusan','amber');
  const nameOf = action => actionNames[action] || action;
  const labelOf = key => labels[key] || key.replace(/([a-z])([A-Z])/g,'$1 $2');
  function valueOf(key,val) {
    if (val === undefined || val === null || val === '') return '<span class="muted">—</span>';
    if (uploads.has(key)) return ui.file(val,'Lihat lampiran');
    if (Array.isArray(val)) return val.map(x=>esc(x)).join(', ');
    if (typeof val === 'object') return '<dl>' + Object.entries(val).map(([k,v]) => '<dt>'+esc(labelOf(k))+'</dt><dd>'+valueOf(k,v)+'</dd>').join('') + '</dl>';
    if (typeof val === 'boolean') return val ? 'Ya' : 'Tidak';
    if (key === 'mode') return val === 'tarik' ? 'Tarik' : 'Tidak tarik';
    return esc(val);
  }
  function comparison(before,after,changesOnly) {
    const keys = [...new Set([...Object.keys(before),...Object.keys(after)])];
    const rows = keys.filter(k=> !changesOnly || !same(before[k],after[k])).map(k=>[esc(labelOf(k)),valueOf(k,before[k]),valueOf(k,after[k])]);
    return rows.length ? ui.table(['Medan','Sebelum','Selepas'],rows) : paragraph('Tiada medan berubah.');
  }
  const targetOf = c => ui.state.audit.find(e=>e.seq===c.target);
  function previousValues(c) {
    const past = ui.state.audit.filter(e=>e.seq<c.seq && e.action==='correction.approve').reverse();
    for (const entry of past) {
      const prior = ui.state.corrections.find(x => x.seq===entry.original.request && x.target===c.target);
      if (prior) return prior.values;
    }
    return targetOf(c)?.original || {};
  }
  function reviewCorrection(c) {
    const original = targetOf(c);
    if (!original) return;
    const allowed = ui.can('management') && c.status==='pending' && c.user.id!==ui.user.id;
    const decision = async approved => {
      const outstanding = new Set((ui.state.deliveries||[]).filter(d=>d.formNeedsReissue).map(d=>d.id));
      await ui.act(approved?'correction.approve':'correction.reject',{request:c.seq});
      ui.close();
      ui.rerender();
      const replacements=(ui.state.deliveries||[]).filter(d=>d.formNeedsReissue && !outstanding.has(d.id));
      if(approved && replacements.length)ui.dialog('Keluarkan borang gantian',
        paragraph('Butiran pada borang penghantaran telah berubah. Jana PDF gantian sebelum menggunakan akuan penerimaan.')+
        actions(...replacements.map(d=>btn(d.id+' · Jana PDF',()=>ui.printDoc('delivery',d.id),'primary'))));
    };
    ui.dialog('Pembetulan ' + c.id,
      '<p><strong>'+esc(original.ref)+'</strong> · '+esc(nameOf(original.action))+' · '+tag(c.status)+'</p>'+
      '<p>'+esc(c.user.name)+' · '+esc(readTime(c.date))+'</p><p>'+esc(c.reason)+'</p>'+
      comparison(previousValues(c),c.values,true) +
      (c.reviewer?paragraph('Disemak oleh '+c.reviewer):'')+
      (allowed ? actions(btn('Luluskan pembetulan',()=>decision(true),'primary'),btn('Tolak pembetulan',()=>decision(false))) :
        c.status==='pending' ? paragraph('Pengurus selain pemohon boleh menyemak dan meluluskan pembetulan ini.') : ''));
  }
  function editField(k,v) {
    const key = 'edit_'+k, label = labelOf(k);
    if (uploads.has(k)) return field(key,label,'file',{required:false,accept:images.has(k) ? '.jpg,.jpeg,.png,.webp' : '.pdf,.jpg,.jpeg,.png,.webp',help:'Muat naik fail untuk menggantikan lampiran semasa.'});
    if (references[k] && ui.state[references[k]].length) return field(key,label,'select',{value:v,options:ui.state[references[k]].map(x=>opt(x.id,x.id+(x.name?' · '+x.name:'')))});
    if (typeof v === 'object' && v !== null) return field(key,label,'textarea',{value:JSON.stringify(v,null,2),help:k==='receivedWeights'?'Kekalkan ID lot sebagai kekunci dan masukkan gram bagi setiap lot.':'Masukkan senarai ID lot dalam format JSON.'});
    if (k==='method') return field(key,label,'select',{value:v,options:[opt('WeBuy','WeBuy'),opt('Tahil','Tahil')]});
    if (k==='mode') return field(key,label,'select',{value:v,options:[opt('tarik','Tarik'),opt('skip','Tidak tarik')]});
    if (typeof v === 'boolean') return field(key,label,'select',{value:String(v),options:[opt('true','Ya'),opt('false','Tidak')]});
    if (numbers.has(k)||typeof v === 'number') return field(key,label,'number',{value:v,step:'any',required:false});
    return field(key,label,dateFields.has(k)?'date':k==='dateTime'?'datetime-local':['purpose','note','reason'].includes(k)?'textarea':'text',{value:v??'',required:false});
  }
  function requestEdit(event) {
    ui.close();
    const prev = event.data;
    const keys = Object.keys(prev);
    ui.form({title:'Mohon pembetulan',description:event.ref+' · '+nameOf(event.action),
      fields:[...keys.flatMap(k=>event.action==='reconciliation.request'&&k==='fields'?
        Object.entries(prev.fields).map(([name,val])=>({...editField(name,val),key:'match_'+name})): [editField(k,prev[k])]),field('explanation','Sebab pembetulan','textarea',{help:'Terangkan kesilapan dan perubahan yang diperlukan.'})],
      onSubmit:async values=>{
        const next = structuredClone(prev);
        for (const k of keys) {
          if(event.action==='reconciliation.request'&&k==='fields'){
            for(const [key,old] of Object.entries(prev.fields)){
              const value=values['match_'+key];
              if(uploads.has(key)){if(value)next.fields[key]=value;}
              else if(Array.isArray(old))next.fields[key]=JSON.parse(value);
              else next.fields[key]=value;
            }
            continue;
          }
          const v=values['edit_'+k], old=prev[k];
          if (uploads.has(k)) { if(v) next[k]=v; continue; }
          if(typeof old==='object' && old!==null) {
            try { next[k]=JSON.parse(v); } catch { throw new Error('Format JSON bagi '+labelOf(k)+' tidak sah.'); }
          } else if (typeof old==='boolean') next[k]=v==='true' || v===true;
          else if (typeof old==='number') next[k]=v===''?'':Number(v);
          else if (String(old ?? '')!==String(v ?? '')) next[k]=v ?? '';
        }
        if (same(next,prev)) throw new Error('Ubah sekurang-kurangnya satu medan.');
        await ui.act('correction.request',{target:event.seq,values:next,reason:values.explanation});
      }});
  }
  function auditDetail(e) {
    if (e.action.startsWith('correction.')) {
      const c=ui.state.corrections.find(x=>x.seq===(e.action==='correction.request'?e.seq:e.data.request));
      if (c) return reviewCorrection(c);
    }
    const pending = ui.state.corrections.find(x=>x.target===e.seq && x.status==='pending');
    const changed = !same(e.original,e.data);
    const data = changed ? comparison(e.original,e.data,false) : ui.table(['Medan','Nilai direkodkan'],Object.entries(e.original).filter(([k])=>e.action!=='delivery.issue'||k!=='basis').map(([k,v])=>[esc(labelOf(k)),valueOf(k,v)]));
    ui.dialog(nameOf(e.action),'<p><strong>'+esc(e.ref)+'</strong> · '+esc(e.id)+'</p><p>'+esc(e.user)+' · '+esc(roleNames[e.role])+' · '+esc(readTime(e.now))+'</p>'+
      data+(['sheet.records','delivery.issue','reconciliation.approve','reconciliation.reject'].includes(e.action)?'':actions(pending ? btn('Lihat pembetulan tertunda',()=>{ui.close();reviewCorrection(pending);}) : btn('Mohon pembetulan',()=>requestEdit(e)))));
  }

  function filters(params) {
    const authors = [...new Set(ui.state.audit.map(e=>e.user))].sort();
    const types = [...new Set(ui.state.audit.map(e=>e.action))].sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
    ui.form({title:'Tapis sejarah transaksi',fields:[
      field('id','Nombor rekod / rujukan','text',{value:params.id||'',required:false}),
      field('actor','Pengguna','select',{value:params.actor||'',required:false,options:[opt('','Semua pengguna'),...authors.map(v=>opt(v,v))]}),
      field('action','Tindakan','select',{value:params.action||'',required:false,options:[opt('','Semua tindakan'),...types.map(a=>opt(a,nameOf(a)))]}),
    ],onSubmit:async v=>ui.go('audit',{id:v.id.trim(),actor:v.actor,action:v.action})});
  }
  function showAudit(params={}) {
    const id=(params.id||'').toLowerCase();
    const contains = e => !id || [e.id,e.ref, ...Object.values(e.data).filter(v=>typeof v==='string'),
      ...(e.data.lotIds||[]),...Object.keys(e.data.receivedWeights||{})].some(v=>String(v).toLowerCase().includes(id));
    const history = ui.state.audit.filter(e=>contains(e) && (!params.actor || e.user===params.actor) && (!params.action || e.action===params.action)).reverse();
    const corrections = [...ui.state.corrections].reverse().filter(c=> {
      const target=targetOf(c);
      return !id || c.id.toLowerCase().includes(id) || (target && contains(target));
    });
    const page = Math.min(Math.max(Number(params.page)||1,1),Math.max(Math.ceil(history.length/30),1));
    const current = history.slice((page-1)*30,page*30);
    const controls = actions(ui.state.audit.some(e=>e.action==='sheet.records')?btn('Padankan rekod',()=>ui.reconcile()):'',btn('Tapis sejarah',()=>filters(params)), (id||params.actor||params.action)?btn('Kosongkan penapis',()=>ui.go('audit',{}),'ghost'):'');
    const rows = current.map(e=>[ui.link(e.ref,()=>auditDetail(e)),esc(nameOf(e.action)),esc(e.user),esc(readTime(e.now)),ui.link('Butiran',()=>auditDetail(e))]);
    const corrRows = corrections.map(c=>[ui.link(c.id,()=>reviewCorrection(c)),esc(targetOf(c)?.ref||'—'),esc(c.user.name),tag(c.status),ui.link('Semak',()=>reviewCorrection(c))]);
    const next = delta => ui.go('audit',{...params,page:page+delta});
    ui.show({title:'Audit & pembetulan',subtitle:'Jejaki siapa merekodkan transaksi, perubahan yang dipohon dan keputusan pengurusan.',actions:controls,
      body:(ui.reconciliationPanel?.()||'')+(corrRows.length?ui.section('Permohonan pembetulan',ui.table(['Permohonan','Rekod terlibat','Pemohon','Status','Tindakan'],corrRows)):'')+
      ui.section('Sejarah transaksi', (rows.length?ui.table(['Rujukan','Tindakan','Pengguna','Masa Malaysia','Butiran'],rows):blank('Tiada catatan audit yang sepadan.'))+
        (history.length>30?actions(page>1?btn('Sebelumnya',()=>next(-1)):'',paragraph('Halaman '+page+' daripada '+Math.ceil(history.length/30)),page*30<history.length?btn('Seterusnya',()=>next(1)):''):'') )});
  }

  function changePassword() {
    ui.form({title:'Tukar kata laluan',fields:[
      field('old','Kata laluan semasa','password'),field('password','Kata laluan baharu','password',{help:'Gunakan sekurang-kurangnya 12 aksara.'}),field('repeat','Ulang kata laluan baharu','password'),
    ],onSubmit:async v=>{
      if(v.password!==v.repeat) throw new Error('Kata laluan baharu tidak sepadan.');
      await ui.api('/api/password',{old:v.old,password:v.password});
    }});
  }
  function editMember(m) {
    const own=m?.id===ui.user.id;
    const fields=[field('name','Nama penuh','text',{value:m?.name||''})];
    if(!m)fields.push(field('email','Alamat e-mel','email'));
    if(!own)fields.push(field('role','Peranan','select',{options:options(roleNames),value:m?.role||'staff'}));
    if(m && !own)fields.push(field('active','Status akses','select',{options:[opt('yes','Aktif'),opt('no','Nyahaktif')],value:m.active?'yes':'no'}));
    if(!m && ui.session.local)fields.push(field('password','Kata laluan awal','password',{help:'Gunakan sekurang-kurangnya 12 aksara.'}));
    ui.form({title:m?'Urus pengguna':'Tambah pengguna',description:m?m.email:(ui.session.local?'Pengguna boleh menukar kata laluan selepas log masuk.':'Gunakan alamat e-mel akaun ChatGPT pengguna.'),fields,
      onSubmit:async v=>{
        const payload=m?{id:m.id,name:v.name,role:own?'management':v.role,active:own||v.active==='yes'}:v;
        await ui.api('/api/members',payload);
      }});
  }
  async function loadMembers(panel) {
    try {
      const {members,history}=await ui.api('/api/members');
      if(!panel.isConnected)return;
      const rows=members.map(m=>[esc(m.name),esc(m.email),esc(roleNames[m.role]),m.active?ui.badge('Aktif','green'):ui.badge('Nyahaktif','neutral'),btn('Urus',()=>editMember(m))]);
      const logRows=history.map(h=>[esc(readTime(h.stamp)),esc(h.actor),esc(h.description)]);
      panel.innerHTML=ui.section('Pengguna & akses',actions(btn('Tambah pengguna',()=>editMember(),'primary'))+ui.table(['Nama','E-mel','Peranan','Status','Tindakan'],rows))+
        ui.section('Sejarah perubahan akses',logRows.length?ui.table(['Masa Malaysia','Pengurus','Perubahan'],logRows):blank('Belum ada perubahan akses direkodkan.'));
    }catch(error){
      if(panel.isConnected) panel.innerHTML=paragraph(error.message)+actions(btn('Cuba semula',()=>loadMembers(panel)));
    }
  }
  function showSettings() {
    const demo=ui.demo, account=ui.user;
    const facts='<div class="facts"><div><small>Nama</small><strong>'+esc(account.name)+'</strong></div><div><small>E-mel</small><strong>'+
      esc(account.email)+'</strong></div><div><small>Peranan</small><strong>'+esc(roleNames[account.role])+'</strong></div></div>';
    const controls=ui.can('management') && !demo?'<div id="aj-members-panel" aria-live="polite">'+paragraph('Memuatkan pengguna…')+'</div>':'';
    const setup=ui.table(['Perkara','Tetapan / kaedah'],[
      ['Harga ejen', 'WeBuy menggunakan RM/g. Untuk Tahil, tetapkan gram setiap tahil mengikut terma ejen. '+ui.link('Urus ejen',()=>ui.go('agents'))],
      ['Terma kilang', 'Tetapkan gram setiap tahil dan peratus bayaran awal bagi setiap kilang. '+ui.link('Urus kilang',()=>ui.go('refineries'))],
      ['Peranan pengguna','Staf merekod operasi. Akauntan mengesahkan bil dan bank. Pengurusan meluluskan dana, pembetulan dan akses.'],
      ['Data Google Sheets','Eksport helaian sedia ada sebagai CSV, padankan lajur dan semak pra­tonton sebelum import. '+ui.link('Import data',()=>ui.go('import'))],
      ['e-Invois','Rekodkan rujukan, status dan salinan daripada MyInvois. Penghantaran kepada LHDN dibuat melalui saluran syarikat. '+ui.link('Lihat e-Invois',()=>ui.go('einvoices'))],
    ]);
    ui.show({title:'Tetapan',subtitle:'Akaun, akses pengguna dan konfigurasi operasi.',
      actions:ui.session.local && !demo?btn('Tukar kata laluan',changePassword):'',
      body:ui.section('Akaun semasa',facts+(demo?paragraph('Mod latihan menggunakan pengguna serta transaksi contoh. Pengurusan akaun sebenar tersedia dalam ruang operasi.') : ''))+controls+ui.section('Konfigurasi operasi',setup)});
    const panel=document.getElementById('aj-members-panel');
    if (panel) void loadMembers(panel);
  }
  ui.page('audit',showAudit);
  ui.page('settings',showSettings);
}
