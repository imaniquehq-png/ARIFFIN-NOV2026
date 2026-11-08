import {requestTotals, saleTotals, saleLot, saleAssay, advanceLimit, receiptLimit, priorExcess} from './ledger.mjs';

const statuses = {
  pending:['Menunggu kelulusan','amber'], approved:['Diluluskan','green'], active:['Aktif','blue'],
  rejected:['Ditolak','red'], closed:['Selesai','green'], paid:['Dibayar','green'], provisional:['Sementara','amber'],
  final:['Muktamad','green'], submitted:['Dihantar','blue'], validated:['Disahkan','green'], cancelled:['Dibatalkan','neutral'],
  historical:['Rekod lejar','neutral'], 'source-document':['Dokumen sumber','neutral']
};
const day = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date());
const field = (key,label,type='text',extra={}) => ({key,label,type,required:true,...extra});
const amount = (key,label,extra={}) => field(key,label,'number',{step:0.01,min:0.01,...extra});
const when = (label='Tarikh transaksi') => field('date',label,'date',{value:day()});
const upload = (key,label) => field(key,label,'file',{accept:'.pdf,.png,.jpg,.jpeg,.webp'});
const select = (key,label,options,extra={}) => field(key,label,'select',{options,...extra});
const opt = (value,label) => ({value,label});
const newest = rows => [...rows].reverse();

export function registerFinance(ui) {
  const state = () => ui.state;
  const esc = v => ui.esc(String(v ?? ''));
  const accountant = () => ui.can('management','accountant');
  const director = () => ui.can('management');
  const person = (records,id) => records.find(r => r.id === id)?.name || id;
  const agentName = id => person(state().agents,id);
  const factoryName = id => person(state().refineries,id);
  const tag = key => ui.badge(...(statuses[key] || [key || '—','neutral']));
  const action = (label,fn,style='secondary') => ui.btn(label,fn,style);
  const reconcile = (collection,id) => ui.reconcile ? action('Padankan bukti',()=>ui.reconcile(collection,id)) : '';
  const ref = (label,page,id) => ui.link(label,() => ui.go(page,{id}));
  const documentButton = (label,type,id) => action(label,() => ui.printDoc(type,id));
  const attachment = (id,label='Lihat fail') => id ? ui.file(id,label) : '—';
  const list = (columns,rows,empty) => rows.length ? ui.table(columns,rows) : '<p class="empty-note">' + esc(empty) + '</p>';
  const section = (label,html) => ui.section(label,html);
  const details = pairs => '<dl class="finance-details">' + pairs.map(([name,val]) => '<div><dt>' + esc(name) + '</dt><dd>' + val + '</dd></div>').join('') + '</dl>';
  const funds = (id) => requestTotals(state(),id);
  const money = n => n==null?'—':ui.rm(n);
  const sourceLabel = r => r.source.sheetTitle+' · '+r.source.column+r.source.rowNo;
  const bankAccount = a => [a.bank,a.account].filter(Boolean).join(' · ') || '—';
  function form(title,command,fields,base={},description) {
    return ui.form({title,description,fields,onSubmit: values => ui.act(command,{...base,...values})});
  }
  const missing = (title,body,page,label) => ui.dialog(title,'<p>'+esc(body)+'</p>'+action(label,()=>{ui.close();ui.go(page);}));
  const methodFields = method => method === 'Tahil' ? [
    field('gramsPerTael','Gram setiap tahil mengikut terma','number',{min:0.000001,step:0.000001})
  ] : [];
  function newAgent() {
    ui.dialog('Kaedah harga ejen','<p>Pilih unit harga yang digunakan oleh ejen.</p>' +
      ['WeBuy','Tahil'].map(m => action(m === 'WeBuy' ? 'WeBuy · RM/g' : 'Tahil · RM/tahil',() => {
        ui.close();
        form('Daftar ejen · '+m,'agent.create',[
          field('name','Nama syarikat / ejen'),field('code','Kod ejen'),field('bank','Nama bank'),
          field('account','Nombor akaun bank'), ...methodFields(m)
        ],{method:m});
      })).join(' '));
  }
  function newFactory() {
    form('Daftar kilang','refinery.create',[
      field('name','Nama kilang'), field('code','Kod kilang'), ...methodFields('Tahil'),
      amount('advancePercent','Bayaran awal mengikut terma (%)',{min:0,max:100,value:90})
    ]);
  }
  function newRequest(agentId) {
    const agents = state().agents;
    if (!agents.length) return missing('Daftar ejen dahulu','Permohonan memerlukan rekod ejen penerima.','agents','Buka senarai ejen');
    form('Permohonan dana baharu','request.create',[
      select('agentId','Ejen penerima',agents.map(a => opt(a.id,a.name+(a.code?' · '+a.code:''))),{value:agentId || agents[0].id}),
      when('Tarikh permohonan'),amount('requested','Jumlah diminta (RM)'),field('purpose','Tujuan permohonan','textarea')
    ]);
  }
  function requestRows(rows,agentId) {
    const posted=state().transfers.filter(t=>t.historical && (!agentId || t.agentId===agentId));
    const refunds=agentId?[]:(state().refundRequests||[]);
    return list(['Rujukan','Tarikh','Penerima','Diminta','Dipindahkan','Baki belum dibelanjakan¹','Status'],[...newest(rows).map(r => {
      const t = funds(r.id);
      return [ref(r.id,'requests',r.id),ui.date(r.date),esc(agentName(r.agentId)),ui.rm(r.requested),ui.rm(t.transferred),money(t.available),tag(r.status)];
    }),...newest(refunds).map(r=>[ref(r.id,'requests',r.id),ui.date(r.date),esc(factoryName(r.refineryId)),money(r.requested),money(r.paidAmount),'—',tag(r.status)]),
      ...newest(posted).map(t=>[esc(sourceLabel(t))+' '+(t.requestId?ref(t.requestId,'requests',t.requestId):reconcile('transfers',t.id)),ui.date(t.date),esc(agentName(t.agentId)),'—',money(t.amount),'—',ui.badge('Duit keluar · lejar','neutral')])],'Belum ada permohonan dana.');
  }
  function bankForm(r,t,refund=false) {
    const maximum = refund ? t.refundable : transferLimit(r,t);
    form(refund?'Sahkan pemulangan dana':'Rekod pindahan kepada ejen',refund?'request.return':'request.transfer',[
      when(),amount('amount','Jumlah (RM)',{max:maximum,value:maximum.toFixed(2)}),
      field('bankRef','Rujukan transaksi bank'),upload('proof','Bukti transaksi bank')
    ],{requestId:r.id});
  }
  function approvedLimit(r) {
    return Math.round(r.approved*100) + state().supplements.filter(x => x.requestId === r.id && x.status === 'approved').reduce((z,x)=>z+Math.round(x.amount*100),0);
  }
  function transferLimit(r,t) {
    const remaining = Math.max(0,approvedLimit(r) - Math.round(t.transferred*100))/100;
    return state().purchases.some(p=>p.requestId===r.id) ? Math.min(remaining,t.payable) : remaining;
  }
  function requestControls(r,t,p) {
    const actions = [];
    if (r.status === 'pending' && director()) {
      actions.push(action('Luluskan permohonan',() => form('Luluskan permohonan','request.approve',[amount('approved','Jumlah diluluskan (RM)',{max:r.requested,value:r.requested})],{requestId:r.id}),'primary'));
      actions.push(action('Tolak',() => form('Tolak permohonan','request.reject',[field('reason','Sebab penolakan','textarea')],{requestId:r.id})));
    }
    if (['approved','active'].includes(r.status) && accountant() && transferLimit(r,t)>0) {
      const other=!p && priorExcess(state(),r);
      actions.push(other ? ref('Selesaikan lebihan '+other,'requests',other) : action('Rekod pindahan',()=>bankForm(r,t),'primary'));
    }
    if (r.status === 'active') {
      if (!p && t.balance>0) actions.push(action('Rekod belian',()=>ui.go('purchases',{new:true,requestId:r.id}),'primary'));
      if (accountant() && t.refundable>0 && (!p || p.invoiceStatus === 'confirmed')) actions.push(action('Rekod pemulangan',()=>bankForm(r,t,true)));
      const topup = (Math.round(t.payable*100) + Math.round(t.transferred*100) - approvedLimit(r))/100;
      if (p?.invoiceStatus === 'confirmed' && topup>0 && !state().supplements.some(x=>x.requestId===r.id && x.status==='pending'))
        actions.push(action('Mohon dana tambahan',()=>form('Mohon tambahan bayaran bil','request.supplement',[
          when(),amount('amount','Jumlah tambahan (RM)',{value:topup,max:topup}),field('reason','Sebab tambahan','textarea')
        ],{requestId:r.id})));
      if (ui.can('accountant') && t.balance === 0 && (!p || p.invoiceStatus === 'confirmed') && !state().supplements.some(x=>x.requestId===r.id && x.status==='pending'))
        actions.push(action('Tutup permohonan',()=>form('Tutup permohonan','request.close',[],{requestId:r.id},'Baki dana telah dipadankan. Sahkan untuk menutup permohonan ini.')));
    }
    return actions;
  }
  function invoicePanel(p) {
    if (!p) return '<p class="empty-note">Belian belum direkodkan.</p>';
    const actions = [];
    const t=funds(p.requestId);
    if (p.invoiceStatus !== 'confirmed') actions.push(action(p.invoiceFile?'Kemas kini invois':'Lampirkan invois',() => form('Invois pembekal','purchase.invoice',[
      field('invoiceNo','Nombor invois pembekal','text',{value:p.invoiceNo || ''}),when('Tarikh invois'),upload('invoiceFile','Salinan invois')
    ],{purchaseId:p.id})));
    if (p.invoiceStatus === 'submitted' && ui.can('accountant')) actions.push(action('Sahkan bil belian',()=>form('Sahkan bil belian','purchase.confirm',[when('Tarikh bil belian')],{purchaseId:p.id},
      'Padankan invois '+ui.rm(p.amount)+' dengan pindahan '+ui.rm(t.transferred)+' dan pemulangan '+ui.rm(t.returned)+'. Semak berat, mutu dan harga sebelum mengesahkan.'),'primary'));
    if (p.invoiceStatus === 'confirmed') actions.push(documentButton('Cetak bil belian','bill',p.id));
    const invoiceState = {pending:'Menunggu invois',submitted:'Menunggu semakan',confirmed:'Disahkan'};
    return details([['Lot emas',ref(p.id,'purchases',p.id)],['Pemilik',esc(p.owner)],['Berat asal',ui.g(p.weight)],['Mutu',p.purity==null?'—':esc(p.purity)+'‰'],
      ['Harga unit',p.price==null?'—':esc(p.price)+(p.method==='Tahil'?' RM/tahil':' RM/g')],['Nilai belian',money(p.amount)],
      ['No. invois pembekal',esc(p.invoiceNo || '—')],['Salinan invois',attachment(p.invoiceFile)],['Status bil',esc(invoiceState[p.invoiceStatus])],['Rujukan bil belian',esc(p.billNo || '—')]]) + actions.join(' ');
  }
  function requestDetail(r) {
    const s = state(), t = funds(r.id), p = s.purchases.find(p=>p.requestId===r.id);
    const payments = [
      ...s.transfers.filter(x=>x.requestId===r.id).map(x=>({...x,refund:false})),
      ...s.returns.filter(x=>x.requestId===r.id).map(x=>({...x,refund:true}))
    ].sort((a,b)=>String(b.date??'').localeCompare(String(a.date??'')));
    const extra = s.supplements.filter(x=>x.requestId===r.id);
    const controls = requestControls(r,t,p);
    controls.push(documentButton('Cetak borang','request',r.id));
    const a = s.agents.find(x=>x.id===r.agentId);
    let body = section('Ringkasan permohonan',details([
      ['Status',tag(r.status)],['Ejen',ref(a.name,'agents',a.id)],['Akaun penerima',esc(bankAccount(a))],
      ['Tarikh permohonan',ui.date(r.date)],['Tujuan',esc(r.purpose)],['Diminta',ui.rm(r.requested)],['Diluluskan termasuk tambahan',ui.rm(approvedLimit(r)/100)],
      ['Dipindahkan',ui.rm(t.transferred)],['Belian disahkan',ui.rm(t.purchased)],['Dipulangkan',ui.rm(t.returned)],
      ...(p && p.invoiceStatus!=='confirmed'?[['Belian menunggu pengesahan',money(t.pendingPurchase)]]:[]),
      [p && p.invoiceStatus!=='confirmed'?'Anggaran dana belum dibelanjakan':'Dana belum dibelanjakan',money(t.available)],
      ['Lebihan bil disahkan untuk dipulangkan',money(t.unreturnedExcess)],['Perlu dibayar kepada ejen',money(t.payable)],
      ...(r.reason ? [['Sebab keputusan',esc(r.reason)]]:[])
    ]));
    body += section('Belian & invois pembekal',invoicePanel(p));
    body += section('Transaksi bank',list(['Tarikh','Jenis','Rujukan bank','Jumlah','Bukti','Baucar'],payments.map(x=>[
      ui.date(x.date),x.refund?'Pemulangan':'Pindahan',esc(x.bankRef),ui.rm(x.amount),attachment(x.proof),
      x.refund?'—':ui.link(x.id,()=>ui.printDoc('voucher',x.id))
    ]),'Tiada transaksi bank direkodkan.'));
    if (extra.length) body += section('Kelulusan tambahan',list(['Tarikh','Jumlah','Sebab','Status','Tindakan'],extra.map(x=>[
      ui.date(x.date),ui.rm(x.amount),esc(x.reason),tag(x.status),
      x.status === 'pending' && director() ? ['Luluskan','Tolak'].map((label,i)=>action(label,()=>form(label+' permohonan tambahan',i?'request.supplementReject':'request.supplementApprove',[],{requestId:r.id,supplementId:x.id},x.id+' · '+ui.rm(x.amount)))).join(' ') : '—'
    ]),''));
    ui.show({title:r.id,subtitle:'Permohonan dana · '+a.name,actions:controls.join(' '),body});
  }
  function showRequests(params={}) {
    const r = state().requests.find(x=>x.id===params.id);
    if (r) return requestDetail(r);
    const refund=state().refundRequests?.find(r=>r.id===params.id);
    if(refund) return refundDetail(refund);
    ui.show({title:'Permohonan dana',subtitle:'Kelulusan, pindahan dan baki bagi setiap permohonan.',actions:action('Permohonan baharu',()=>newRequest(),'primary'),
      body:section('Senarai permohonan',requestRows(state().requests)+(state().requests.length?'<small>¹ Baki mengambil kira pemulangan dan semua belian direkodkan. Baki sebelum pengesahan bil ialah anggaran.</small>':''))});
    if (params.new) {params.new=false;newRequest(params.agentId);}
  }
  function refundDetail(r) {
    const base={refundRequestId:r.id,saleId:r.saleId},controls=[documentButton('Cetak borang','request',r.id)];
    if(r.status==='pending' && director()) {
      controls.push(action('Luluskan permohonan',()=>form('Luluskan pemulangan kilang','sale.refundApprove',[amount('approved','Jumlah diluluskan (RM)',{value:r.requested,max:r.requested})],base),'primary'));
      controls.push(action('Tolak',()=>form('Tolak permohonan pemulangan','sale.refundReject',[field('reason','Sebab penolakan','textarea')],base)));
    }
    if(r.status==='approved' && accountant()) controls.push(action('Rekod pemulangan bank',()=>form('Pemulangan kepada kilang','sale.refund',[
      when(),amount('amount','Jumlah diluluskan (RM)',{min:r.approved,max:r.approved,value:r.approved}),field('bankRef','Rujukan transaksi bank'),upload('proof','Bukti bayaran balik')
    ],base),'primary'));
    const paid=state().receipts.find(x=>x.id===r.receiptId);
    if(paid) controls.push(documentButton('Cetak baucar','voucher',paid.id));
    ui.show({title:r.id,subtitle:'Payment Request · Pemulangan kepada kilang',actions:controls.join(' '),body:section('Butiran permohonan',details([
      ['Kilang',ref(factoryName(r.refineryId),'refineries',r.refineryId)],['Invois',ref(r.saleId,'sales',r.saleId)],['Tujuan',esc(r.purpose)],['Tarikh',ui.date(r.date)],['Status',tag(r.status)],
      ['Diminta',money(r.requested)],['Diluluskan',money(r.approved)],...(r.reason?[['Sebab',esc(r.reason)]]:[]),
      ...(paid?[['Dibayar',money(r.paidAmount)],['Tarikh bayaran',ui.date(paid.date)],['Rujukan bank',esc(paid.bankRef)],['Bukti bayaran',attachment(paid.proof)]]:[])
    ]))});
  }

  function showAgents(params={}) {
    const s=state(), a=s.agents.find(x=>x.id===params.id);
    if (a) {
      const rs=s.requests.filter(x=>x.agentId===a.id), ps=s.purchases.filter(x=>x.agentId===a.id);
      const ds=s.deliveries.filter(d=>d.lotIds.some(id=>ps.some(p=>p.id===id)));
      const totals=rs.map(r=>funds(r.id));
      const sum=key=>totals.some(t=>t[key]==null)?null:totals.reduce((n,t)=>n+Math.round(t[key]*100),0)/100;
      const credits=(s.supplierCredits||[]).filter(c=>c.agentId===a.id);
      ui.show({title:a.name,subtitle:'Profil ejen'+(a.code?' · '+a.code:''),actions:[action('Mohon dana',()=>newRequest(a.id),'primary'),documentButton('Penyata akaun','supplierSOA',a.id)].join(' '),
        body:section('Maklumat ejen',details([['Kod',esc(a.code||'—')],['Kaedah harga',esc(a.method||'—')],['Gram setiap tahil',a.gramsPerTael?esc(a.gramsPerTael):'—'],
          ['Akaun bank',esc(bankAccount(a))],...(a.sourceBalances||[]).map(b=>['Baki lejar · '+b.sheetTitle,money(b.value)]),
          ...(!a.sourceBalances?.length || rs.length?[['Dana belum dibelanjakan (anggaran jika bil belum disahkan)',money(sum('available'))],['Lebihan disahkan untuk dipulangkan',money(sum('unreturnedExcess'))],['Perlu dibayar kepada ejen',money(sum('payable'))]]:[])])) +
          section('Permohonan & pembayaran',requestRows(rs,a.id))+
          (credits.length?section('Duit masuk / invois pada lejar',list(['Sumber','Tarikh','Amaun','Padanan'],newest(credits).map(c=>[esc(sourceLabel(c)),ui.date(c.date),money(c.amount),reconcile('supplierCredits',c.id)]),'')):'')+
          section('Sejarah belian',list(['Lot','Tarikh','Pemilik','Berat','Nilai'],newest(ps).map(p=>[ref(p.id,'purchases',p.id),ui.date(p.date),esc(p.owner),p.weight==null?'—':ui.g(p.weight),money(p.amount)]),'Tiada belian.'))+
          section('Penghantaran',list(['Rujukan','Tarikh','Lot milik ejen'],newest(ds).map(d=>[ref(d.id,'deliveries',d.id),ui.date(d.date),d.lotIds.filter(id=>ps.some(p=>p.id===id)).map(esc).join(', ')]),'Tiada penghantaran.'))});
      return;
    }
    ui.show({title:'Ejen & pembekal',subtitle:'Maklumat bank, kaedah harga dan sejarah ejen.',actions:action('Daftar ejen',newAgent,'primary'),
      body:section('Senarai ejen',list(['Nama syarikat / ejen','Kod','Kaedah harga','Bank','Lebihan disahkan'],s.agents.map(a=>[
        ref(a.name,'agents',a.id),esc(a.code||'—'),esc(a.method||'—'),esc(a.bank||'—'),
        a.sourceBalances?.length && !s.requests.some(r=>r.agentId===a.id)?'—':ui.rm(s.requests.filter(r=>r.agentId===a.id).reduce((n,r)=>n+Math.round(funds(r.id).unreturnedExcess*100),0)/100)
      ]),'Belum ada ejen. Daftar ejen untuk memulakan permohonan dana.'))});
    if (params.new) {params.new=false;newAgent();}
  }
  function newSale(shipmentId) {
    const s=state(), ready=s.dispatches.filter(x=>!x.prOnly && !s.sales.some(y=>y.shipmentId===x.id));
    if (!ready.length) return missing('Tiada penghantaran untuk diinvois','Rekod penghantaran ke kilang sebelum membuka invois jualan.','shipments','Buka penghantaran kilang');
    const chosen = ready.find(x=>x.id===shipmentId);
    if (!chosen) {
      ui.dialog('Pilih penghantaran kilang',list(['Penghantaran','Kilang','Berat'],ready.map(x=>[
        ui.link(x.id,()=>{ui.close();newSale(x.id);}),esc(factoryName(x.refineryId)),ui.g(x.weight)
      ]),''));
      return;
    }
    const refinery=s.refineries.find(x=>x.id===chosen.refineryId);
    if(!refinery.gramsPerTael)return missing('Terma kilang belum lengkap','Lengkapkan rekod kilang menggunakan nama yang sama dan kadar gram setiap tahil yang dipersetujui.','refineries','Buka senarai kilang');
    form('Invois jualan kilang','sale.create',[when('Tarikh invois'),
      field('weight','Berat untuk harga (g)','number',{min:0.001,step:0.001,value:chosen.weight}),
      field('price','Harga jualan (RM/tahil)','number',{min:0.0001,step:0.0001})],{shipmentId:chosen.id},
      chosen.id+' · '+refinery.name+'. Nilai = berat ÷ '+refinery.gramsPerTael+' g/tahil × harga setiap tahil.');
  }
  const allocations=()=> (state().goldAllocations||[]).filter(x=>x.role==='refinery');
  function saleRows(rows,refineryId) {
    const receipts=state().receipts.filter(r=>r.historical && (!refineryId || r.refineryId===refineryId));
    const prices=allocations().filter(a=>!refineryId || a.refineryId===refineryId);
    const hasHistory=receipts.length||prices.length||rows.some(r=>r.historical);
    const header=[hasHistory?'Rujukan':'Invois','Tarikh','Kilang',hasHistory?'Nilai (RM)':'Jualan bersih','Diterima','Baki','Status'];
    return list(header,[...newest(rows).map(x=>{
      const t=saleTotals(state(),x.id);
      return [ref(x.invoiceNo || (x.historical?sourceLabel(x):x.id),'sales',x.id),ui.date(x.date),esc(factoryName(x.refineryId)),money(t.net??x.documentAmount),money(t.received),money(t.outstanding),tag(x.status)];
    }),...newest(receipts).map(r=>[esc(sourceLabel(r))+' '+(r.saleId?ref(r.saleId,'sales',r.saleId):reconcile('receipts',r.id)),ui.date(r.date),esc(factoryName(r.refineryId)),'—',money(r.amount),'—',ui.badge('Bayaran masuk lejar','neutral')]),
      ...newest(prices).map(a=>[ref(sourceLabel(a),'sales',a.id),ui.date(a.sourceDate),esc(factoryName(a.refineryId)),money(a.amount),'—','—',ui.badge('Harga emas kilang','neutral')])],'Belum ada invois jualan.');
  }
  function sourceSale(x) {
    const pricing=allocations().filter(a=>x.allocationIds?.includes(a.id));
    const t=saleTotals(state(),x.id);
    ui.show({title:x.invoiceNo||x.id,subtitle:'Invois sumber · '+factoryName(x.refineryId),actions:reconcile('sales',x.id),
      body:section('Nilai jualan & penyelesaian',details([
        ['Status',tag(x.status)],['Kilang',ref(factoryName(x.refineryId),'refineries',x.refineryId)],
        ['Catatan sumber',esc(sourceLabel(x))],['Tarikh catatan',ui.date(x.date)],['Nilai invois pada lejar',money(x.amount)],
        ...(x.invoiceNo?[['Nombor invois',esc(x.invoiceNo)],['Nilai pada dokumen sumber',money(x.documentAmount)]]:[]),
        ['Bayaran dipadankan',money(t.received)],['Baki invois disahkan',money(t.outstanding)]
      ])) + (pricing.length?section('Lot & semakan',list(['Baris harga','Berat diperuntuk','Harga (RM/g)','Nilai'],pricing.map(a=>[
        ref(sourceLabel(a),'sales',a.id),a.allocatedWeight==null?'—':ui.g(a.allocatedWeight),esc(a.price??'—'),money(a.amount)
      ]),'')):'')});
  }
  function sourcePrice(a) {
    ui.show({title:sourceLabel(a),subtitle:'Harga emas kilang · '+factoryName(a.refineryId),
      body:section('Nilai emas pada lejar',details([
        ['Kilang',ref(factoryName(a.refineryId),'refineries',a.refineryId)],['Pemilik',esc(a.owner??'—')],
        ['Tarikh emas',ui.date(a.sourceDate)],['Lot',a.lotId?ref(a.lotId,'purchases',a.lotId):'—'],
        ['Rujukan assay',esc(a.sourceAssayRef??'—')],['Berat diperuntuk',a.allocatedWeight==null?'—':ui.g(a.allocatedWeight)],
        ['Harga segram (RM)',esc(a.price??'—')],['Nilai harga',money(a.amount)]
      ]))});
  }
  function saleDetail(x) {
    if(x.historical && !x.operationalReady)return sourceSale(x);
    const s=state(), t=saleTotals(s,x.id), receipts=s.receipts.filter(r=>r.saleId===x.id);
    const advance=advanceLimit(x), maximum=receiptLimit(s,x);
    const controls = x.historical ? [reconcile('sales',x.id)] : [];
    if (accountant() && maximum > 0) controls.push(action('Rekod bayaran diterima',()=>form('Bayaran daripada kilang','sale.receive',[
      when(),amount('amount','Jumlah diterima (RM)',{max:maximum,value:maximum.toFixed(2)}),
      field('bankRef','Rujukan transaksi bank'),upload('proof','Bukti bayaran')
    ],{saleId:x.id}),'primary'));
    const refunds=(s.refundRequests||[]).filter(r=>r.saleId===x.id);
    if(x.status==='final' && t.outstanding<0 && !refunds.some(r=>['pending','approved'].includes(r.status))) {
      controls.push(action('Mohon pemulangan kepada kilang',()=>form('Payment Request · Pemulangan kepada kilang','sale.refundRequest',[
        when('Tarikh permohonan'),amount('amount','Jumlah diminta (RM)',{max:-t.outstanding,value:(-t.outstanding).toFixed(2)}),field('purpose','Tujuan pemulangan','textarea')
      ],{saleId:x.id}),'primary'));
    }
    for(const r of refunds) controls.push(ref(r.id+' · '+statuses[r.status][0],'requests',r.id));
    const assaysReady=x.lotIds.every(id=>saleAssay(s,x,id));
    const lots=x.lotIds.map(id=>saleLot(s,id)).filter(Boolean);
    const billsReady=x.lotIds.length>0 && x.lotIds.every(id=>saleLot(s,id)?.confirmed);
    if (accountant() && x.status==='provisional' && assaysReady && billsReady && (!x.historical || x.settlementVerified)) controls.push(action('Muktamadkan jualan',()=>form('Pengesahan akhir jualan','sale.finalize',[
      when('Tarikh pengesahan'),amount('adjustment','Pelarasan selepas assay (RM)',{min:-x.amount,value:0,help:'Masukkan tanda negatif bagi pengurangan.'}),
      amount('directCost','Kos langsung transaksi (RM)',{min:0,value:0}),field('note','Pengesahan harga, assay & pelarasan','textarea')
    ],{saleId:x.id})));
    controls.push(documentButton('Cetak invois','sale',x.id));
    ui.show({title:x.id,subtitle:'Invois jualan · '+factoryName(x.refineryId),actions:controls.join(' '),
      body:section('Nilai jualan & penyelesaian',details([
        ['Status',tag(x.status)],['Kilang',ref(factoryName(x.refineryId),'refineries',x.refineryId)],['Penghantaran',ref(x.shipmentId,'shipments',x.shipmentId)],
        ['Tarikh invois',ui.date(x.date)],['Harga setiap tahil',esc(x.price)+' RM/tahil'],['Faktor tahil',esc(x.gramsPerTael)+' g/tahil'],
        ['Berat penetapan harga',ui.g(x.weight)],['Nilai sebelum pelarasan',ui.rm(x.amount)],['Bayaran awal ('+x.advancePercent+'%)',ui.rm(advance)],
        ['Pelarasan assay',ui.rm(x.adjustment)],['Jualan bersih',ui.rm(t.net)],['Penerimaan bersih',money(t.received)],
        [t.outstanding<0?'Lebihan perlu dipulangkan kepada kilang':'Baki belum diterima',t.outstanding==null?'Belum dipadankan':ui.rm(Math.abs(t.outstanding))],
        ['Kos belian',money(t.cost)],['Kos langsung',ui.rm(t.directCost)],[x.status==='final'?'Untung kasar muktamad':'Anggaran untung kasar',money(t.profit)],
        ...(x.finalDate?[['Tarikh muktamad',ui.date(x.finalDate)],['Catatan semakan',esc(x.note)]]:[])
      ]))+
      section('Lot & semakan',list(['Lot','Pemilik','Berat asal','Bil / kos','Assay'],lots.map(({lot,reference})=>[ref(lot.id,'purchases',lot.id),esc(lot.owner),ui.g(lot.weight),esc(reference||'Belum disahkan'),
        esc(saleAssay(s,x,lot.id)?.reportNo||'Menunggu pengesahan assay')]),'Tiada lot.'))+
      section('Transaksi bank kilang',list(['Rujukan','Tarikh','Jenis','Rujukan bank','Jumlah','Bukti'],newest(receipts).map(r=>[esc(r.id),ui.date(r.date),r.kind==='refund'?'Dipulangkan':'Diterima',esc(r.bankRef),ui.rm(Math.abs(r.amount)),attachment(r.proof)]),'Tiada bayaran direkodkan.'))});
  }
  function showSales(params={}) {
    const x=state().sales.find(s=>s.id===params.id);
    if (x) return saleDetail(x);
    const price=allocations().find(a=>a.id===params.id);
    if(price)return sourcePrice(price);
    ui.show({title:'Jualan & bayaran kilang',subtitle:'Invois jualan, bayaran awal dan baki selepas assay.',actions:action('Invois jualan baharu',()=>newSale(),'primary'),
      body:section('Senarai jualan',saleRows(state().sales))});
    if (params.new) {params.new=false;newSale(params.shipmentId);}
  }
  function showFactories(params={}) {
    const s=state(), f=s.refineries.find(r=>r.id===params.id);
    if (f) {
      const shipped=s.dispatches.filter(x=>x.refineryId===f.id);
      ui.show({title:f.name,subtitle:'Profil kilang'+(f.code?' · '+f.code:''),actions:documentButton('Penyata akaun','refinerySOA',f.id),
        body:section('Terma kilang',details([['Kod',esc(f.code??'—')],['Kaedah harga','Tahil'],['Gram setiap tahil',esc(f.gramsPerTael??'—')],['Kadar bayaran awal',f.advancePercent==null?'—':esc(f.advancePercent)+'%'],
          ...(f.sourceBalances||[]).map(b=>['Baki lejar · '+b.sheetTitle,money(b.value)])]))+
        section('Penghantaran',list(['Rujukan','Tarikh','Lot','Berat'],newest(shipped).map(x=>[ref(x.id,'shipments',x.id),ui.date(x.date),esc(x.lotIds.length),ui.g(x.weight)]),'Tiada penghantaran.'))+
        section('Jualan & penyelesaian',saleRows(s.sales.filter(x=>x.refineryId===f.id),f.id))});
      return;
    }
    ui.show({title:'Kilang',subtitle:'Terma harga dan bayaran setiap kilang.',actions:action('Daftar kilang',newFactory,'primary'),
      body:section('Senarai kilang',list(['Nama kilang','Kod','Gram/tahil','Bayaran awal'],s.refineries.map(f=>[
        ref(f.name,'refineries',f.id),esc(f.code??'—'),esc(f.gramsPerTael??'—'),f.advancePercent==null?'—':esc(f.advancePercent)+'%'
      ]),'Belum ada kilang berdaftar.'))});
    if (params.new) {params.new=false;newFactory();}
  }
  function newEinvoice() {
    const s=state(), options=[
      ...s.purchases.filter(p=>p.invoiceStatus==='confirmed').map(p=>opt(p.id,p.billNo+' · '+agentName(p.agentId))),
      ...s.sales.filter(x=>x.status==='final').map(x=>opt(x.id,x.id+' · '+factoryName(x.refineryId)))
    ];
    if (!options.length) return ui.dialog('Belum ada transaksi disahkan','<p>Sahkan bil pembelian atau muktamadkan jualan untuk memautkan rekod e-Invois.</p>');
    ui.form({title:'Rekod e-Invois',description:'Salin rujukan dan status daripada dokumen MyInvois.',fields:[
      select('source','Transaksi sumber',options),field('reference','UUID / rujukan e-Invois'),when('Tarikh status'),
      select('status','Status pada dokumen',['submitted','validated','rejected','cancelled'].map(k=>opt(k,statuses[k][0]))),upload('file','Dokumen e-Invois')
    ],onSubmit:v=>{const {source,...rest}=v;return ui.act('einvoice.record',{...rest,[s.purchases.some(p=>p.id===source)?'purchaseId':'saleId']:source});}});
  }
  function showEinvoices(params={}) {
    const items=state().einvoices;
    const item=items.find(x=>x.id===params.id);
    if (item) {
      ui.show({title:item.reference,subtitle:'Rekod e-Invois · '+item.id,actions:documentButton('Cetak rekod','einvoice',item.id),body:section('Maklumat e-Invois',details([
        ['Tarikh',ui.date(item.date)],['Status',tag(item.status)],['Transaksi sumber',ref(item.purchaseId || item.saleId,item.purchaseId?'purchases':'sales',item.purchaseId||item.saleId)],
        ['Dokumen asal',attachment(item.file)]
      ]))});
      return;
    }
    ui.show({title:'e-Invois',subtitle:'Rujukan dan salinan dokumen MyInvois bagi belian dan jualan.',actions:accountant()?action('Rekod e-Invois',newEinvoice,'primary'):'',
      body:section('Rekod e-Invois',list(['Rujukan e-Invois','Tarikh','Transaksi','Status','Dokumen'],newest(items).map(e=>[
        ref(e.reference,'einvoices',e.id),ui.date(e.date),ref(e.purchaseId||e.saleId,e.purchaseId?'purchases':'sales',e.purchaseId||e.saleId),tag(e.status),attachment(e.file)
      ]),'Belum ada rekod e-Invois.'))});
    if (params.new && accountant()) {params.new=false;newEinvoice();}
  }
  for (const [key,fn] of Object.entries({agents:showAgents,refineries:showFactories,requests:showRequests,sales:showSales,einvoices:showEinvoices})) ui.page(key,fn);
}
