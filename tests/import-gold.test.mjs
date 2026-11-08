import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/ledger.mjs';
import {importGold} from '../src/import-gold.mjs';

function row(n,cells,formulas={}) {
  const values=Array(27).fill(null),effective={};
  for(const [col,v] of Object.entries(cells)){values[col.charCodeAt(0)-65]=String(v);effective[col]=v;}
  return {rowNo:n,kind:'gold',values,effective,formulas};
}
function tab(sheetId,role,partner,rows) {
  const headers=Array(27).fill(null);
  Object.assign(headers,{6:'MKS LOCK',14:'PR NUMBER',16:'ASSAY',18:'EMAS - SELEPAS TARIK',22:'HARGA PER GRAM'});
  return {sheet:{sheetId,title:partner,partner,role,headers},rows};
}
const supplier='Kedai Ujian';
const partners=new Map([['1',{id:'AG-1',name:supplier,method:'Tahil'}],['2',{id:'KLG-2',name:'Kilang Ujian'}]]);
test('harga, timbangan, PR dan assay sejarah dikekalkan tanpa gandaan atau terimaan rekaan',()=>{
  const sheets=[
    tab('1','supplier',supplier,[
      row(3,{F:'2026-08-01',L:100,N:'2026-08-03',P:'A-123',Q:900,R:13,S:12,T:10.8,U:4,W:70,X:280,Z:'INV-A'},{T:'=S3*Q3/1000',X:'=U3*W3'}),
      row(4,{S:12,T:10.8,U:6.8,W:71,X:482.8},{S:'=S3',T:'=T3',U:'=T3-U3',X:'=U4*W4'}),
      row(5,{S:24,U:10.8,W:70,X:762.8},{S:'=SUM(S3:S4)',X:'=SUM(X3:X4)'}),
      row(6,{U:1,W:73,X:73},{X:'=U6*W6'}),
    ]),
    tab(2,'refinery','Kilang Ujian',[
      row(9,{O:'PR-7',P:'A-123',Q:900,R:supplier,S:12,T:10.8},{T:'=S9*Q9/1000'}),
      row(10,{O:'PR-7',P:'A/123',Q:900,R:'Pemilik lain',S:4,T:3.6},{T:'=S10*Q10/1000'}),
    ]),
  ];
  const s=importGold(initialState(),sheets,partners);
  assert.equal(s.purchases.length,1);
  const [lot]=s.purchases;
  assert.equal(lot.weight,null);
  assert.equal(lot.recordedWeight,13);
  assert.equal(lot.weightBasis,'beforePull');
  assert.equal(lot.process.loss,1);
  assert.equal(lot.owner,supplier);
  assert.equal(lot.priceUnit,'RM/g');
  assert.equal(lot.amount,762.8);
  assert.equal(lot.invoiceStatus,'recorded');
  assert.equal(lot.photo,null);
  assert.equal(s.goldAllocations.length,3);
  assert.deepEqual(s.goldAllocations.map(x=>x.lotId),[lot.id,lot.id,null]);
  assert.equal(s.locks[0].lotId,null);
  assert.equal(s.locks[0].price,null);
  assert.equal(s.locks[0].dateTime,null);
  assert.equal(s.dispatches.length,1);
  assert.equal(s.dispatches[0].prOnly,true);
  assert.deepEqual(s.dispatches[0].lotIds,[lot.id]);
  assert.equal(s.dispatches[0].weight,null);
  assert.equal(s.dispatches[0].sourceRows.length,2);
  assert.deepEqual(s.assays.map(a=>a.lotId),[lot.id,null]);
  assert.equal(s.assays[0].dispatchId,s.dispatches[0].id);
  assert.equal(s.assays[0].afterBasis,'fineGoldEquivalent');
  assert.equal(s.assays[0].variance,null);
  assert.equal(s.deliveries.length,0);
  const previous=structuredClone(s);
  importGold(s,sheets,partners);
  assert.deepEqual(s,previous);
});

test('padanan nombor laporan berulang, pemilik bercanggah dan unit mutu tidak disahkan kekal terbuka',()=>{
  const sheets=[tab('1','supplier',supplier,[row(3,{P:'R1',S:12,Q:90})]),
    tab('2','refinery','Kilang Ujian',[row(3,{O:'PR-1',P:'R1',Q:90,R:'Pemilik lain',S:12}),row(5,{O:'PR/1',P:'R1',Q:91,R:supplier,S:10})])];
  const s=importGold(initialState(),sheets,partners);
  assert.equal(s.purchases.length,1);
  assert.equal(s.purchases[0].weightBasis,'afterPull');
  assert.equal(s.purchases[0].process.mode,'recorded');
  assert.equal(s.purchases[0].ownerVerified,false);
  assert.equal(s.assays.length,2);
  assert.equal(s.dispatches.length,2);
  assert.ok(s.assays.every(a=>a.lotId===null && a.purity===null && a.file===null));
  assert.deepEqual(s.assays.map(a=>a.sourcePurity),[90,91]);
});
