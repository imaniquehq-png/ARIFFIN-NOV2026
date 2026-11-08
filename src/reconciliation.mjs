import {applyLedger,receiptLimit} from './ledger.mjs';
import {applyGold} from './gold.mjs';

// A proposal changes the existing source record only after independent review.
// Its ID and source coordinates survive every operation and every replay.
export const reconciliationTypes = {
  transfer:{table:'transfers',label:'Padankan pindahan dengan Payment Request',fields:'requestId date bankRef'},
  creditReturn:{table:'supplierCredits',label:'Sahkan pulangan wang melalui bank',fields:'requestId date bankRef'},
  creditBill:{table:'supplierCredits',label:'Padankan kredit pembekal dengan invois',fields:'lotId invoiceNo'},
  owner:{table:'purchases',label:'Sahkan pemilik emas',fields:'owner'},
  purchase:{table:'purchases',label:'Lengkapkan pembelian daripada bil asal',fields:'requestId owner date type purity weight price photo invoiceNo invoiceDate'},
  process:{table:'purchases',label:'Sahkan timbangan proses',fields:'mode date operator before after beforePhoto afterPhoto note'},
  lock:{table:'locks',label:'Padankan MKS Lock dengan lot',fields:'lotId number dateTime'},
  pr:{table:'dispatches',label:'Padankan PR dengan lot',fields:'lotIds prDate'},
  dispatch:{table:'dispatches',label:'Sahkan penghantaran fizikal bagi PR',fields:'lotIds date prDate photo'},
  assayLink:{table:'assays',label:'Padankan keputusan assay dengan PR dan lot',fields:'dispatchId lotId owner'},
  assay:{table:'assays',label:'Lengkapkan bacaan laporan assay',fields:'dispatchId lotId date reportNo before after purity note'},
  sale:{table:'sales',label:'Padankan invois dengan penghantaran',fields:'shipmentId date weight price invoiceNo'},
  receipt:{table:'receipts',label:'Peruntukkan bayaran kepada invois',fields:'saleId date bankRef amount'},
  settlement:{table:'sales',label:'Sahkan semua bayaran invois telah dipadankan',fields:''},
};
const financeTypes=new Set(['transfer','creditReturn','creditBill','receipt','settlement','sale']);
const check=(test,message)=>{if(!test)throw new Error(message);};
const isSource=row=>row?.historical||row?.imported;
const find=(s,key,id)=>{const r=s[key]?.find(x=>x.id===id);check(r,'Rujukan tidak dijumpai: '+String(id));return r;};
const str=(v,n)=>{check(typeof v==='string' && v.trim() && v.trim().length<=250,'Lengkapkan '+n+'.');return v.trim();};
const cents=v=>Math.round(Number(v)*100);
function day(v){
  check(typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().startsWith(v+'T'),'Tarikh tidak sah.');
  return v;
}
const physical=(s,id)=>s.purchases.find(x=>x.id===id)||find(s,'custodyLots',id);
function sourceRecord(s,kind,target){
  const spec=reconciliationTypes[kind];
  check(Object.hasOwn(reconciliationTypes,kind),'Jenis padanan tidak sah.');
  const row=find(s,spec.table,target);
  check(isSource(row),'Pilih rekod asal Google Sheet.');
  return row;
}
function netSame(before,after,label){
  if(before!=null)check(cents(before)===cents(after),label+' tidak sepadan dengan jumlah dalam lejar asal.');
}
function nativeRecord(s,table,old,action,data,ctx){
  const rows=s[table],idx=rows.indexOf(old);
  if(idx>=0)rows.splice(idx,1);
  const updated=action.startsWith('request.')||action==='sale.create'?applyLedger(s,action,data,ctx):applyGold(s,action,data,ctx);
  const generated=rows.indexOf(updated);
  check(generated>=0,'Rekod operasi tidak dihasilkan.');
  rows.splice(generated,1);
  const merged={...old,...updated,id:old.id,operationalReady:true};
  rows.splice(idx>=0?idx:rows.length,0,merged);
  return merged;
}
function sameOwner(lot,agentId){
  if(agentId)check(lot.agentId===agentId,'Ejen pada bukti tidak sepadan dengan ejen lot.');
}
function prLots(s,r,ids) {
  check(Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length,'Pilih lot berbeza yang disenaraikan dalam PR.');
  for(const id of ids){
    physical(s,id);
    check(!s.dispatches.some(d=>d.id!==r.id && d.lotIds?.includes(id)),'Lot telah dipadankan kepada penghantaran atau PR lain.');
  }
  return ids;
}
function applyMatch(s,proposal,ctx){
  const {kind,target,fields:f,evidence}=proposal;
  const r=sourceRecord(s,kind,target), spec=reconciliationTypes[kind];
  check(ctx.files[evidence],'Lampiran bukti tidak dijumpai.');
  const ready=()=>check(!r.operationalReady,'Rekod ini sudah disahkan. Gunakan pembetulan pada catatan padanan.');
  const marked=x=>{x.evidence=evidence;x.reconciledBy=ctx.user.id;return x;};
  switch(kind){
    case 'transfer':{
      ready();check(!r.requestId,'Pindahan sudah dipadankan.');
      const req=find(s,'requests',f.requestId);sameOwner(req,r.agentId);
      return marked(nativeRecord(s,'transfers',r,'request.transfer',{requestId:req.id,date:day(f.date),amount:r.amount,bankRef:f.bankRef,proof:evidence},ctx));
    }
    case 'creditReturn':{
      check(r.classification==='unclassified','Kredit sudah dikelaskan.');
      sameOwner(find(s,'requests',f.requestId),r.agentId);
      const ret=nativeRecord(s,'returns',r,'request.return',{requestId:f.requestId,date:day(f.date),amount:r.amount,bankRef:f.bankRef,proof:evidence},ctx);
      s.supplierCredits.splice(s.supplierCredits.indexOf(r),1);ret.classification='bank-return';return marked(ret);
    }
    case 'creditBill':{
      check(r.classification==='unclassified','Kredit sudah dikelaskan.');
      const lot=find(s,'purchases',f.lotId);sameOwner(lot,r.agentId);
      const no=str(f.invoiceNo,'nombor invois');check(lot.invoiceNo?.toLowerCase()===no.toLowerCase(),'Nombor invois mesti sepadan dengan invois pada lot.');
      Object.assign(r,{classification:'purchase-invoice',lotId:lot.id,invoiceNo:no});return marked(r);
    }
    case 'owner':{
      const owner=str(f.owner,'nama pemilik');
      check(!r.ownerVerified || r.owner===owner,'Pemilik sedia disahkan berbeza. Semak padanan asal.');
      r.owner=owner;r.ownerVerified=true;return marked(r);
    }
    case 'purchase':{
      ready();
      const req=find(s,'requests',f.requestId);sameOwner(req,r.agentId);
      if(r.ownerVerified)check(r.owner===f.owner,'Pemilik mesti sepadan dengan padanan disahkan.');
      const updated=nativeRecord(s,'purchases',r,'purchase.create',{...f,invoiceFile:evidence},ctx);
      netSame(r.amount,updated.amount,'Nilai pembelian');
      Object.assign(updated,{ownerVerified:true,dateBasis:'purchase',process:r.process,locks:r.locks||[],lock:r.lock||null,lockedWeight:r.lockedWeight||0});
      check(updated.lockedWeight<=updated.weight,'Berat asal kurang daripada jumlah MKS yang dipadankan.');
      return marked(updated);
    }
    case 'process':{
      check(!r.process || isSource(r.process),'Proses sudah disahkan. Gunakan pembetulan pada catatan asal.');
      check(r.weight!=null || f.mode==='tarik','Berat asal diperlukan untuk pilihan Tidak Tarik.');
      r.sourceProcess??=r.process;r.process=null;
      applyGold(s,'process.save',{...f,lotId:r.id},ctx);r.processVerified=true;
      return marked(r);
    }
    case 'lock':{
      check(!r.lotId,'MKS Lock sudah dipadankan.');
      const lot=find(s,'purchases',f.lotId);sameOwner(lot,r.agentId);
      if(r.refineryId)check(s.dispatches.some(d=>d.refineryId===r.refineryId && d.lotIds.includes(lot.id)),'Padankan PR atau penghantaran kilang kepada lot ini dahulu.');
      const number=str(f.number,'nombor MKS'),stamp=String(f.dateTime||'');
      check(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(stamp),'Tarikh dan masa MKS tidak sah.');
      const date=day(stamp.slice(0,10));check(!r.date||r.date===date,'Tarikh tidak sepadan dengan lock sumber.');
      const all=[...(s.locks||[]),...s.purchases.flatMap(p=>p.locks||[])];
      check(!all.some(l=>l.id!==r.id && l.number?.toLowerCase()===number.toLowerCase()),'Nombor MKS Lock telah digunakan.');
      Object.assign(r,{lotId:lot.id,number,dateTime:stamp});marked(r);
      // Refinery and supplier locks represent different sides of the same gold.
      if(!r.refineryId){
        lot.locks=[...(lot.locks||[]),r];lot.lock=r;
        lot.lockedWeight=lot.locks.reduce((total,l)=>total+Math.round(l.weight*1000),0)/1000;
        check(lot.weight==null||lot.lockedWeight<=lot.weight,'Berat MKS melebihi berat lot.');
      }
      return r;
    }
    case 'pr':{
      check(r.prOnly,'Penghantaran ini telah disahkan.');
      const date=day(f.prDate);check(!r.prDate||r.prDate===date,'Tarikh PR bercanggah dengan catatan disahkan.');
      r.lotIds=[...new Set([...r.lotIds,...prLots(s,r,f.lotIds)])];r.prDate=date;return marked(r);
    }
    case 'dispatch':{
      ready();check(r.prOnly,'Pilih PR sumber.');
      const ids=prLots(s,r,f.lotIds);check(r.lotIds.every(id=>ids.includes(id)),'Semua lot yang telah dipadankan mesti terkandung dalam penghantaran.');
      const date=day(f.date),prDate=day(f.prDate);check(prDate>=date && (!r.prDate||r.prDate===prDate),'Tarikh PR dan tarikh penghantaran tidak sepadan.');
      const d=nativeRecord(s,'dispatches',r,'dispatch.create',{date,refineryId:r.refineryId,lotIds:ids,photo:f.photo,document:evidence},ctx);
      Object.assign(d,{prNo:r.prNo,prDate,prOnly:false,status:'sent'});return marked(d);
    }
    case 'assayLink':
    case 'assay':{
      const lot=physical(s,f.lotId),d=find(s,'dispatches',f.dispatchId);
      sameOwner(lot,r.agentId);
      check(!r.refineryId||r.refineryId===d.refineryId,'Kilang pada assay berbeza dengan PR.');
      check(d.prNo && (!r.prNo||r.prNo===d.prNo) && (!r.dispatchId||r.dispatchId===d.id) && d.lotIds.includes(lot.id),'Pilih lot yang telah dipadankan dengan PR asal.');
      check((!r.lotId||r.lotId===lot.id) && !s.assays.some(a=>a.id!==r.id && a.lotId===lot.id),'Lot sudah mempunyai padanan assay lain.');
      const owner=kind==='assayLink'?str(f.owner,'nama pemilik'):lot.owner;
      check(owner && (!lot.ownerVerified||lot.owner===owner),'Pemilik tidak sepadan dengan lot.');
      if(!lot.ownerVerified){lot.owner=owner;lot.ownerVerified=true;}
      if(kind==='assayLink'){
        Object.assign(r,{lotId:lot.id,agentId:lot.agentId,owner,ownerVerified:true,dispatchId:d.id,prNo:d.prNo});d.assayIds=[...new Set([...(d.assayIds||[]),r.id])];return marked(r);
      }
      ready();check(!d.prOnly && d.prDate,'Sahkan penghantaran fizikal serta tarikh PR dahulu.');
      const a=nativeRecord(s,'assays',r,'assay.create',{...f,file:evidence},ctx);
      Object.assign(a,{assayDate:a.date,afterBasis:'measured',ownerVerified:true});return marked(a);
    }
    case 'sale':{
      ready();const d=find(s,'dispatches',f.shipmentId);
      check(!d.prOnly && r.refineryId===d.refineryId,'Kilang invois mesti sepadan dengan penghantaran fizikal.');
      check((r.lotIds||[]).every(id=>d.lotIds.includes(id)),'Penghantaran bercanggah dengan lot pada invois sumber.');
      const no=str(f.invoiceNo,'nombor invois asal');
      check(!r.invoiceNo||no.toLowerCase()===r.invoiceNo.toLowerCase(),'Nombor invois tidak sepadan dengan sumber.');
      const sale=nativeRecord(s,'sales',r,'sale.create',f,ctx);
      netSame(r.amount??r.documentAmount,sale.amount,'Nilai jualan');
      Object.assign(sale,{invoiceNo:no,historicalDocumentOnly:false,settlementVerified:!!r.settlementVerified});return marked(sale);
    }
    case 'receipt':{
      check(!r.saleId,'Bayaran telah diperuntukkan.');
      const sale=find(s,'sales',f.saleId);
      check(sale.refineryId===r.refineryId,'Terimaan dan invois mesti daripada kilang yang sama.');
      const date=day(f.date),ref=str(f.bankRef,'rujukan bank');
      check(!r.date || r.date===date,'Tarikh tidak sepadan dengan catatan bank.');
      check(!sale.date || date>=sale.date,'Terimaan mendahului invois.');
      const amount=Number(f.amount),part=cents(amount),original=cents(r.amount);
      check(/^\d+(\.\d{1,2})?$/.test(String(f.amount)) && part>0 && part<=original,'Jumlah padanan melebihi baki terimaan atau tidak sah.');
      if(!isSource(sale) || (sale.operationalReady && sale.settlementVerified))check(part<=cents(receiptLimit(s,sale,date)),'Jumlah padanan melebihi baki yang dibenarkan mengikut terma kilang dan tarikh assay.');
      const group=r.bankGroup||r.id;
      check(!s.receipts.some(x=>x.id!==r.id && (x.bankGroup||x.id)!==group && x.bankRef?.toLowerCase()===ref.toLowerCase()),'Rujukan bank telah digunakan pada terimaan lain.');
      check(!r.bankRef || r.bankRef.toLowerCase()===ref.toLowerCase(),'Rujukan mesti sama untuk pecahan bayaran yang sama.');
      if(part<original){
        s.receipts.push({...r,id:ctx.id('RCP'),bankGroup:group,bankRef:ref,date,amount:(original-part)/100,sourceAmount:r.sourceAmount??r.amount});
      }
      Object.assign(r,{saleId:sale.id,date,bankRef:ref,amount:part/100,sourceAmount:r.sourceAmount??r.amount,bankGroup:group,proof:evidence,receivedBy:ctx.user.id,operationalReady:true});
      if(isSource(sale))sale.settlementVerified=false;
      return marked(r);
    }
    case 'settlement':{
      check(!r.settlementVerified && (r.amount??r.documentAmount)!=null,'Tiada jumlah invois untuk disahkan atau semakan telah selesai.');
      r.settlementVerified=true;return marked(r);
    }
  }
  throw new Error('Tindakan padanan tidak dikenali.');
}
export function applyReconciliation(s,action,data,ctx){
  const pending=s.reconciliations??=[];
  if(action==='reconciliation.request'){
    const {kind,target,fields,evidence}=data;
    sourceRecord(s,kind,target);
    if(financeTypes.has(kind))check(ctx.user.role==='accountant','Akauntan perlu menyemak padanan kewangan.');
    check(ctx.files[evidence],'Sertakan bukti transaksi.');
    check(fields && typeof fields==='object' && !Array.isArray(fields) && Object.keys(fields).every(k=>reconciliationTypes[kind].fields.split(' ').includes(k)),'Medan padanan tidak sah.');
    check(!pending.some(p=>p.target===target&&p.status==='pending'),'Rekod ini sedang menunggu semakan.');
    const reason=str(data.reason,'sebab padanan');
    const proposal={id:ctx.id('PDN'),kind,target,fields:structuredClone(fields),evidence,reason,status:'pending',by:ctx.user.id,byName:ctx.user.name,date:ctx.now.slice(0,10)};
    // The dry run uses the reviewer's authority for domain bank checks and has no side effects.
    applyMatch(structuredClone(s),proposal,{...ctx,user:{...ctx.user,role:'management'}});
    pending.push(proposal);return proposal;
  }
  check(action==='reconciliation.approve'||action==='reconciliation.reject','Tindakan padanan tidak dikenali.');
  check(ctx.user.role==='management','Kelulusan pengurusan diperlukan.');
  const proposal=find(s,'reconciliations',data.proposal);
  check(proposal.status==='pending' && proposal.by!==ctx.user.id,'Permohonan mesti menunggu semakan pengguna lain.');
  if(action==='reconciliation.approve')applyMatch(s,proposal,ctx);
  proposal.status=action==='reconciliation.approve'?'approved':'rejected';proposal.reviewedBy=ctx.user.id;proposal.reviewedAt=ctx.now;
  return proposal;
}
