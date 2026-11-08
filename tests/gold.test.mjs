import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyLedger, priceAmount, requestTotals } from '../src/ledger.mjs';
import { applyGold } from '../src/gold.mjs';
import { applyNewEvents, materialize } from '../src/events.mjs';

function fixture() {
  const state = initialState();
  let serial = 0;
  const ctx = {
    now: '2026-10-05T02:00:00Z', user: { id: 'U', name: 'Kerani', role: 'staff' },
    id: prefix => prefix + '-' + (++serial), files: { image: { type: 'image/jpeg' }, pdf: { type: 'application/pdf' } },
  };
  const ledger = (action, data) => applyLedger(state, action, data, ctx);
  const act = (action, data) => applyGold(state, action, data, ctx);
  const day = '2026-10-04';
  function fund(name, method) {
    const agent = ledger('agent.create', { name, code: name, bank: 'Bank', account:'12345', method, gramsPerTael: '37.798125' });
    const r = ledger('request.create', { agentId:agent.id, date:day, requested:2000, purpose:'Belian' });
    ctx.user.role = 'management';
    ledger('request.approve', { requestId:r.id, approved:2000 });
    ctx.user.role = 'accountant';
    ledger('request.transfer', { requestId:r.id, amount:2000, proof:'pdf', bankRef:r.id, date:day });
    ctx.user.role = 'staff';
    return r;
  }
  function buy(r, owner, extra = {}) {
    return act('purchase.create', { requestId:r.id, owner, date:day, type:'Gelang', purity:916, weight:12.345,
      price:400, photo:'image', ...extra });
  }
  return { state, ctx, act, ledger, fund, buy, day };
}

test('dua pemilik kekal sepadan sepanjang tarik, terimaan sebenar, PR, assay dan jualan', () => {
  const { state, day, act, ledger, ctx, fund, buy } = fixture();
  const req1 = fund('Contoh B','Tahil'), req2 = fund('Contoh A','WeBuy');
  const p1 = buy(req1, 'Pemilik A', { invoiceNo:'A-1', invoiceFile:'pdf', price:15100.11 });
  const p2 = buy(req2, 'Pemilik B', { weight:3.456, price:311.1234 });
  assert.equal(p1.gramsPerTael, 37.798125);
  assert.equal(p1.amount, priceAmount('Tahil',12.345,15100.11,37.798125));
  assert.equal(p2.amount, 1075.24);
  assert.throws(() => buy(req1,'Pemilik C'), /baharu/);
  assert.equal(requestTotals(state,req1.id).purchased,0);
  ctx.user.role = 'accountant';
  ledger('purchase.confirm',{purchaseId:p1.id,date:day});
  assert.equal(requestTotals(state,req1.id).purchased,p1.amount);
  ledger('purchase.invoice',{purchaseId:p2.id,date:day,invoiceNo:'B-1',invoiceFile:'pdf'});
  ledger('purchase.confirm',{purchaseId:p2.id,date:day});
  ctx.user.role = 'staff';
  const lock = (number,weight) => act('mks.lock',{lotId:p1.id,number,dateTime:day+'T16:50',price:290,weight});
  lock('L1',10);
  assert.throws(()=>lock('L1',1),/sudah/);
  assert.throws(()=>lock('L2',3),/melebihi/);
  lock('L2',2.345);
  assert.equal(p1.lockedWeight,p1.weight);
  assert.equal(p1.locks.length,2);
  assert.equal(p2.lock,null);
  act('process.save',{lotId:p1.id,mode:'tarik',date:day,operator:'Pihak A',before:12.345,after:11.111,beforePhoto:'image',afterPhoto:'image'});
  act('process.save',{lotId:p2.id,mode:'skip',date:day});
  assert.equal(p1.process.loss,1.234);
  assert.equal(p2.process.loss,0);
  const selected = [p1.id,p2.id];
  const inward = { lotIds:selected, date:day, photo:'image' };
  assert.throws(()=>act('delivery.create',{...inward,lotIds:[p1.id,p1.id]}),/dua kali/);
  assert.throws(()=>act('delivery.create',{...inward,weight:14.568}),/tidak sepadan/);
  const d = act('delivery.create', inward);
  assert.equal(d.weight,14.567);
  assert.throws(()=>act('delivery.create',inward),/sudah/);
  const factory = ledger('refinery.create',{name:'Kilang A',code:'KA',gramsPerTael:37.798125});
  const outward = { lotIds:selected,refineryId:factory.id,date:day,photo:'image',document:'pdf' };
  assert.throws(()=>act('dispatch.create',outward),/perlu diterima/);
  const receive = { deliveryId:d.id,receivedDate:day,receivedWeights:{[p1.id]:11.100,[p2.id]:3.456} };
  assert.throws(()=>act('delivery.receive',receive),/borang penghantaran PDF/);
  assert.throws(()=>act('delivery.issue',{deliveryId:d.id,file:'image'}),/fail PDF/);
  assert.throws(()=>act('delivery.issue',{deliveryId:d.id,file:'pdf',basis:'old'}),/berubah/);
  act('delivery.issue',{deliveryId:d.id,file:'pdf',basis:d.formBasis});
  assert.equal(d.formIssuedBy,ctx.user.name);
  assert.throws(()=>act('delivery.receive',{...receive,receivedWeights:{[p1.id]:11.100}}),/setiap lot/);
  assert.throws(()=>act('delivery.receive',receive),/perbezaan/);
  act('delivery.receive',{...receive,note:'Lot A ditimbang 11.100g semasa penerimaan.'});
  assert.equal(d.receivedWeight,14.556);
  const ship = act('dispatch.create',outward);
  assert.equal(ship.weight,14.556);
  assert.throws(()=>act('dispatch.create',outward),/sudah dihantar/);
  const assay = { dispatchId:ship.id,lotId:p1.id,before:11.1,after:10.98,purity:925.43,date:day,reportNo:'AS-66',file:'pdf' };
  assert.throws(()=>act('assay.create',assay),/PR kilang/);
  act('dispatch.pr',{dispatchId:ship.id,prNo:'PR-111',prDate:day});
  const result = act('assay.create',assay);
  assert.equal(result.owner,'Pemilik A');
  assert.equal(result.agentId,req1.agentId);
  assert.equal(result.variance,0.12);
  assert.throws(()=>act('assay.create',assay),/sudah direkodkan/);
  const sale = ledger('sale.create',{shipmentId:ship.id,weight:ship.weight,price:17000,date:day});
  ctx.user.role = 'accountant';
  const final = { saleId:sale.id,date:day,adjustment:0,directCost:5,note:'Laporan dan harga disahkan.' };
  assert.throws(()=>ledger('sale.finalize',final),/assay/);
  const second = act('assay.create',{...assay,lotId:p2.id,before:3.456,after:3.300,purity:999.1});
  assert.equal(second.owner,'Pemilik B');
  assert.equal(second.variance,.156);
  ledger('sale.finalize',final);
  assert.equal(sale.status,'final');
});

test('emas sendiri dan konsainan melalui satu penghantaran tanpa bil belian rekaan', () => {
  const {state,act,ledger,ctx,day}=fixture();
  const source={date:day,weight:2,photo:'image'};
  assert.throws(()=>act('custody.create',{...source,ownership:'thirdParty',owner:'Pemilik luar'}),/rujukan tetap/);
  assert.throws(()=>act('custody.create',{...source,ownership:'ariffin',photo:'pdf'}),/gambar/);
  assert.throws(()=>act('custody.create',{...source,ownership:'ariffin',weight:-1}),/positif/);
  const own=act('custody.create',{...source,ownership:'ariffin'});
  const other=act('custody.create',{...source,ownership:'thirdParty',owner:'Syarikat Luar',ownerRef:'PEM-1',weight:3});
  assert.notEqual(own.id,other.id);
  assert.equal(own.owner,'Ariffin Jewels');
  assert.equal(state.purchases.length,0);
  assert.equal(state.requests.length,0);
  act('process.save',{lotId:other.id,mode:'tarik',date:day,before:3,after:2.9,beforePhoto:'image',afterPhoto:'image'});
  const lotIds=[own.id,other.id];
  const d=act('delivery.create',{date:day,lotIds,photo:'image'});
  assert.equal(d.weight,4.9);
  assert.equal(own.process,null);
  act('delivery.issue',{deliveryId:d.id,file:'pdf',basis:d.formBasis});
  act('delivery.receive',{deliveryId:d.id,receivedDate:day,receivedWeights:d.expectedWeights});
  const f=ledger('refinery.create',{name:'Kilang A',code:'KA',gramsPerTael:37.798125});
  const out=act('dispatch.create',{date:day,refineryId:f.id,lotIds,photo:'image',document:'pdf'});
  act('dispatch.pr',{dispatchId:out.id,prNo:'PR',prDate:day});
  const result=act('assay.create',{dispatchId:out.id,lotId:other.id,date:day,before:2.9,after:2.8,purity:999,reportNo:'A1',file:'pdf'});
  assert.equal(result.ownerRef,other.ownerRef);
  assert.equal(other.costVerified,false);
  const cost={lotId:other.id,cost:0,note:'Kos disahkan dalam perjanjian pemilik.',costProof:'pdf'};
  assert.throws(()=>act('custody.cost',cost),/akauntan/);
  ctx.user.role='accountant';
  assert.throws(()=>act('custody.cost',{...cost,costProof:''}),/lampiran/);
  assert.equal(act('custody.cost',cost).verifiedCost,0);
  assert.throws(()=>act('custody.cost',cost),/pembetulan/);
  assert.equal(state.transfers.length,0);
});

test('bukti foto, ketepatan gram dan tarikh dana disemak', () => {
  const { act, ledger, ctx, fund, buy, day } = fixture();
  const r = fund('Contoh A','WeBuy');
  assert.throws(()=>buy(r,'Pemilik',{photo:'pdf'}),/mesti fail gambar/);
  assert.throws(()=>buy(r,'Pemilik',{weight:1.00001}),/tempat perpuluhan/);
  assert.throws(()=>buy(r,'Pemilik',{date:'2026-09-01'}),/selepas/);
  assert.throws(()=>buy(r,'Pemilik',{photo:'missing'}),/Muat naik/);
  assert.throws(()=>buy(r,'Pemilik',{invoiceNo:'I-1'}),/bersama-sama/);
  ctx.user.role = 'accountant';
  ledger('request.return',{requestId:r.id,date:day,amount:2000,bankRef:'refund',proof:'pdf'});
  assert.throws(()=>buy(r,'Pemilik'),/baki/);
  ctx.user.role = 'anonymous';
  assert.throws(()=>act('process.save',{}),/Akses ditolak/);
});

test('pembetulan diluluskan memerlukan borang gantian dan mengekalkan PDF terdahulu serta timbangan sebenar',()=>{
  const {ctx,day}=fixture(),events=[];
  const files={...ctx.files,secondPhoto:{type:'image/jpeg'},pdf2:{type:'application/pdf'}};
  const manager={id:'M',name:'Penyelia',role:'management'};
  const add=(action,data,actor=ctx.user)=>{
    const [e]=applyNewEvents(events,[{action,data}],actor,files,ctx.now);
    events.push(e);
    return materialize(events,files);
  };
  const input={date:day,weight:1,photo:'image',ownership:'ariffin'};
  const lot=add('custody.create',input).custodyLots[0];
  const d=add('delivery.create',{date:day,photo:'image',lotIds:[lot.id]}).deliveries[0];
  assert.throws(()=>add('delivery.issue',{deliveryId:d.id,file:'pdf'}),/PDF/);
  add('delivery.issue',{deliveryId:d.id,file:'pdf',basis:d.formBasis});
  add('delivery.receive',{deliveryId:d.id,receivedDate:day,receivedWeights:{[lot.id]:1}});
  const beforeReview=add('correction.request',{target:1,values:{...input,photo:'secondPhoto'},reason:'Gambar lot diperbetulkan.'});
  assert.equal(beforeReview.deliveries[0].formFile,'pdf');
  const corrected=add('correction.approve',{request:5},manager).deliveries[0];
  assert.equal(corrected.formNeedsReissue,true);
  assert.equal(corrected.formFile,null);
  assert.equal(corrected.receivedWeights[lot.id],1);
  const factory=add('refinery.create',{name:'Kilang A',code:'KA',gramsPerTael:37.798125}).refineries[0];
  const outward={date:day,refineryId:factory.id,lotIds:[lot.id],photo:'image',document:'pdf'};
  assert.throws(()=>add('dispatch.create',outward),/gantian/);
  assert.throws(()=>add('delivery.issue',{deliveryId:d.id,file:'pdf2',basis:d.formBasis}),/berubah/);
  assert.throws(()=>add('delivery.issue',{deliveryId:d.id,file:'pdf',basis:corrected.formBasis}),/baharu/);
  const current=add('delivery.issue',{deliveryId:d.id,file:'pdf2',basis:corrected.formBasis}).deliveries[0];
  assert.equal(current.formNeedsReissue,false);
  assert.equal(current.formFile,'pdf2');
  assert.deepEqual(current.formHistory.map(r=>r.file),['pdf','pdf2']);
  assert.throws(()=>add('correction.request',{target:3,values:{deliveryId:d.id,file:'pdf2',basis:d.formBasis},reason:'Ganti fail.'}),/catatan transaksi/);
  assert.equal(add('dispatch.create',outward).dispatches[0].weight,1);
  const legacy=[...events.slice(0,2),{seq:3,now:ctx.now,user:ctx.user,action:'delivery.receive',
    data:{deliveryId:d.id,receivedDate:day,receivedWeights:{[lot.id]:1}}}].map(({schemaVersion,...old})=>old);
  assert.equal(materialize(legacy,files).deliveries[0].status,'received');
});
