import {requestTotals, saleTotals} from './ledger.mjs';
// Amounts in the ledger are ringgit. Round each cash movement to sen before summing.
export const money = value => value == null ? '—' : 'RM ' + Number(value).toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const grams = value => value == null ? '—' : Number(value).toLocaleString('en-MY', {minimumFractionDigits: 3, maximumFractionDigits: 3}) + ' g';
export const fmtDate = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0,10).split('-').reverse().join('/') : (value || '—');
const cents = v => Math.round((Number(v) || 0) * 100);
const labels = {pending:'Menunggu',submitted:'Menunggu semakan',confirmed:'Disahkan',approved:'Diluluskan',active:'Aktif',closed:'Selesai',rejected:'Ditolak',sent:'Dalam penghantaran',received:'Diterima',provisional:'Sementara',final:'Muktamad',draft:'Draf',validated:'Disahkan',cancelled:'Dibatalkan',invalid:'Tidak sah',paid:'Dibayar'};
Object.assign(labels,{historical:'Direkod dalam lejar',recorded:'Direkod dalam lejar',unknown:'Belum disahkan','source-document':'Dokumen sumber'});
export const fromLedger=r=>Boolean(r?.historical||r?.imported);
export const ledgerOnly=r=>fromLedger(r)&&!r.operationalReady;
const purchaseDate=p=>ledgerOnly(p)&&p.dateBasis==='goldLedgerDate'?null:p.date;
export function sourceRef(r){
  const source=r?.source;
  if(!source)return '';
  const title=source.sheetTitle||source.title||source.sheetId;
  const range=source.rowNo!=null?String(source.column||'').split(':').map(c=>c+source.rowNo).join(':'):'';
  return [title,range].filter(Boolean).join('!');
}
export function stockPosition(state){
  const shipments=state.dispatches.filter(d=>!d.prOnly),exported=new Set(shipments.flatMap(d=>d.lotIds||[]));
  const held=state.deliveries.filter(d=>d.status==='received').flatMap(d=>(d.lotIds||[]).filter(id=>!exported.has(id)).map(id=>({id,weight:d.receivedWeights?.[id]})));
  const unknown=state.purchases.some(p=>ledgerOnly(p)&&!exported.has(p.id)&&!held.some(h=>h.id===p.id))
    || state.assays.some(a=>fromLedger(a)&&!shipments.some(d=>d.id===a.dispatchId));
  const verified=held.filter(p=>Number.isFinite(p.weight));
  const knownWeight=verified.reduce((sum,p)=>sum+Math.round(p.weight*1000),0)/1000;
  return {held,knownWeight,unknown:unknown||verified.length!==held.length};
}
export const statusText = code => labels[code] || code || '—';
const cmp = (a,b) => String(a).localeCompare(String(b),'ms');
const uniq = a => [...new Set(a.filter(v => v != null && v !== ''))];
const defaultCols = [['id','Rujukan'],['date','Tarikh','date']];
const col = (key,label,type) => [key,label,type];
const def = (name,group,cols) => ({name,group,cols:[...defaultCols,...cols]});
export const reportTypes = {
  requests:def('Permohonan bayaran','Kewangan',[col('agent','Ejen'),col('requested','Diminta','rm'),col('approved','Diluluskan','rm'),col('transferred','Dipindahkan','rm'),col('status','Status')]),
  funds:def('Baki dana ejen','Kewangan',[col('agent','Ejen'),col('transferred','Dipindahkan','rm'),col('purchased','Belian disahkan','rm'),col('pendingPurchase','Belian belum disahkan','rm'),col('returned','Dipulangkan','rm'),col('available','Dana masih tersedia (anggaran)','rm'),col('unreturnedExcess','Lebihan selepas bil disahkan','rm'),col('payable','Perlu dibayar','rm')]),
  purchases:def('Pembelian emas','Emas',[col('agent','Ejen'),col('owner','Pemilik'),col('weight','Berat asal','g'),col('purity','Mutu (‰)'),col('amount','Nilai belian','rm'),col('invoiceNo','Invois pembekal'),col('status','Status invois')]),
  deliveries:def('Penghantaran emas','Emas',[col('kind','Peringkat'),col('owners','Senarai pemilik'),col('refinery','Kilang'),col('weight','Berat dihantar','g'),col('measured','Berat diterima','g'),col('status','Status')]),
  owners:def('Pemilikan dan jejak lot','Emas',[col('owner','Pemilik'),col('agent','Ejen'),col('weight','Berat asal','g'),col('weightAfter','Selepas proses','g'),col('deliveryId','Penghantaran'),col('dispatchId','Ke kilang'),col('refinery','Kilang'),col('status','Lokasi / status')]),
  processing:def('Proses tarik dan susut','Emas',[col('owner','Pemilik'),col('lotId','Lot'),col('before','Sebelum','g'),col('after','Selepas','g'),col('loss','Susut','g'),col('operator','Pengendali'),col('status','Proses')]),
  locks:def('MKS Lock','Emas',[col('lotId','Lot'),col('agent','Ejen'),col('owner','Pemilik'),col('number','No. MKS'),col('dateTime','Masa lock'),col('price','Harga lock (RM/g)','rate'),col('weight','Berat dikunci','g'),col('unfilled','Berat belum lock','g'),col('status','Status')]),
  assays:def('Keputusan assay','Emas',[col('owner','Pemilik'),col('lotId','Lot'),col('prNo','No. PR'),col('reportNo','No. laporan'),col('before','Sebelum','g'),col('after','Selepas','g'),col('variance','Perbezaan','g'),col('purity','Mutu (‰)')]),
  pending:def('Assay belum diterima','Emas',[col('owner','Pemilik'),col('dispatchId','Penghantaran kilang'),col('refinery','Kilang'),col('prNo','No. PR'),col('weight','Berat dihantar','g'),col('status','Status')]),
  supplierSOA:def('Penyata akaun pembekal','Kewangan',[col('agent','Ejen'),col('kind','Transaksi'),col('requestId','Permohonan'),col('inc','Dana diberi','rm'),col('dec','Bil / pulangan','rm'),col('balance','Baki dana ejen','rm')]),
  refinerySOA:def('Penyata akaun kilang','Kewangan',[col('refinery','Kilang'),col('kind','Transaksi'),col('saleId','Invois jualan'),col('inc','Nilai invois','rm'),col('dec','Diterima','rm'),col('balance','Baki kilang','rm')]),
  movements:def('Pergerakan stok','Emas',[col('lotId','Lot'),col('owner','Pemilik'),col('kind','Pergerakan'),col('origin','Dari'),col('destination','Ke'),col('weight','Berat','g')]),
  outstanding:def('Bayaran tertunggak','Kewangan',[col('kind','Arah bayaran'),col('party','Pihak berkaitan'),col('outstanding','Belum selesai','rm'),col('status','Status')]),
  trading:def('Jualan dan belian','Kewangan',[col('kind','Jenis'),col('party','Pihak berkaitan'),col('purchased','Belian','rm'),col('net','Jualan bersih','rm'),col('status','Status')]),
  profit:def('Untung rugi transaksi','Kewangan',[col('refinery','Kilang'),col('net','Jualan bersih','rm'),col('cost','Kos belian','rm'),col('directCost','Kos langsung','rm'),col('profit','Untung kasar','rm'),col('status','Pengiraan')]),
  periods:{name:'Transaksi harian, mingguan dan bulanan',group:'Ringkasan',cols:[col('period','Tempoh'),col('count','Transaksi'),col('operations','Operasi emas'),col('requests','Diminta','rm'),col('transfers','Diberi kepada ejen','rm'),col('purchases','Belian direkod','rm'),col('returns','Pulangan ejen','rm'),col('sales','Jualan bersih','rm'),col('receipts','Terimaan kilang','rm')]},
};

export function indexState(s) {
  const arr = k => s[k] || [];
  const map = k => new Map(arr(k).map(r => [r.id,r]));
  const agents=map('agents'), refineries=map('refineries'), requests=map('requests'), lots=map('purchases'), sales=map('sales'), assays=new Map(arr('assays').map(a=>[a.lotId,a]));
  for(const lot of arr('custodyLots'))lots.set(lot.id,lot);
  const byLot = records => new Map(records.flatMap(r => (r.lotIds || []).map(id=>[id,r])));
  const deliveries=byLot(arr('deliveries')), dispatches=byLot(arr('dispatches').filter(d=>!d.prOnly)), prByLot=byLot(arr('dispatches').filter(d=>d.prOnly));
  const lotRows = ids => (ids || []).map(id=>lots.get(id)).filter(Boolean);
  const saleLots = r => lotRows(r.lotIds || arr('dispatches').find(d=>d.id===r.shipmentId)?.lotIds);
  const related=new Map();
  function associate(id,refs){
    if(!id)return;
    const previous=related.get(id)||[];
    related.set(id,uniq([...previous,...refs]));
  }
  for(const l of lots.values()){
    const del=deliveries.get(l.id), dis=dispatches.get(l.id), pr=prByLot.get(l.id), assay=assays.get(l.id);
    const locks=l.locks?.length?l.locks:l.lock?[l.lock]:[];
    associate(l.id,[l.id,l.requestId,l.invoiceNo,l.billNo,sourceRef(l),l.process?.id,del?.id,dis?.id,dis?.prNo,pr?.id,pr?.prNo,assay?.id,assay?.prNo,assay?.reportNo,...locks.flatMap(k=>[k.id,k.number])]);
  }
  for(const r of [...arr('transfers'),...arr('returns'),...arr('supplements')])associate(r.requestId,[r.id,r.bankRef,sourceRef(r)]);
  for(const r of arr('receipts'))associate(r.saleId,[r.id,r.bankRef,sourceRef(r)]);
  for(const q of arr('refundRequests'))associate(q.saleId,[q.id,q.receiptId]);
  for(const sale of sales.values())for(const lot of saleLots(sale))associate(lot.id,[sale.id,sale.invoiceNo,...(related.get(sale.id)||[])]);
  function fund(r) {
    return requestTotals(s,r.id);
  }
  function settlement(r) {
    return saleTotals(s,r.id);
  }
  const agent = id => agents.get(id)?.name || id || '—';
  const refinery = id => refineries.get(id)?.name || id || '—';
  const meta = (record, records=[], agentId, refineryId) => ({
    agentIds:uniq([agentId,...records.map(l=>l.agentId)]),
    refineryIds:uniq([refineryId,...records.map(l=>dispatches.get(l.id)?.refineryId||prByLot.get(l.id)?.refineryId)]),
    refs:uniq([record.id,sourceRef(record),record.invoiceNo,record.requestId,record.saleId,record.shipmentId,record.dispatchId,record.reference,record.prNo,record.reportNo,...(related.get(record.id)||[]),...records.flatMap(l=>[...(related.get(l.id)||[]),...(related.get(l.requestId)||[])])]),
  });
  return {arr,agents,refineries,requests,lots,sales,assays,deliveries,dispatches,prByLot,lotRows,saleLots,fund,settlement,agent,refinery,meta};
}

export function makeRows(s, type) {
  const i=indexState(s);
  const requestLots=id=>id?i.arr('purchases').filter(l=>l.requestId===id):[];
  const rm=statusText;
  const lotInfo=l=>{
    const del=i.deliveries.get(l.id),dis=i.dispatches.get(l.id),assay=i.assays.get(l.id);
    return {...l,...i.meta(l,[l],l.agentId,l.refineryId||assay?.refineryId),date:purchaseDate(l),agent:i.agent(l.agentId),weightAfter:l.process?.after??(ledgerOnly(l)?null:l.weight),deliveryId:del?.id,dispatchId:dis?.id,refinery:i.refinery(dis?.refineryId||l.refineryId||assay?.refineryId),status:assay&&!ledgerOnly(l)?'Selesai assay':dis?'Di kilang':del?.status==='received'?'Stok Ariffin Jewels':del?'Dalam penghantaran':ledgerOnly(l)?'Lokasi belum disahkan':'Dengan ejen'};
  };
  const saleInfo=r=>({...r,...i.settlement(r),...i.meta(r,i.saleLots(r),null,r.refineryId),refinery:i.refinery(r.refineryId),status:rm(r.status)});
  const requestInfo=r=>({...r,...i.fund(r),...i.meta(r,requestLots(r.id),r.agentId),agent:i.agent(r.agentId),status:rm(r.status)});
  const delInfo=(d,factory)=>{
    const lots=i.lotRows(d.lotIds);
    if(d.prOnly)return {...d,...i.meta(d,lots,null,d.refineryId),date:d.prDate||null,kind:'PR kilang',owners:uniq(lots.map(l=>l.owner)).join(', '),refinery:i.refinery(d.refineryId),measured:null,status:'PR direkod · penghantaran belum disahkan'};
    return {...d,...i.meta(d,lots,null,d.refineryId),kind:factory?'Ke kilang':'Ke Ariffin Jewels',owners:uniq(lots.map(l=>l.owner)).join(', '),refinery:i.refinery(d.refineryId),measured:d.status==='received'?Object.values(d.receivedWeights||{}).reduce((a,n)=>a+Number(n),0):null,status:factory?(d.prNo?'PR diterima':'Menunggu PR'):rm(d.status)};
  };
  const postedSales=i.arr('sales').filter(r=>!r.historicalDocumentOnly);
  const bankRow=r=>{
    const q=i.requests.get(r.requestId), agentId=q?.agentId||r.agentId;
    return {...r,...i.meta(r,requestLots(r.requestId),agentId),agent:i.agent(agentId),accountId:agentId,status:fromLedger(r)?rm('historical'):'Direkod'};
  };
  const receiptRow=r=>{
    const sale=i.sales.get(r.saleId)||{},refineryId=sale.refineryId||r.refineryId;
    return {...r,...i.meta(r,i.saleLots(sale),null,refineryId),refinery:i.refinery(refineryId),accountId:refineryId,status:fromLedger(r)?rm('historical'):'Direkod'};
  };
  const sourceCredits=i.arr('supplierCredits'),historicalCredits=sourceCredits.filter(r=>r.classification!=='purchase-invoice');
  const sourceBills=sourceCredits.filter(r=>r.classification==='purchase-invoice').map(r=>{
    const lot=i.lots.get(r.lotId);
    return {...bankRow(r),...i.meta(r,lot?[lot]:[],r.agentId),kind:'Kredit dipadankan kepada invois · rujukan',sourceInvoiceAmount:r.amount,status:'Dipadankan kepada bil'};
  });
  if(type==='requests')return [...i.arr('requests').map(r=>({...requestInfo(r),kind:'Dana pembelian'})),...i.arr('refundRequests').map(r=>({...r,...i.meta(r,i.saleLots(i.sales.get(r.saleId)||{}),null,r.refineryId),refinery:i.refinery(r.refineryId),kind:'Pemulangan kredit kilang',transferred:r.paidAmount??0,status:rm(r.status)}))];
  if(type==='funds')return [...i.arr('requests').map(requestInfo),
    ...i.arr('transfers').filter(r=>fromLedger(r)&&!r.requestId).map(r=>({...bankRow(r),transferred:r.amount})),
    ...historicalCredits.map(r=>({...bankRow(r),unclassified:r.amount})),...sourceBills,
  ];
  if(type==='purchases') return i.arr('purchases').map(l=>({...lotInfo(l),status:rm(l.invoiceStatus)}));
  if(type==='owners') return [...i.lots.values()].map(lotInfo);
  if(type==='processing') return [...i.lots.values()].filter(l=>l.process).map(l=>({...lotInfo(l),...l.process,id:l.process.id,lotId:l.id,date:l.process.date||null,status:l.process.mode==='tarik'?'Tarik':l.process.mode==='skip'?'Tidak tarik':'Timbangan separa'}));
  if(type==='locks')return [...i.arr('purchases').flatMap(l=>{
    const entries=l.locks?.length?l.locks:(l.lock?[l.lock]:[]);
    const base={...lotInfo(l),lotId:l.id};
    const rows=entries.filter(k=>!i.arr('locks').some(source=>source.id===k.id)).map(k=>({...base,...k,date:k.dateTime?.slice(0,10)||k.date||null,status:'Dikunci'}));
    if(ledgerOnly(l)||l.weight==null)return rows;
    const unfilled=(Math.round(l.weight*1000)-entries.reduce((n,k)=>n+Math.round(k.weight*1000),0))/1000;
    if(unfilled>0)rows.push({...base,price:null,weight:null,unfilled,status:'Belum lock'});
    return rows;
  }),...i.arr('locks').map(k=>({...k,...i.meta(k,k.lotId?i.lotRows([k.lotId]):[],k.agentId,k.refineryId),agent:i.agent(k.agentId),refinery:i.refinery(k.refineryId),status:k.lotId?'Lock dipadankan':'Lock lejar · belum dipadankan'}))];
  if(type==='deliveries') return [...i.arr('deliveries').map(d=>delInfo(d,false)),...i.arr('dispatches').map(d=>delInfo(d,true))];
  const assayInfo=a=>{
    const lot=i.lots.get(a.lotId);
    return {...(lot?lotInfo(lot):{}),...a,...i.meta(a,lot?[lot]:[],a.agentId,a.refineryId),date:a.date||null,status:ledgerOnly(a)?rm('historical'):'Selesai assay'};
  };
  if(type==='assays')return i.arr('assays').map(assayInfo);
  if(type==='pending') return [...i.lots.values()].filter(l=>i.dispatches.has(l.id)&&!i.assays.has(l.id)).map(l=>{const d=i.dispatches.get(l.id);return {...lotInfo(l),date:d.date,prNo:d.prNo,weight:i.deliveries.get(l.id)?.receivedWeights?.[l.id]??l.process?.after??l.weight,status:d.prNo?'Menunggu assay':'Menunggu PR'};});
  if(type==='profit')return postedSales.map(saleInfo);
  if(type==='trading'){
    const allocations=i.arr('goldAllocations').map(a=>({...a,...i.meta(a,i.lotRows(a.lotId?[a.lotId]:[]),a.agentId,a.refineryId),
      date:ledgerOnly(a)?null:a.date,party:a.role==='supplier'?i.agent(a.agentId):i.refinery(a.refineryId),
      kind:a.role==='supplier'?'Peruntukan harga belian':'Peruntukan harga jualan',allocationAmount:a.amount,status:rm('historical')}));
    return [...i.arr('purchases').map(l=>({...lotInfo(l),party:i.agent(l.agentId),kind:'Belian',purchased:l.amount,status:rm(l.invoiceStatus)})),...postedSales.map(r=>({...saleInfo(r),party:i.refinery(r.refineryId),kind:'Jualan'})),...allocations];
  }
  if(type==='outstanding') {
    const agentRows=i.arr('requests').map(requestInfo).filter(r=>r.unreturnedExcess>0||r.payable>0).map(r=>({...r,party:r.agent,outstanding:r.payable||r.unreturnedExcess,kind:r.payable?'Ariffin Jewels kepada ejen':'Lebihan selepas bil · ejen kepada Ariffin Jewels'}));
    return [...agentRows,...postedSales.map(saleInfo).filter(r=>r.outstanding!==0).map(r=>({...r,party:r.refinery,kind:r.outstanding==null?'Terimaan belum dipadankan':r.outstanding>0?'Kilang kepada Ariffin Jewels':'Lebihan bayaran kilang',outstanding:r.outstanding==null?null:Math.abs(r.outstanding)}))];
  }
  if(type==='supplierSOA'||type==='refinerySOA') {
    const lines=type==='supplierSOA' ? [
      ...i.arr('transfers').map(r=>({...bankRow(r),kind:'Pindahan dana',inc:r.amount})),
      ...i.arr('purchases').filter(l=>l.invoiceStatus==='confirmed').map(l=>({...lotInfo(l),date:l.billDate||l.confirmedAt?.slice(0,10)||l.date,accountId:l.agentId,kind:'Bil pembelian',dec:l.amount,status:'Disahkan'})),
      ...i.arr('returns').map(r=>({...bankRow(r),kind:'Pulangan dana',dec:r.amount})),
      ...historicalCredits.map(r=>({...bankRow(r),kind:'Invois / dana masuk · belum diasingkan',dec:r.amount})),...sourceBills,
    ]:[
      ...postedSales.map(r=>({...saleInfo(r),kind:'Invois jualan',accountId:r.refineryId,saleId:r.id,inc:r.amount})),
      ...i.arr('sales').filter(r=>Number(r.adjustment)).map(r=>({...saleInfo(r),id:r.id+' / PL',saleId:r.id,date:r.finalDate||r.date,kind:'Pelarasan assay',accountId:r.refineryId,inc:r.adjustment})),
      ...i.arr('receipts').map(r=>({...receiptRow(r),kind:r.amount<0?'Pemulangan kredit kepada kilang':'Bayaran diterima',dec:r.amount})),
    ];
    lines.sort((a,b)=>cmp(a.date,b.date)||Number(!a.inc)-Number(!b.inc)||cmp(a.id,b.id));
    const balances=new Map();
    for(const r of lines){
      const sale=i.sales.get(r.saleId);
      const posted=type==='supplierSOA'?Boolean(r.requestId):Boolean(sale&&(!ledgerOnly(sale)||sale.settlementVerified));
      if(fromLedger(r)&&!posted){r.balance=null;continue;}
      const balance=(balances.get(r.accountId)||0)+cents(r.inc)-cents(r.dec); balances.set(r.accountId,balance);r.balance=balance/100;
    }
    return lines;
  }
  if(type==='movements') {
    const lines=[];
    for(const l of i.lots.values()) {
      const base=lotInfo(l), del=i.deliveries.get(l.id),dis=i.dispatches.get(l.id),a=i.assays.get(l.id);
      const push=(event,date,kind,origin,destination,weight)=>lines.push({...base,id:event.id,date,lotId:l.id,kind,source:event.source,
        sourceDate:event.sourceDate||(event.source&&event===l.process?l.sourceDate:null),historical:fromLedger(event),imported:fromLedger(event),origin,destination,weight,status:kind});
      push(l,base.date,l.custodyOnly?'Daftar jagaan':ledgerOnly(l)?'Catatan emas':'Belian',l.owner,ledgerOnly(l)||l.custodyOnly?null:base.agent,l.weight);
      if(l.process)push(l.process,l.process.date||null,l.process.mode==='tarik'?'Selepas tarik':l.process.mode==='skip'?'Tidak tarik':'Timbangan lejar',ledgerOnly(l)?null:base.agent,ledgerOnly(l)?null:base.agent,l.process.after);
      if(del)push(del,del.date,'Dihantar',base.agent,'Dalam penghantaran',base.weightAfter);
      if(del?.status==='received')push(del,del.receivedDate,'Diterima','Dalam penghantaran','Ariffin Jewels',del.receivedWeights?.[l.id]);
      if(dis)push(dis,dis.date,'Ke kilang','Ariffin Jewels',base.refinery,del?.receivedWeights?.[l.id]);
      if(a&&!ledgerOnly(a))push(a,a.date,'Selepas assay',base.refinery,base.refinery,a.after);
    }
    return lines;
  }
  if(type==='periods') {
    const lines=[];
    const push=(rows,key,amount,info)=>rows.forEach(r=>lines.push({...info(r),metric:key,value:r[amount],status:rm(r.invoiceStatus||r.status||'Direkod')}));
    push(i.arr('requests'),'requests','requested',requestInfo);push(i.arr('transfers'),'transfers','amount',bankRow);
    push(i.arr('refundRequests'),'refundRequests','requested',r=>({...r,...i.meta(r,i.saleLots(i.sales.get(r.saleId)||{}),null,r.refineryId)}));
    push(i.arr('purchases'),'purchases','amount',lotInfo);push(i.arr('returns'),'returns','amount',bankRow);
    push(postedSales,'sales','amount',saleInfo);
    for(const r of i.arr('sales').filter(r=>r.status==='final'))lines.push({...saleInfo(r),date:r.finalDate||r.date,metric:'sales',value:r.adjustment});
    push(i.arr('receipts'),'receipts','amount',receiptRow);
    for(const l of i.lots.values()){
      const base=lotInfo(l);
      if(l.custodyOnly)lines.push({...base,status:'Daftar jagaan',metric:'operations',value:1});
      for(const lock of l.locks?.length?l.locks:(l.lock?[l.lock]:[]))if(!i.arr('locks').some(k=>k.id===lock.id))lines.push({...base,id:lock.id,date:lock.dateTime?.slice(0,10)||lock.date,status:'Dikunci',metric:'operations',value:1});
      if(l.process)lines.push({...base,id:l.process.id,date:l.process.date||null,status:l.process.mode==='tarik'?'Tarik':l.process.mode==='skip'?'Tidak tarik':'Timbangan lejar',metric:'operations',value:1});
    }
    for(const d of i.arr('deliveries')){
      const ctx=delInfo(d,false);lines.push({...ctx,status:'Dihantar',metric:'operations',value:1});
      if(d.status==='received')lines.push({...ctx,date:d.receivedDate,status:'Diterima',metric:'operations',value:1});
    }
    for(const d of i.arr('dispatches')){
      const ctx=delInfo(d,true);
      if(!d.prOnly)lines.push({...ctx,status:'Ke kilang',metric:'operations',value:1});
      if(d.prNo)lines.push({...ctx,date:d.prDate||null,status:d.prOnly?'PR direkod':'PR diterima',metric:'operations',value:1});
    }
    for(const a of i.arr('assays'))lines.push({...assayInfo(a),metric:'operations',value:1});
    for(const k of i.arr('locks'))lines.push({...k,...i.meta(k,i.lotRows(k.lotId?[k.lotId]:[]),k.agentId,k.refineryId),metric:'operations',value:1,status:rm('historical')});
    for(const r of historicalCredits)lines.push({...bankRow(r),metric:'sourceCredit',value:r.amount});
    return lines;
  }
  return [];
}

function periodStart(date,period) {
  if(!date)return '';
  if(period==='month')return date.slice(0,7);
  if(period==='week'){const d=new Date(date+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
  return date;
}
export function filterRows(rows, f={}) {
  const ref=(f.ref||'').trim().toLocaleLowerCase();
  return rows.filter(r=>{
    const date=f.dateBasis==='source'?(r.sourceDate||r.date):r.date;
    return (!f.from||(date&&date>=f.from))&&(!f.to||(date&&date<=f.to))&&(!f.agent||r.agentIds?.includes(f.agent))&&(!f.refinery||r.refineryIds?.includes(f.refinery))&&(!f.status||r.status===f.status)&&(!ref||[r.id,sourceRef(r),r.number,r.prNo,r.reportNo,r.bankRef,...(r.refs||[])].some(x=>x&&String(x).toLocaleLowerCase().includes(ref)));
  });
}
export function reportResult(state,type,filters={}) {
  const raw=makeRows(state,type), statuses=uniq(raw.map(r=>r.status)).sort(cmp);
  let rows=filterRows(raw,filters);
  if(type==='periods'){
    const totals=new Map(), period=filters.period||'day';
    for(const r of rows){
      const date=filters.dateBasis==='source'?(r.sourceDate||r.date):r.date;
      const key=periodStart(date,period);const group=totals.get(key)||{key,count:0,unknown:new Set()};
      group.count++;if(r.value==null)group.unknown.add(r.metric);else group[r.metric]=(group[r.metric]||0)+cents(r.value);totals.set(key,group);
    }
    rows=[...totals.values()].sort((a,b)=>cmp(b.key,a.key)).map(r=>{const g={...r,period:!r.key?'Tarikh tidak direkod':period==='month'?r.key:fmtDate(r.key)+(period==='week'?' (Isnin)':'')};for(const key of ['requests','refundRequests','transfers','purchases','returns','sales','receipts','operations','sourceCredit'])g[key]=r.unknown.has(key)?null:(r[key]||0)/100;return g;});
  } else if(type!=='supplierSOA'&&type!=='refinerySOA')rows.sort((a,b)=>cmp(b.date,a.date)||cmp(a.id,b.id));
  let cols=reportTypes[type].cols;
  if(type==='requests'&&state.refundRequests?.length)cols=[...cols,['kind','Jenis bayaran'],['refinery','Kilang penerima']];
  if(type==='periods'&&state.refundRequests?.length)cols=[...cols.map(c=>c[0]==='receipts'?['receipts','Terimaan bersih kilang','rm']:c),['refundRequests','Permohonan pemulangan kilang','rm']];
  if(raw.some(fromLedger)){
    if(type!=='periods'){
      rows=rows.map(r=>({...r,sourceLabel:sourceRef(r)}));
      cols=[...cols,['sourceLabel','Rujukan sumber']];
      if(raw.some(r=>r.sourceDate))cols=[...cols.map(c=>c[0]==='date'?['date','Tarikh transaksi','date']:c),['sourceDate','Tarikh catatan lejar','date']];
    }
    if(type==='supplierSOA'||type==='refinerySOA'||type==='funds'){
      cols=cols.map(c=>c[0]==='dec'&&type==='supplierSOA'?['dec','Bil / pulangan / kredit lejar','rm']:c);
      cols=[...cols,['sourceBalance','Baki asal helaian (D)','rm']];
    }
    if(type==='funds')cols=[...cols,['unclassified','Kredit belum diasingkan','rm']];
    if((type==='funds'||type==='supplierSOA')&&raw.some(r=>r.sourceInvoiceAmount!=null))cols=[...cols,['sourceInvoiceAmount','Kredit dipadankan · rujukan','rm'],['invoiceNo','Invois berkaitan']];
    if(type==='periods')cols=[...cols,['sourceCredit','Kredit belum diasingkan','rm']];
    if(type==='locks'){
      cols=[...cols.map(c=>c[0]==='price'?['quote','Harga lock · unit']:c),['refinery','Kilang']];
      rows=rows.map(r=>({...r,quote:r.price==null?null:Number(r.price).toLocaleString('en-MY',{maximumFractionDigits:4})+' · '+(fromLedger(r)?r.priceUnit||'unit sumber belum disahkan':'RM/g')}));
    }
    if(type==='assays')cols=[...cols,['afterMeaning','Asas berat selepas']];
    if(type==='assays')rows=rows.map(r=>({...r,afterMeaning:r.afterBasis==='fineGoldEquivalent'?'Setara emas tulen':null}));
    if(type==='deliveries'&&raw.some(r=>r.prOnly))cols=[...cols,['prNo','No. PR']];
    if(type==='purchases'||type==='owners'){
      cols=[...cols,['recordedWeight','Berat direkod','g'],['weightDescription','Asas timbangan']];
      rows=rows.map(r=>({...r,weightDescription:r.weightBasis==='beforePull'?'Sebelum tarik':r.weightBasis==='afterPull'?'Selepas tarik':null}));
    }
    if(type==='purchases')cols=[...cols,['sourceLineAmount','Nilai baris asal','rm']];
    if(type==='trading'&&state.goldAllocations?.length)cols=[...cols,['allocatedWeight','Berat diperuntuk','g'],['allocationAmount','Nilai peruntukan','rm']];
  }
  return {rows,statuses,...reportTypes[type],cols};
}
export const displayCell = (v, type) => type==='rm'?money(v):type==='g'?grams(v):type==='date'?fmtDate(v):type==='rate'&&v!=null?Number(v).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:4}):(v==null||v===''?'—':String(v));
