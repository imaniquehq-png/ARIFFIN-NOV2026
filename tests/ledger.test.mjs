import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyLedger, priceAmount, requestTotals, saleTotals} from '../src/ledger.mjs';
import {applyGold} from '../src/gold.mjs';
import {applyNewEvents,materialize} from '../src/events.mjs';

const transactionDate = '2026-01-20';
const files = {photo:{type:'image/jpeg'},proof:{type:'application/pdf'},invoice:{type:'application/pdf'}};
function ledger() {
  let s = initialState(), seq=0;
  function run(role,action,data) {
    const next = structuredClone(s);
    const ctx={user:{id:role,role,name:role},now:transactionDate+'T00:00:00Z',id:p=>p+'-'+(++seq),files};
    const result=applyLedger(next,action,data,ctx) || applyGold(next,action,data,ctx);
    assert.ok(result);
    s=next;
    return result;
  }
  return {get s(){return s;},run};
}
const agentData = {name:'Kedai Ujian',code:'UJI',bank:'Bank Ujian',account:'000123456789',method:'WeBuy'};
function funded(l, amount=1000) {
  const agent=l.run('staff','agent.create',agentData);
  const r=l.run('staff','request.create',{agentId:agent.id,date:transactionDate,requested:amount,purpose:'Beli emas'});
  l.run('management','request.approve',{requestId:r.id,approved:amount});
  l.run('accountant','request.transfer',{requestId:r.id,date:transactionDate,amount,proof:'proof',bankRef:'BANK-A'});
  return r.id;
}
function purchase(l,requestId,weight,price) {
  const lot=l.run('staff','purchase.create',{requestId,owner:'Pemilik Ujian',date:transactionDate,type:'Barang kemas',purity:916,
    weight,price,photo:'photo'});
  l.run('staff','purchase.invoice',{purchaseId:lot.id,date:transactionDate,invoiceNo:'BIL-01',invoiceFile:'invoice'});
  l.run('accountant','purchase.confirm',{purchaseId:lot.id,date:transactionDate});
  return lot.id;
}
test('WeBuy dan Tahil ikut kontrak, pembundaran sen tepat',()=>{
  assert.equal(priceAmount('WeBuy',1,10.005),10.01);
  assert.equal(priceAmount('Tahil',18.75,20500,37.5),10250);
  assert.equal(priceAmount('Tahil',37.799,12000,37.799364),11999.88);
  assert.throws(()=>priceAmount('Tahil',1,100,0));
});
test('Peranan, bil, pindahan sebenar dan pulangan dipadankan mengikut permohonan',()=>{
  const l=ledger(), id=funded(l);
  assert.throws(()=>l.run('staff','request.transfer',{requestId:id,date:transactionDate,amount:10,proof:'proof',bankRef:'R'}));
  const lotId=purchase(l,id,2,455.24);
  assert.throws(()=>purchase(l,id,1,1));
  assert.throws(()=>l.run('staff','purchase.invoice',{purchaseId:lotId,invoiceNo:'changed',date:transactionDate,invoiceFile:'invoice'}));
  assert.throws(()=>l.run('accountant','request.return',{requestId:id,date:transactionDate,amount:89.53,proof:'proof',bankRef:'RET'}));
  assert.throws(()=>l.run('accountant','request.close',{requestId:id}));
  l.run('accountant','request.return',{requestId:id,date:transactionDate,amount:89.52,proof:'proof',bankRef:'RET'});
  l.run('accountant','request.close',{requestId:id});
  assert.deepEqual(requestTotals(l.s,id),{transferred:1000,purchased:910.48,returned:89.52,balance:0,refundable:0,payable:0,pendingPurchase:0,available:0,unreturnedExcess:0});
  assert.equal(l.s.requests[0].status,'closed');
});
test('Belian melebihi pindahan memerlukan kelulusan tambahan',()=>{
  const l=ledger(), id=funded(l), lotId=purchase(l,id,3,400);
  assert.equal(requestTotals(l.s,id).payable,200);
  const transfer={requestId:id,date:transactionDate,amount:200,bankRef:'BANK-B',proof:'proof'};
  assert.throws(()=>l.run('accountant','request.transfer',transfer));
  const a=l.run('staff','request.supplement',{requestId:id,date:transactionDate,amount:200,reason:'Bil akhir '+lotId});
  assert.throws(()=>l.run('accountant','request.supplementApprove',{requestId:id,supplementId:a.id}));
  l.run('management','request.supplementApprove',{requestId:id,supplementId:a.id});
  l.run('accountant','request.transfer',transfer);
  l.run('accountant','request.close',{requestId:id});
  assert.equal(requestTotals(l.s,id).balance,0);
});
test('Penyelesaian kilang 90/10 dan P&L memerlukan assay lot yang betul',()=>{
  const l=ledger(), id=funded(l), lotId=purchase(l,id,2,450);
  const kilang=l.run('staff','refinery.create',{name:'Kilang ujian',code:'K01',gramsPerTael:37.5,advancePercent:90});
  l.run('staff','process.save',{lotId,mode:'skip',date:transactionDate});
  const d=l.run('staff','delivery.create',{lotIds:[lotId],date:transactionDate,photo:'photo'});
  l.run('staff','delivery.issue',{deliveryId:d.id,file:'invoice',basis:d.formBasis});
  l.run('staff','delivery.receive',{deliveryId:d.id,receivedDate:transactionDate,receivedWeights:{[lotId]:2}});
  const ship=l.run('staff','dispatch.create',{refineryId:kilang.id,date:transactionDate,lotIds:[lotId],photo:'photo',document:'invoice'});
  const sale=l.run('staff','sale.create',{shipmentId:ship.id,date:transactionDate,weight:2,price:22500});
  assert.equal(sale.amount,1200);
  l.run('accountant','sale.receive',{saleId:sale.id,date:transactionDate,amount:1080,proof:'proof',bankRef:'F1'});
  const final={saleId:sale.id,date:transactionDate,adjustment:-20,directCost:40,note:'Harga dan kos disahkan'};
  assert.throws(()=>l.run('accountant','sale.finalize',final));
  l.run('staff','dispatch.pr',{dispatchId:ship.id,prNo:'PR-1',prDate:transactionDate});
  l.run('staff','assay.create',{dispatchId:ship.id,lotId,date:transactionDate,reportNo:'A-1',before:2,after:1.99,purity:916,file:'invoice'});
  l.run('accountant','sale.finalize',final);
  assert.deepEqual(saleTotals(l.s,sale.id),{net:1180,received:1080,outstanding:100,cost:900,directCost:40,profit:240});
  assert.throws(()=>l.run('accountant','sale.finalize',final));
  l.run('accountant','sale.receive',{saleId:sale.id,date:transactionDate,amount:100,proof:'proof',bankRef:'F2'});
  assert.equal(saleTotals(l.s,sale.id).outstanding,0);
  const e={saleId:sale.id,date:transactionDate,reference:'UUID-EXTERNAL',file:'invoice',status:'validated'};
  l.run('accountant','einvoice.record',e);
  assert.throws(()=>l.run('accountant','einvoice.record',e));
});
test('Event API rejects nonexistent proof and rolls back complete import on invalid row',()=>{
  const user={id:'lead',role:'management',name:'Pengurusan'},now=transactionDate+'T12:00:00Z';
  const committed=applyNewEvents([],[
    {action:'agent.create',data:agentData},
    {action:'request.create',data:{agentId:'AG-000001',date:transactionDate,requested:100,purpose:'Pembelian'}},
    {action:'request.approve',data:{requestId:'PRQ-000002',approved:100}}
  ],user,files,now);
  assert.throws(()=>applyNewEvents(committed,[
    {action:'request.transfer',data:{requestId:'PRQ-000002',date:transactionDate,amount:50,bankRef:'A1',proof:'proof'}},
    {action:'request.transfer',data:{requestId:'PRQ-000002',date:transactionDate,amount:50,bankRef:'A2',proof:'missing'}}
  ],user,files,now));
  assert.equal(materialize(committed,files).transfers.length,0);
});

test('Baki sementara, peranan rekonsiliasi dan lebihan terdahulu dikawal berasingan',()=>{
  const l=ledger(), first=funded(l);
  const lot=l.run('staff','purchase.create',{requestId:first,date:transactionDate,owner:'Emas ujian',type:'Barang kemas',purity:916,weight:2,price:400,photo:'photo'});
  assert.deepEqual(requestTotals(l.s,first),{transferred:1000,purchased:0,returned:0,balance:1000,pendingPurchase:800,available:200,unreturnedExcess:0,refundable:0,payable:0});
  assert.throws(()=>l.run('accountant','request.close',{requestId:first}),/Sahkan bil/);
  l.run('staff','purchase.invoice',{purchaseId:lot.id,date:transactionDate,invoiceNo:'AUD-BIL',invoiceFile:'invoice'});
  assert.throws(()=>l.run('management','purchase.confirm',{purchaseId:lot.id,date:transactionDate}),/akauntan/);
  l.run('accountant','purchase.confirm',{purchaseId:lot.id,date:transactionDate});
  assert.equal(requestTotals(l.s,first).unreturnedExcess,200);
  const r=l.run('staff','request.create',{agentId:l.s.agents[0].id,date:transactionDate,requested:300,purpose:'Belian kedua'});
  l.run('management','request.approve',{requestId:r.id,approved:300});
  const transfer={requestId:r.id,date:transactionDate,amount:300,bankRef:'AUD-PV',proof:'proof'};
  assert.throws(()=>l.run('accountant','request.transfer',transfer),/Pulangkan lebihan/);
  l.run('accountant','request.return',{requestId:first,date:'2026-01-22',amount:200,bankRef:'AUD-RTN',proof:'proof'});
  assert.throws(()=>l.run('accountant','request.transfer',transfer),/Pulangkan lebihan/);
  l.run('accountant','request.transfer',{...transfer,date:'2026-01-22'});
  assert.throws(()=>l.run('management','request.close',{requestId:first}),/akauntan/);
  l.run('accountant','request.close',{requestId:first});
});

function settlementFixture(percent=90,schemaVersion=2) {
  let state=initialState(),seq=0;
  state.purchases.push({id:'P1',amount:500,invoiceStatus:'confirmed',billDate:'2026-01-03'});
  state.dispatches.push({id:'DO1',lotIds:['P1'],refineryId:'K1',date:'2026-01-03'});
  state.refineries.push({id:'K1',gramsPerTael:37.5,advancePercent:percent});
  const submit=(role,action,data)=>{
    const next=structuredClone(state);
    const rec=applyLedger(next,action,data,{user:{id:role,role},schemaVersion,id:p=>p+(++seq),files,now:'2026-01-31T12:00:00Z'});
    state=next;
    return rec;
  };
  const sale=submit('staff','sale.create',{shipmentId:'DO1',date:'2026-01-04',weight:37.5,price:1000});
  const pay=(amount,bankRef,date='2026-01-04')=>submit('accountant','sale.receive',{saleId:sale.id,date,amount,bankRef,proof:'proof'});
  const finalize=(adjustment=0,date='2026-01-19')=>submit('accountant','sale.finalize',{saleId:sale.id,date,adjustment,directCost:20,note:'Harga dan assay disemak'});
  const assay=()=>state.assays.push({id:'A1',lotId:'P1',dispatchId:'DO1',date:'2026-01-17'});
  const propose=(amount,date='2026-01-19')=>submit('staff','sale.refundRequest',{saleId:sale.id,date,amount,purpose:'Pelarasan assay'});
  const approve=(r,amount)=>submit('management','sale.refundApprove',{saleId:sale.id,refundRequestId:r.id,approved:amount});
  const refund=(r,amount,bankRef,date)=>submit('accountant','sale.refund',{refundRequestId:r?.id,saleId:sale.id,date,amount,bankRef,proof:'proof'});
  return {get s(){return state},sale,pay,finalize,propose,approve,refund,assay,submit};
}
test('Pendahuluan terkumpul mengikut terma dan baki akhir mengikut tarikh pengesahan',()=>{
  const f=settlementFixture(80);
  f.pay(700,'B1');assert.throws(()=>f.pay(100.01,'B2'));f.pay(100,'B2');
  f.assay();
  assert.throws(()=>f.finalize(0,'2026-01-16'),/Tarikh/);
  assert.throws(()=>f.pay(1,'B3','2026-01-17'),/pendahuluan/);
  f.finalize();assert.throws(()=>f.pay(200,'B3','2026-01-18'),/pendahuluan/);
  f.pay(200,'B3','2026-01-19');assert.equal(saleTotals(f.s,f.sale.id).outstanding,0);
  assert.throws(()=>settlementFixture(0).pay(0.01,'B0'));
  const full=settlementFixture(100);full.pay(1000,'B100');
  const old=settlementFixture(90,1);old.pay(1000,'LEGACY');assert.equal(saleTotals(old.s,old.sale.id).received,1000);
});
test('Nilai disahkan lebih rendah daripada pendahuluan menghasilkan kredit dan pemulangan bank',()=>{
  const f=settlementFixture();
  f.pay(900,'PRE','2026-01-21');f.assay();f.finalize(-200);
  assert.equal(saleTotals(f.s,f.sale.id).outstanding,-100);
  assert.throws(()=>f.propose(100,'2026-01-18'),/Tarikh/);
  assert.throws(()=>f.refund(null,100,'R1','2026-01-21'),/Permohonan/);
  const r=f.propose(100);
  assert.throws(()=>f.propose(20),/terdahulu/);
  assert.throws(()=>f.refund(r,100,'R1','2026-01-21'),/Kelulusan/);
  assert.throws(()=>f.submit('accountant','sale.refundApprove',{saleId:f.sale.id,refundRequestId:r.id,approved:100}),/pengurusan/);
  f.approve(r,60);
  assert.throws(()=>f.refund(r,60,'R1','2026-01-20'),/tarikh/);
  assert.throws(()=>f.refund(r,61,'R1','2026-01-21'));
  assert.equal(f.refund(r,60,'R1','2026-01-21').amount,-60);
  assert.throws(()=>f.refund(r,60,'R2','2026-01-21'),/Kelulusan/);
  const last=f.propose(40);f.approve(last,40);
  assert.throws(()=>f.refund(last,40,'R1','2026-01-21'),/digunakan/);
  assert.equal(f.refund(last,40,'R2','2026-01-22').kind,'refund');
  assert.deepEqual(saleTotals(f.s,f.sale.id),{net:800,received:800,outstanding:0,cost:500,directCost:20,profit:280});
});
test('Kos jagaan memerlukan bukti sebelum untung boleh dimuktamadkan',()=>{
  const f=settlementFixture(),sale=f.s.sales[0];
  sale.lotIds.push('J1');
  f.s.custodyLots.push({id:'J1',owner:'AJ'});
  f.s.assays.push({id:'AJ1',lotId:'J1',dispatchId:'DO1',date:'2026-01-17'});
  f.assay();assert.equal(saleTotals(f.s,sale.id).profit,null);
  assert.throws(()=>f.finalize(),/kos lot/);
  Object.assign(f.s.custodyLots[0],{costVerified:true,verifiedCost:100});
  f.finalize();assert.equal(saleTotals(f.s,sale.id).profit,380);
});
