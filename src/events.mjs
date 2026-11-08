import {initialState,applyLedger} from './ledger.mjs';
import {applyGold} from './gold.mjs';
import {applyReconciliation} from './reconciliation.mjs';

export function assertOk(test, message, status=400) {
  if (!test) throw Object.assign(new Error(message),{status});
}
const isCorrection = e => e.action.startsWith('correction.');
const isImportedBatch = e => e.action==='sheet.records';
const fileKeys = new Set(['photo','proof','file','invoiceFile','document','beforePhoto','afterPhoto','costProof','evidence']);
function validateFiles(data,files) {
  for(const [key,value] of Object.entries(data)) {
    if(fileKeys.has(key) && value) assertOk(typeof value==='string' && Object.hasOwn(files,value),'Lampiran untuk '+key+' tidak dijumpai. Muat naik semula.');
  }
}
function run(state,event,files,patches,replaying=false) {
  let serial=0;
  const data=structuredClone(patches.get(event.seq) || event.data);
  validateFiles(data,files);
  const targets={lotIds:'purchases',lotId:'purchases',purchaseId:'purchases',deliveryId:'deliveries',
    dispatchId:'dispatches',shipmentId:'dispatches',saleId:'sales',requestId:'requests'};
  for(const [field,list] of Object.entries(targets)){
    if(!data[field])continue;
    const ids=new Set(Array.isArray(data[field])?data[field]:[data[field]]);
    const historic=state[list]?.find(r=>ids.has(r.id)&&(r.historical||r.imported)&&!r.operationalReady);
    assertOk(!historic,'Transaksi '+historic?.id+' sudah direkodkan dalam helaian asal. Semak rujukan sebelum merekod tindakan baharu.');
  }
  if(event.action==='delivery.create')assertOk(!state.purchases.some(p=>data.lotIds?.includes(p.id)&&p.process?.historical),'Sahkan kedua-dua timbangan dan pilihan proses pada lot sumber terlebih dahulu.');
  if(event.action==='process.save'){
    const p=state.purchases.find(p=>p.id===data.lotId);
    if(p?.operationalReady && p.process?.historical){p.sourceProcess=p.process;p.process=null;}
  }
  const ctx={now:event.now,user:event.user,files,replaying,schemaVersion:event.schemaVersion??1,id(prefix) {
    serial++;
    return prefix+'-'+String(event.seq).padStart(6,'0')+(serial>1?'-'+serial:'');
  }};
  const rec=event.action.startsWith('reconciliation.') ? applyReconciliation(state,event.action,data,ctx) :
    applyLedger(state,event.action,data,ctx) || applyGold(state,event.action,data,ctx);
  assertOk(rec,'Tindakan tidak dikenali.');
  return {id:rec.id,data};
}
function correctionIndex(events) {
  const requests=new Map(),patches=new Map();
  for(const e of events) {
    if(e.action==='correction.request') requests.set(e.seq,{id:'BET-'+e.seq,seq:e.seq,target:e.data.target,values:e.data.values,reason:e.data.reason,user:e.user,status:'pending',date:e.now});
    if(e.action==='correction.approve' || e.action==='correction.reject'){
      const req=requests.get(e.data.request);
      if(!req) throw new Error('Permohonan pembetulan tidak dijumpai.');
      req.status=e.action==='correction.approve'?'approved':'rejected';req.reviewer=e.user.name;
      if(req.status==='approved') patches.set(req.target,req.values);
    }
  }
  return {requests,patches};
}
export function materialize(events,files) {
  const state=initialState(),{requests,patches}=correctionIndex(events);
  state.corrections=[...requests.values()];
  for(const event of events){
    if(isImportedBatch(event)){
      for(const {key,row} of event.data.entries){
        const records=state[key]??(state[key]=[]);
        const found=records.find(r=>r.id===row.id);
        if(found)Object.assign(found,structuredClone(row));else records.push(structuredClone(row));
      }
      const note={jumlah:event.data.entries.length,rujukan:event.data.entries.map(e=>e.row.id).join(', ')};
      state.audit.push({id:'EV-'+event.seq,seq:event.seq,action:event.action,ref:'IMP-'+event.seq,
        now:event.now,date:event.now.slice(0,10),user:event.user.name,role:event.user.role,original:note,data:note});
      continue;
    }
    const change=isCorrection(event)?{id:'BET-'+(event.data.request||event.seq),data:event.data}:run(state,event,files,patches,true);
    state.audit.push({id:'EV-'+event.seq,seq:event.seq,action:event.action,ref:change.id,now:event.now,date:event.now.slice(0,10),user:event.user.name,role:event.user.role,original:event.data,data:change.data});
  }
  return state;
}
export function validateCorrection(events,event,files) {
  const target=events.find(e=>e.seq===Number(event.data.target));
  const {requests,patches}=correctionIndex(events);
  if(event.action==='correction.request'){
    const v=event.data.values;
    assertOk(target && !isCorrection(target) && !isImportedBatch(target) && !['delivery.issue','reconciliation.approve','reconciliation.reject'].includes(target.action),'Pilih catatan transaksi yang sah. Untuk membetulkan borang, pilih rekod lot atau penghantaran.');
    assertOk(typeof event.data.reason==='string' && event.data.reason.trim().length>=5,'Nyatakan sebab pembetulan.');
    assertOk(![...requests.values()].some(c=>c.target===target.seq && c.status==='pending'),'Pembetulan bagi catatan ini sedang menunggu kelulusan.');
    const prev=patches.get(target.seq)||target.data;
    assertOk(v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>Object.hasOwn(prev,k)),'Medan pembetulan tidak sah.');
    assertOk(JSON.stringify(v)!==JSON.stringify(prev),'Masukkan perubahan terlebih dahulu.');
    const mock={seq:event.seq+1,action:'correction.approve',data:{request:event.seq},user:event.user,now:event.now};
    materialize([...events,event,mock],files);
  }else{
    assertOk(['correction.approve','correction.reject'].includes(event.action),'Tindakan pembetulan tidak sah.');
    assertOk(event.user.role==='management','Kelulusan pengurusan diperlukan.',403);
    const req=requests.get(event.data.request);
    assertOk(req && req.status==='pending','Pembetulan ini sudah disemak atau tidak dijumpai.');
    assertOk(req.user.id!==event.user.id,'Seorang pengurus lain mesti menyemak pembetulan sendiri.',403);
  }
}
export function applyNewEvents(events,commands,user,files,now) {
  assertOk(Array.isArray(commands) && commands.length>0 && commands.length<=250,'Had import ialah 250 tindakan setiap kumpulan.');
  let state=materialize(events,files);
  const additions=[];
  for(const [i,cmd] of commands.entries()) {
    try{
      assertOk(cmd && typeof cmd.action==='string' && cmd.data && typeof cmd.data==='object' && !Array.isArray(cmd.data),'Format tindakan tidak sah.');
      assertOk(!isImportedBatch(cmd),'Tindakan import ini hanya untuk migrasi data asal.',403);
      const event={seq:(events.at(-1)?.seq||0)+i+1,schemaVersion:2,now,user:{id:user.id,name:user.name,role:user.role},action:cmd.action,data:cmd.data};
      if(isCorrection(event)) {
        validateCorrection([...events,...additions],event,files);
        state=materialize([...events,...additions,event],files);
      }else run(state,event,files,new Map());
      additions.push(event);
    }catch(e){if(commands.length>1)e.message='Baris '+(i+1)+' — '+e.message;throw e}
  }
  return additions;
}
