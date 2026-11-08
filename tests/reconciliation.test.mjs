import test from 'node:test';
import assert from 'node:assert/strict';
import {applyNewEvents,materialize} from '../src/events.mjs';
import {requestTotals,saleTotals} from '../src/ledger.mjs';
const mgr={id:'m',name:'Pengurusan',role:'management'},acct={id:'a',name:'Akauntan',role:'accountant'},staff={id:'s',name:'Staf',role:'staff'};
const files={bank:{type:'application/pdf'},photo:{type:'image/jpeg'}},date='2026-09-01',now=date+'T10:00:00Z';
function fixture(source){
  const rows=Object.entries(source).flatMap(([key,records])=>records.map(row=>({key,row:{...row,historical:true,source:{sheetId:'1',rowNo:9}}})));
  const ev=[{seq:1,now,user:mgr,action:'sheet.records',data:{entries:rows}}];
  const add=(action,data,actor)=>{const batch=applyNewEvents(ev,[{action,data}],actor,files,now);ev.push(...batch);return ev.at(-1).seq;};
  const state=()=>materialize(ev,files);
  const propose=(kind,target,fields,actor=acct)=>{add('reconciliation.request',{kind,target,fields,evidence:'bank',reason:'Disemak pada dokumen asal.'},actor);return state().reconciliations.at(-1).id;};
  const approve=(proposal,actor=mgr)=>add('reconciliation.approve',{proposal},actor);
  return {ev,add,state,propose,approve};
}
test('Bayaran bank yang dibahagi antara invois dikira sekali dan memerlukan kelulusan berasingan',()=>{
  const sale=id=>({id,refineryId:'K',amount:100,date,lotIds:[]});
  const {ev,state,propose,approve}=fixture({sales:[sale('I1'),sale('I2'),{...sale('I3'),refineryId:'OTHER'}],receipts:[{id:'R',refineryId:'K',date,amount:120}]});
  const fields={saleId:'I1',date,amount:40,bankRef:'BNK'};
  assert.throws(()=>propose('receipt','R',fields,staff),/Akauntan/);
  assert.throws(()=>propose('receipt','R',{...fields,saleId:'I3'}),/kilang/);
  const first=propose('receipt','R',fields);
  assert.equal(state().receipts.length,1);assert.equal(state().receipts[0].saleId,undefined);
  assert.throws(()=>approve(first,acct),/pengurusan/);approve(first);
  const left=state().receipts.find(r=>!r.saleId);
  assert.equal(left.amount,80);assert.equal(state().receipts[0].id,'R');
  assert.throws(()=>propose('receipt',left.id,{...fields,bankRef:'OTHER',amount:80}),/Rujukan/);
  approve(propose('receipt',left.id,{...fields,saleId:'I2',amount:80}));
  assert.equal(state().receipts.reduce((a,r)=>a+r.amount,0),120);
  assert.equal(saleTotals(state(),'I1').received,40);assert.equal(saleTotals(state(),'I1').outstanding,null);
  approve(propose('settlement','I1',{}));assert.equal(saleTotals(state(),'I1').outstanding,60);
  assert.equal(ev[0].data.entries.find(e=>e.key==='receipts').row.amount,120);
});
test('Padanan sumber menggunakan ID lot dan pindahan asal dari kelulusan hingga bil, MKS dan pulangan',()=>{
  const {state,add,propose,approve}=fixture({agents:[{id:'AG',name:'Agent A',code:'AG',bank:'Bank',account:'001',method:'WeBuy'}],
    purchases:[{id:'L',agentId:'AG',owner:null,amount:100,process:null,locks:[]}],
    transfers:[{id:'T',agentId:'AG',amount:150,date}],locks:[{id:'LOCK',agentId:'AG',date,weight:1,price:100}],
    supplierCredits:[{id:'CR',agentId:'AG',amount:50,date,classification:'unclassified'}]});
  add('request.create',{agentId:'AG',requested:150,date,purpose:'Belian'},staff);
  const requestId=state().requests[0].id;add('request.approve',{requestId,approved:150},mgr);
  approve(propose('transfer','T',{requestId,date,bankRef:'B001'}));
  approve(propose('owner','L',{owner:'A'},staff));
  approve(propose('lock','LOCK',{lotId:'L',number:'M001',dateTime:date+'T11:20'},staff));
  approve(propose('purchase','L',{requestId,date,owner:'A',type:'Cincin',price:100,purity:916,weight:1,photo:'photo',invoiceNo:'B-1',invoiceDate:date},staff));
  add('purchase.confirm',{purchaseId:'L',date},acct);
  approve(propose('creditReturn','CR',{requestId,date,bankRef:'B002'}));
  add('request.close',{requestId},acct);
  const s=state();assert.equal(s.purchases.length,1);assert.equal(s.transfers.length,1);assert.equal(s.returns[0].id,'CR');
  assert.equal(s.supplierCredits.length,0);assert.equal(s.purchases[0].locks[0].id,'LOCK');assert.equal(s.purchases[0].invoiceStatus,'confirmed');
  assert.equal(requestTotals(s,requestId).balance,0);assert.equal(s.requests[0].status,'closed');
});
test('PR sumber menjadi penghantaran hanya selepas timbangan fizikal, assay dan invois kekal pada ID asal',()=>{
  const {state,add,propose,approve}=fixture({refineries:[{id:'K',name:'Kilang',gramsPerTael:37.5,advancePercent:90}],
    purchases:[{id:'L',operationalReady:true,agentId:'A',owner:'Pemilik',ownerVerified:true,weight:1,date,photo:'photo',invoiceStatus:'confirmed',amount:80,billDate:date}],
    dispatches:[{id:'PR',refineryId:'K',prNo:'P9',prOnly:true,assayIds:[],lotIds:[],lotWeights:{}}],
    assays:[{id:'AS',refineryId:'K',agentId:'A',owner:'Pemilik',prNo:'P9'}],
    sales:[{id:'INV',refineryId:'K',lotIds:[],amount:100}],receipts:[{id:'B',refineryId:'K',amount:90,date}]});
  approve(propose('pr','PR',{lotIds:['L'],prDate:date},staff));
  const dispatch={lotIds:['L'],date,prDate:date,photo:'photo'};
  assert.throws(()=>propose('dispatch','PR',dispatch,staff),/diterima/);
  assert.equal(state().dispatches[0].prOnly,true);
  add('process.save',{lotId:'L',mode:'skip',operator:'Ujian',date},staff);
  add('delivery.create',{lotIds:['L'],date,photo:'photo'},staff);
  const dl=state().deliveries[0];add('delivery.issue',{deliveryId:dl.id,basis:dl.formBasis,file:'bank'},staff);
  add('delivery.receive',{deliveryId:dl.id,receivedDate:date,receivedWeights:{L:1}},staff);
  approve(propose('dispatch','PR',dispatch,staff));
  approve(propose('assayLink','AS',{dispatchId:'PR',lotId:'L',owner:'Pemilik'},staff));
  approve(propose('assay','AS',{dispatchId:'PR',lotId:'L',date,reportNo:'AS99',before:1,after:0.95,purity:916},staff));
  approve(propose('sale','INV',{shipmentId:'PR',date,weight:1,price:3750,invoiceNo:'I9'}));
  approve(propose('receipt','B',{saleId:'INV',date,bankRef:'BK',amount:90}));
  approve(propose('settlement','INV',{}));
  add('sale.finalize',{saleId:'INV',date,adjustment:0,directCost:2,note:'Harga dan kos disemak dengan dokumen'},acct);
  add('sale.receive',{saleId:'INV',date,bankRef:'FINAL',amount:10,proof:'bank'},acct);
  const s=state();assert.equal(s.dispatches.length,1);assert.equal(s.dispatches[0].prOnly,false);
  assert.equal(s.assays.length,1);assert.equal(s.assays[0].id,'AS');assert.equal(s.sales.length,1);
  assert.equal(saleTotals(s,'INV').outstanding,0);assert.equal(saleTotals(s,'INV').profit,18);
});
