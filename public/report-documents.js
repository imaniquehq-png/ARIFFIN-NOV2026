import {indexState,reportResult,money,grams,fmtDate,statusText,displayCell,fromLedger,ledgerOnly,sourceRef,stockPosition,filterRows} from './report-data.js';

export const docNames={request:'Borang permohonan bayaran',purchase:'Rekod pembelian emas',delivery:'Borang penghantaran emas',acknowledgement:'Akuan penerimaan emas',dispatch:'Pesanan penghantaran ke kilang',assay:'Penyata keputusan assay',assayOwner:'Penyata assay mengikut pemilik',bill:'Bil pembelian',sale:'Invois jualan',voucher:'Baucar bayaran',supplierSOA:'Penyata akaun pembekal',refinerySOA:'Penyata akaun kilang',stock:'Laporan rekonsiliasi stok',einvoice:'Rekod e-Invois'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const text=v=>v==null||v===''?'—':String(v);
const table=(title,cols,rows)=>({title,cols,rows:rows.map(r=>r.map(text))});
const price=(v,method)=>v==null?'—':'RM '+Number(v).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:4})+' / '+(method==='Tahil'?'tahil':'g');
const totalGrams=list=>list.reduce((n,v)=>n+Math.round(Number(v)*1000),0)/1000;
function assayOwnerGroups(i) {
  const groups=new Map();
  for(const a of i.arr('assays')){
    if(!a.dispatchId || fromLedger(a) && !a.ownerVerified)continue;
    const lot=i.lots.get(a.lotId),owner=a.owner||lot?.owner,agentId=a.agentId||lot?.agentId||null;
    if(!owner || a.owner && lot?.owner && a.owner!==lot.owner || a.agentId && lot?.agentId && a.agentId!==lot.agentId)continue;
    const agent=i.arr('agents').find(r=>r.id===agentId);
    const ownerRef=a.ownerRef||lot?.ownerRef;
    // An older free-text name can be shared by different businesses. A lot remains
    // printable on its own until its owner can be identified by a stable reference.
    let identity=['lot',a.lotId||a.id];
    if(lot?.ownership==='ariffin')identity=['ariffin'];
    else if(ownerRef)identity=['owner',ownerRef];
    else if(agent && owner===agent.name)identity=['agent',agent.id];
    const key=JSON.stringify([a.dispatchId,agentId,identity,owner]);
    if(!groups.has(key))groups.set(key,{key,dispatchId:a.dispatchId,owner,agentId,identity,assays:[]});
    groups.get(key).assays.push(a);
  }
  return groups;
}

function selectAssayGroup(i,id,options) {
  const groups=assayOwnerGroups(i);
  if(groups.has(id))return groups.get(id);
  let dispatchId=id,owner=options.owner;
  if(String(id).startsWith('[')){
    let old;
    try{old=JSON.parse(id);}catch{throw new Error('Rujukan penyata pemilik tidak sah.');}
    if(!Array.isArray(old)||old.length!==2)throw new Error('Pilih semula rekod pemilik emas.');
    [dispatchId,owner]=old;
  }
  if(!owner)throw new Error('Pilih seorang pemilik emas.');
  const matches=[...groups.values()].filter(g=>g.dispatchId===dispatchId&&g.owner===owner&&
    (options.agentId===undefined||options.agentId===g.agentId));
  if(matches.length!==1)throw new Error('Pilih rekod pemilik mengikut ejen atau rujukan lot yang tepat.');
  return matches[0];
}

export function reportDocument(result, filters=[], date=today()){
  return {title:result.name,ref:'Laporan',date,meta:filters,tables:[table('',result.cols.map(c=>c[1]),result.rows.map(r=>result.cols.map(([k,,type])=>displayCell(r[k],type))))],totals:[],photos:[],files:[]};
}
export function documentChoices(state,type){
  const i=indexState(state), option=(r,description)=>({value:r.id,label:[r.id,description].filter(Boolean).join(' · ')});
  switch(type){
    case 'request': return [...i.arr('requests').map(r=>option(r,i.agent(r.agentId))),...i.arr('refundRequests').map(r=>option(r,'Pemulangan · '+i.refinery(r.refineryId)))];
    case 'bill': return i.arr('purchases').filter(l=>l.invoiceStatus==='confirmed').map(l=>option(l,[l.billNo,l.owner].join(' · ')));
    case 'purchase': return i.arr('purchases').map(r=>option(r,r.owner));
    case 'delivery': case 'acknowledgement': return i.arr('deliveries').filter(d=>type==='delivery'||(d.status==='received'&&!d.formNeedsReissue)).map(r=>option(r,fmtDate(r.date)));
    case 'dispatch': return i.arr('dispatches').filter(r=>!r.prOnly).map(r=>option(r,i.refinery(r.refineryId)));
    case 'assay': return i.arr('assays').filter(a=>!fromLedger(a)||(a.ownerVerified&&a.owner)).map(a=>option(a,a.owner||i.lots.get(a.lotId)?.owner));
    case 'assayOwner':return [...assayOwnerGroups(i).values()].map(g=>({value:g.key,
      label:[g.dispatchId,g.agentId&&i.agent(g.agentId)+' ('+g.agentId+')',g.owner,g.identity[0]==='lot'||g.identity[0]==='owner'?g.identity[1]:null].filter(Boolean).join(' · ')}));
    case 'sale':return i.arr('sales').map(r=>option(r,i.refinery(r.refineryId)));
    case 'voucher':return [...i.arr('transfers').map(r=>option(r,i.agent(r.agentId||i.requests.get(r.requestId)?.agentId))),...i.arr('receipts').filter(r=>r.amount<0&&r.kind==='refund').map(r=>option(r,'Pemulangan · '+i.refinery(r.refineryId||i.sales.get(r.saleId)?.refineryId)))];
    case 'supplierSOA':return i.arr('agents').map(r=>option(r,r.name));
    case 'refinerySOA':return i.arr('refineries').map(r=>option(r,r.name));
    case 'stock':return [{value:'stock',label:'Semua lot emas'}];
    case 'einvoice':return i.arr('einvoices').map(r=>option(r,r.reference));
    default:return [];
  }
}
export function buildDocument(s,type,id,options={}){
  const i=indexState(s), doc={title:docNames[type],ref:id,date:today(),meta:[],tables:[],totals:[],photos:[],files:[]};
  const find=(k,x=id)=>{const r=i.arr(k).find(v=>v.id===x); if(!r)throw new Error('Rekod tidak dijumpai.');return r;};
  const meta=(...items)=>doc.meta.push(...items.filter(x=>x[1]!=null&&x[1]!=='').map(([k,v])=>[k,text(v)]));
  const totals=(...items)=>doc.totals.push(...items);
  const photo=(file,caption)=>{
    if(!file)return;
    const existing=doc.photos.find(f=>f.id===file);
    if(existing)existing.caption+=' · '+caption;else doc.photos.push({id:file,caption});
  };
  const file=(id,label)=>{if(id)doc.files.push({id,label});};
  if(type==='request'){
    const r=i.arr('refundRequests').find(q=>q.id===id);
    if(r){
      doc.date=r.date;meta(['Jenis bayaran','Pemulangan kredit kilang'],['Penerima',i.refinery(r.refineryId)],['Invois',r.saleId],['Tujuan',r.purpose],['Status',statusText(r.status)],['Sebab penolakan',r.reason],['Bayaran',r.receiptId]);
      totals(['Jumlah diminta',money(r.requested)],['Jumlah diluluskan',money(r.approved)],['Jumlah dibayar',money(r.paidAmount)]);
      return doc;
    }
  }
  if(type==='voucher'){
    const refund=i.arr('receipts').find(r=>r.id===id&&r.kind==='refund'&&r.amount<0);
    if(refund){
      doc.date=refund.date;meta(['Jenis bayaran','Pemulangan kredit kilang'],['Penerima',i.refinery(refund.refineryId||i.sales.get(refund.saleId)?.refineryId)],['Permohonan',refund.requestId],['Invois',refund.saleId],['Rujukan bank',refund.bankRef]);
      totals(['Jumlah dibayar kepada kilang',money(-refund.amount)]);file(refund.proof,'Bukti pemulangan bank');return doc;
    }
    const r=find('transfers');
    if(ledgerOnly(r)&&!(r.requestId&&r.proof&&r.bankRef)){
      doc.title='Rekod pindahan dana';doc.date=r.date;meta(['Ejen',i.agent(r.agentId)],['Rujukan sumber',sourceRef(r)],['Rujukan bank',r.bankRef||'Belum dipadankan']);
      totals(['Duit keluar mengikut lejar',money(r.amount)]);file(r.proof,'Bukti bank');return doc;
    }
  }
  if(type==='sale'){
    const r=find('sales');
    if(ledgerOnly(r)){
      doc.title='Rekod invois jualan';doc.date=r.date;meta(['Kilang',i.refinery(r.refineryId)],['Nombor invois',r.invoiceNo],['Rujukan sumber',sourceRef(r)],['Status',statusText(r.status)]);
      if(r.historicalDocumentOnly)totals(['Nilai dokumen',money(r.documentAmount)]);else totals(['Nilai jualan direkod',money(r.amount)]);
      const t=i.settlement(r);
      if(t.received!=null)totals(['Terimaan dipadankan',money(t.received)]);
      if(t.outstanding!=null)totals([t.outstanding<0?'Kredit kepada kilang':'Baki belum diterima',money(Math.abs(t.outstanding))]);
      else doc.note='Semakan keseluruhan terimaan bagi invois ini belum disahkan.';
      return doc;
    }
  }
  if(type==='purchase'){
    const p=find('purchases');
    if(ledgerOnly(p)){
      doc.title='Rekod belian emas';doc.date=p.dateBasis==='goldLedgerDate'?null:p.date;meta(['Tarikh catatan lejar',p.sourceDate?fmtDate(p.sourceDate):null],['Rujukan sumber',sourceRef(p)],['Ejen',i.agent(p.agentId)],['Pemilik',p.owner||'Belum disahkan'],['Invois sumber',p.invoiceNo]);
      doc.tables.push(table('Timbangan dan harga sumber',['Sebelum tarik','Selepas tarik','Berat diperuntuk','Harga per gram','Nilai baris'],[[grams(p.process?.before),grams(p.process?.after),grams(p.allocationWeight),price(p.price,'WeBuy'),money(p.sourceLineAmount)]]));
      totals(['Nilai belian seluruh lot',money(p.amount)]);return doc;
    }
  }
  if(type==='assay'){
    const a=i.arr('assays').find(r=>r.id===id||r.lotId===id);
    if(fromLedger(a)){
      if(!a.owner||!a.ownerVerified)throw new Error('Pemilik perlu disahkan sebelum penyata ini dijana.');
      doc.title='Penyata keputusan assay daripada lejar';doc.ref=a.reportNo||a.id;doc.date=a.sourceDate||null;
      meta(['Pemilik',a.owner],['Kilang',i.refinery(a.refineryId)],['Rujukan sumber',sourceRef(a)],['Nombor PR',a.prNo],['Tarikh assay',a.date?fmtDate(a.date):'Belum direkod'],['Lot dipadankan',a.lotId]);
      doc.tables.push(table('Keputusan sumber',['Berat sebelum assay',a.afterBasis==='fineGoldEquivalent'?'Setara emas tulen':'Berat selepas assay','Mutu (‰)'],[[grams(a.before),grams(a.after),a.purity]]));return doc;
    }
  }
  if(type==='request'||type==='voucher'){
    const transfer=type==='voucher'?find('transfers'):null;
    const r=find('requests',transfer?.requestId||id), agent=find('agents',r.agentId), t=i.fund(r);
    doc.date=transfer?.date||r.date; meta(['Ejen',agent.name],['Kod ejen',agent.code],['Bank',agent.bank],['Akaun bank',agent.account]);
    if(transfer){meta(['Permohonan',r.id],['Rujukan bank',transfer.bankRef]);totals(['Jumlah pindahan',money(transfer.amount)]);file(transfer.proof,'Bukti pindahan bank');}
    else{
      meta(['Tujuan',r.purpose],['Status permohonan',statusText(r.status)],['Sebab penolakan',r.reason]);
      const extra=i.arr('supplements').filter(v=>v.requestId===id);
      totals(['Jumlah diminta',money(r.requested)],['Kelulusan asal',money(r.approved)],['Dipindahkan',money(t.transferred)],['Bil disahkan',money(t.purchased)],['Belian belum disahkan',money(t.pendingPurchase)],['Dipulangkan',money(t.returned)],['Dana masih tersedia (anggaran)',money(t.available)],['Lebihan selepas bil disahkan',money(t.unreturnedExcess)],['Baki perlu dibayar',money(t.payable)]);
      if(extra.length)doc.tables.push(table('Permohonan tambahan',['Rujukan','Tarikh','Jumlah','Status'],extra.map(v=>[v.id,fmtDate(v.date),money(v.amount),statusText(v.status)])));
    }
  } else if(type==='bill'||type==='purchase'){
    const l=find('purchases');
    if(type==='bill'&&l.invoiceStatus!=='confirmed')throw new Error('Bil pembelian memerlukan invois yang disahkan.');
    doc.ref=type==='bill'?l.billNo:l.id;doc.date=type==='bill'?l.billDate:l.date;
    meta(['Ejen',i.agent(l.agentId)],['Pemilik emas',l.owner],['No. lot',l.id],['Permohonan',l.requestId],['Invois pembekal',l.invoiceNo],['Status invois',statusText(l.invoiceStatus)],['Kaedah harga',l.method],['Gram setiap tahil',l.gramsPerTael]);
    doc.tables.push(table('Butiran emas',['Jenis emas','Mutu (‰)','Berat','Harga seunit','Nilai belian'],[[l.type,l.purity,grams(l.weight),price(l.price,l.method),money(l.amount)]]));
    totals(['Jumlah belian',money(l.amount)]);photo(l.photo,'Emas bagi lot '+l.id);file(l.invoiceFile,'Invois pembekal '+(l.invoiceNo||''));
  } else if(['delivery','acknowledgement','dispatch'].includes(type)){
    const kilang=type==='dispatch',ack=type==='acknowledgement',d=find(kilang?'dispatches':'deliveries');
    if(d.prOnly)throw new Error('Bukti penghantaran fizikal diperlukan untuk menjana pesanan penghantaran.');
    if(ack&&d.status!=='received')throw new Error('Sahkan timbangan penerimaan terlebih dahulu.');
    if(ack&&d.formNeedsReissue)throw new Error('Keluarkan borang penghantaran yang telah dibetulkan dahulu.');
    if(ack)doc.acknowledgementId=d.id;
    if(type==='delivery'){
      const lots=i.lotRows(d.lotIds);
      doc.deliveryId=d.id;
      doc.deliveryFormBasis=d.formBasis;
      doc.requirePhotos=true;
      doc.missingPhotos=!d.photo||lots.length!==(d.lotIds||[]).length||lots.some(l=>!l.photo);
    }
    doc.date=ack?d.receivedDate:d.date;
    meta(['Penerima',kilang?i.refinery(d.refineryId):'Ariffin Jewels'],['Direkod oleh',d.sentBy],['Tarikh dihantar',fmtDate(d.date)],['Nombor PR',d.prNo],['Tarikh PR',d.prDate?fmtDate(d.prDate):null]);
    if(ack)meta(['Tarikh diterima',fmtDate(d.receivedDate)],['Disemak dan diterima oleh',d.receivedBy],['Catatan semakan',d.receiveNote]);
    const lots=i.lotRows(d.lotIds),hdr=['No. lot','Pemilik emas','Ejen','Dihantar'];
    if(ack)hdr.push('Ditimbang','Beza');
    const sent=l=>kilang?d.lotWeights?.[l.id]:(d.expectedWeights?.[l.id]??l.process?.after??l.weight);
    doc.tables.push(table('Pecahan mengikut lot',hdr,lots.map(l=>{const row=[l.id,l.owner,i.agent(l.agentId),grams(sent(l))]; if(ack)row.push(grams(d.receivedWeights[l.id]),grams(d.receivedWeights[l.id]-sent(l)));return row;})));
    const owners=[...new Set(lots.map(l=>l.owner))];
    if(owners.length>1)doc.tables.push(table('Jumlah mengikut pemilik',['Pemilik','Berat dihantar',...(ack?['Berat diterima']:[])],owners.map(o=>{const group=lots.filter(l=>l.owner===o);return [o,grams(totalGrams(group.map(sent))),...(ack?[grams(totalGrams(group.map(l=>d.receivedWeights[l.id])))]:[])];})));
    totals(['Berat keseluruhan dihantar',grams(d.weight)]);
    if(ack)totals(['Berat keseluruhan diterima',grams(d.receivedWeight??totalGrams(Object.values(d.receivedWeights)))]);
    photo(d.photo,'Gambar penghantaran '+d.id);lots.forEach(l=>photo(l.photo,l.id+' · '+l.owner));file(d.document,'Dokumen sokongan penghantaran');
  } else if(type==='assay'||type==='assayOwner'){
    let assays;
    if(type==='assayOwner'){
      assays=selectAssayGroup(i,id,options).assays;
    }else{const a=i.arr('assays').find(r=>r.id===id||r.lotId===id);assays=a?[a]:[];}
    if(!assays.length)throw new Error('Keputusan assay belum diterima bagi pemilik ini.');
    const a=assays[0],d=find('dispatches',a.dispatchId),owner=a.owner||i.lots.get(a.lotId)?.owner;
    doc.ref=type==='assay'?a.id:d.id;doc.date=assays.map(a=>a.date).sort().at(-1);
    const agentId=a.agentId||i.lots.get(a.lotId)?.agentId, ownerRef=a.ownerRef||i.lots.get(a.lotId)?.ownerRef;
    meta(['Pemilik emas',owner],['Rujukan pemilik',ownerRef],['Ejen',agentId?i.agent(agentId)+' ('+agentId+')':null],['Kilang',i.refinery(d.refineryId)],[d.prOnly?'Rekod PR':'Penghantaran',d.id],['Nombor PR',d.prNo],['Tarikh PR',fmtDate(d.prDate)]);
    // Original refinery reports can contain results for other owners. Only release matched figures.
    doc.tables.push(table('Keputusan lot milik '+owner,['No. lot','No. laporan','Tarikh assay','Sebelum','Selepas','Perbezaan','Mutu (‰)'],assays.map(a=>[a.lotId,a.reportNo,fmtDate(a.date),grams(a.before),a.afterBasis==='fineGoldEquivalent'?'Setara emas tulen '+grams(a.after):grams(a.after),grams(a.variance),a.purity])));
  } else if(type==='sale'){
    const sale=find('sales'),d=find('dispatches',sale.shipmentId),t=i.settlement(sale);
    doc.date=sale.date;meta(['Dibil kepada',i.refinery(sale.refineryId)],['Pesanan penghantaran',d.id],['Nombor PR',d.prNo],['Status',statusText(sale.status)],['Tarikh muktamad',sale.finalDate?fmtDate(sale.finalDate):null],['Kadar pendahuluan',sale.advancePercent+'%'],['Gram setiap tahil',sale.gramsPerTael]);
    doc.tables.push(table('Penetapan harga',['Berat jualan','Harga tahil','Nilai asal'],[[grams(sale.weight),price(sale.price,'Tahil'),money(sale.amount)]]));
    doc.tables.push(table('Lot dalam penghantaran',['No. lot','Pemilik','Berat dihantar'],i.saleLots(sale).map(l=>[l.id,l.owner,grams(d.lotWeights?.[l.id])])));
    totals(['Pelarasan selepas assay',money(sale.adjustment)],['Jualan bersih',money(t.net)],['Terimaan bersih selepas pemulangan',money(t.received)],[t.outstanding<0?'Kredit perlu dipulangkan kepada kilang':'Baki belum diterima',money(t.outstanding==null?null:Math.abs(t.outstanding))]);
  } else if(type==='supplierSOA'||type==='refinerySOA'){
    const supplier=type==='supplierSOA',partner=find(supplier?'agents':'refineries');
    meta([supplier?'Ejen':'Kilang',partner.name],['Kod',partner.code],['Dari',options.from?fmtDate(options.from):null],['Hingga',options.to?fmtDate(options.to):null]);
    const filters=supplier?{agent:id}:{refinery:id}, all=reportResult(s,type,filters).rows;
    const rows=filterRows(all,{from:options.from,to:options.to});
    const hasHistory=all.some(fromLedger), hasOperational=all.some(r=>r.balance!=null);
    const prev=options.from?all.filter(r=>r.balance!=null&&r.date&&r.date<options.from).at(-1)?.balance??0:0;
    const end=rows.filter(r=>r.balance!=null).at(-1)?.balance??prev;
    doc.tables.push(table('Transaksi',['Tarikh','Rujukan','Perkara',supplier?'Dana diberi':'Invois',supplier?'Bil / pulangan':'Diterima','Baki'],rows.map(r=>[fmtDate(r.date),r.id,r.kind,money(r.inc),money(r.dec),money(r.balance)])));
    if(hasOperational||!hasHistory)totals([hasHistory?'Baki awal operasi':'Baki awal',money(prev)],[hasHistory?'Baki akhir operasi':supplier?'Baki akhir dana ejen':'Baki akhir kilang',money(end)]);
    if(hasHistory){
      doc.tables=[table('Transaksi',['Tarikh','Rujukan','Perkara',supplier?'Dana diberi':'Invois',supplier?'Bil / pulangan / kredit':'Diterima','Baki operasi','Baki sumber (D)','Rujukan sumber'],rows.map(r=>[fmtDate(r.date),r.id,r.kind,money(r.inc),money(r.dec),money(r.balance),money(r.sourceBalance),sourceRef(r)||'—']))];
      const closing=new Map();
      for(const r of all.filter(r=>fromLedger(r)&&r.sourceBalance!=null&&(!options.to||(r.date&&r.date<=options.to)))){
        const key=String(r.source.sheetId),old=closing.get(key);
        if(!old||old.source.rowNo<r.source.rowNo)closing.set(key,r);
      }
      totals(...[...closing.values()].map(r=>['Baki akhir sumber · '+sourceRef(r),money(r.sourceBalance)]));
      doc.note='Baki sumber mengikut lajur D setiap helaian. Padanan kepada permohonan, bil dan bayaran disahkan secara berasingan.';
    }else if(supplier)doc.note='Baki positif ialah dana ejen yang perlu dipadankan atau dipulangkan. Baki negatif ialah jumlah yang perlu dibayar kepada ejen.';
  } else if(type==='stock'){
    doc.ref='Stok';const lots=[...i.lots.values()];
    const held=l=>i.deliveries.get(l.id)?.status==='received'&&!i.dispatches.get(l.id);
    doc.tables.push(table('Padanan mengikut lot',['No. lot','Pemilik','Belian','Selepas proses','Diterima AJ','Ke kilang','Selepas assay','Stok di AJ'],lots.map(l=>{const received=i.deliveries.get(l.id)?.receivedWeights?.[l.id],d=i.dispatches.get(l.id),a=i.assays.get(l.id);return [l.id,l.owner,grams(l.weight),grams(l.process?.after),grams(received),grams(d?.lotWeights?.[l.id]),a?.afterBasis==='fineGoldEquivalent'?'Setara emas tulen '+grams(a.after):grams(a?.after),grams(held(l)?received:fromLedger(l)&&!d?null:0)];})));
    const position=stockPosition(s);
    totals(['Stok fizikal di Ariffin Jewels',position.unknown?'Belum disahkan':grams(position.knownWeight)]);
    if(position.unknown&&position.held.length)totals(['Stok dengan timbangan penerimaan',grams(position.knownWeight)]);
  } else if(type==='einvoice'){
    const e=find('einvoices'),r=e.purchaseId?find('purchases',e.purchaseId):find('sales',e.saleId);
    doc.date=e.date;meta(['Rujukan e-Invois',e.reference],['Transaksi berkaitan',r.billNo||r.id],['Jenis',e.purchaseId?'Pembelian':'Jualan'],['Pihak berkaitan',e.purchaseId?i.agent(r.agentId):i.refinery(r.refineryId)],['Status direkodkan',statusText(e.status)]);
    totals(['Nilai transaksi',money(e.purchaseId?r.amount:i.settlement(r).net)]);file(e.file,'Salinan asal e-Invois');doc.note='Rujukan dan status direkod secara manual daripada dokumen yang diserahkan. Salinan asal disertakan dalam PDF.';
  }else throw new Error('Jenis dokumen tidak dikenal pasti.');
  return doc;
}
