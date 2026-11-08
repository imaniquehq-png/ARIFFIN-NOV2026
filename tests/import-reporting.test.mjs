import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialState} from '../src/ledger.mjs';

// Mirror the web server's public module routes, including its /ledger.mjs alias.
const dir = await mkdtemp(join(tmpdir(), 'aj-reporting-'));
after(() => rm(dir, {recursive:true, force:true}));
await writeFile(join(dir, 'package.json'), '{"type":"module"}');
for (const file of ['src/ledger.mjs', 'public/report-data.js', 'public/report-documents.js', 'public/dashboard.js']) {
  await copyFile(new URL('../'+file, import.meta.url), join(dir, file.split('/').pop()));
}
const web = name => import(pathToFileURL(join(dir, name)));
const {reportResult, stockPosition} = await web('report-data.js');
const {buildDocument, documentChoices} = await web('report-documents.js');
const {registerDashboard} = await web('dashboard.js');

test('factory refund requests and vouchers show an outgoing payment once and never enter agent funding',()=>{
  const s=initialState();
  s.refineries.push({id:'F',name:'Kilang'});
  s.sales.push({id:'I',historical:true,refineryId:'F',date:'2026-01-03',amount:40,lotIds:[]});
  s.refundRequests=[{id:'RFQ',saleId:'I',refineryId:'F',date:'2026-01-04',requested:5,approved:5,paidAmount:5,status:'paid',receiptId:'RFK'}];
  s.receipts.push({id:'RFK',requestId:'RFQ',saleId:'I',refineryId:'F',date:'2026-01-05',kind:'refund',amount:-5,bankRef:'TRACE',proof:'PROOF'});
  assert.equal(reportResult(s,'requests',{refinery:'F'}).rows[0].transferred,5);
  assert.equal(reportResult(s,'funds').rows.length,0);
  assert.equal(buildDocument(s,'request','RFQ').totals[2][1],'RM 5.00');
  const voucher=buildDocument(s,'voucher','RFK');
  assert.equal(voucher.totals[0][1],'RM 5.00');
  assert.equal(voucher.files[0].id,'PROOF');
  assert.equal(reportResult(s,'refinerySOA').rows.find(r=>r.id==='RFK').dec,-5);
});

test('receipt notes are scoped to the acknowledgement; a corrected delivery needs a replacement form',()=>{
  const s=initialState();
  s.deliveries.push({id:'D',date:'2026-01-02',status:'received',receivedDate:'2026-01-03',receivedBy:'PENERIMA',receiveNote:'CATATAN',lotIds:[],weight:0,receivedWeights:{},formNeedsReissue:true});
  const form=buildDocument(s,'delivery','D');
  assert.doesNotMatch(JSON.stringify(form.meta),/PENERIMA|CATATAN/);
  assert.equal(documentChoices(s,'acknowledgement').length,0);
  assert.throws(()=>buildDocument(s,'acknowledgement','D'),/dibetulkan/);
});

test('separate event and ledger dates, retain movement source and follow related PR numbers',()=>{
  const s=initialState(),source={sheetId:'S',title:'Emas',column:'N:Z',rowNo:4};
  s.purchases.push({id:'A',historical:true,dateBasis:'goldLedgerDate',date:'2026-05-01',sourceDate:'2026-05-01',source,
    process:{id:'P',date:null,after:10,mode:'recorded',source:{...source,column:'R:S'}}});
  s.dispatches.push({id:'D',date:'2026-05-02',refineryId:'F',prNo:'PR-001',lotIds:['A']});
  s.assays.push({id:'Y',historical:true,dispatchId:'D',lotId:'A',sourceDate:'2026-05-01',date:null,reportNo:'LAB'});
  const range={from:'2026-05-01',to:'2026-05-01'};
  for(const type of ['purchases','owners','assays','processing']){
    assert.equal(reportResult(s,type,{ref:'pr-001'}).rows.length,1);
    assert.equal(reportResult(s,type,range).rows.length,0);
    assert.equal(reportResult(s,type,{...range,dateBasis:'source'}).rows.length,1);
  }
  const [record]=reportResult(s,'movements',{ref:'P',status:'Timbangan lejar'}).rows;
  assert.equal(record.sourceLabel,'Emas!R4:S4');
  assert.equal(record.origin,null);
});

test('SOA preserves the period opening and closing operating balances alongside dated source balances',()=>{
  const s=initialState(),source={sheetId:'SRC',title:'Ujian',column:'B',rowNo:4};
  s.agents.push({id:'A',name:'A'});
  s.requests.push({id:'Q',agentId:'A',date:'2026-01-01',requested:200});
  s.transfers.push({id:'T1',requestId:'Q',date:'2026-01-01',amount:100},
    {id:'H1',historical:true,source,agentId:'A',date:'2026-01-02',amount:50,sourceBalance:-50},
    {id:'T2',requestId:'Q',date:'2026-01-03',amount:20},
    {id:'H2',historical:true,source:{...source,rowNo:5},agentId:'A',date:'2026-01-04',amount:10,sourceBalance:-60});
  const doc=buildDocument(s,'supplierSOA','A',{from:'2026-01-02',to:'2026-01-04'});
  assert.deepEqual(doc.totals,[['Baki awal operasi','RM 100.00'],['Baki akhir operasi','RM 120.00'],['Baki akhir sumber · Ujian!B5','RM -60.00']]);
  const historicalOnlyDay=buildDocument(s,'supplierSOA','A',{from:'2026-01-02',to:'2026-01-02'});
  assert.equal(historicalOnlyDay.totals[1][1],'RM 100.00');
});

test('verified credit links remain source evidence without paying or posting a second bill; matched locks are counted once',()=>{
  const s=initialState();
  const lock={id:'K',lotId:'A',historical:true,weight:2,agentId:'E',number:'LOCK-1'};
  s.locks=[lock];
  s.purchases.push({id:'A',agentId:'E',weight:5,lockedWeight:2,locks:[lock],amount:45,invoiceStatus:'confirmed',invoiceNo:'SI1',requestId:'Q',date:'2026-01-06'});
  s.supplierCredits.push({id:'C',historical:true,classification:'purchase-invoice',lotId:'A',agentId:'E',amount:45,invoiceNo:'SI1'});
  const lines=reportResult(s,'supplierSOA').rows;
  assert.equal(lines.reduce((v,r)=>v+(r.dec||0),0),45);
  assert.equal(lines.find(r=>r.id==='C').sourceInvoiceAmount,45);
  const locks=reportResult(s,'locks').rows;
  assert.equal(locks.filter(r=>r.id==='K').length,1);
  assert.equal(locks.find(r=>r.unfilled!=null).unfilled,3);
});

test('a PR alone cannot establish shipment, pending assay, physical stock or a delivery order', () => {
  const s = initialState();
  s.purchases.push({id:'LOT', historical:true, agentId:'A', weight:null, invoiceStatus:'unknown'});
  s.dispatches.push({id:'PR', historical:true, prOnly:true, refineryId:'F', prNo:'P-1', lotIds:['LOT'], date:null, weight:null});
  assert.equal(stockPosition(s).unknown, true);
  assert.equal(reportResult(s, 'pending').rows.length, 0);
  assert.equal(reportResult(s, 'movements').rows.some(r => r.kind==='Ke kilang'), false);
  assert.equal(reportResult(s, 'deliveries').rows[0].prNo, 'P-1');
  assert.equal(reportResult(s, 'periods', {period:'week'}).rows[0].operations, 1);
  assert.deepEqual(documentChoices(s, 'dispatch'), []);
  assert.throws(() => buildDocument(s, 'dispatch', 'PR'), /Bukti penghantaran/);
  assert.match(JSON.stringify(buildDocument(s, 'stock', 'stock').totals), /Belum disahkan/);
  let page, body, chartControl={};
  const ui={state:s,page:(key,render)=>{page=render;},show:opts=>{body=opts.body;},
    esc:String, icon:()=>'', bind:()=>1, link:String, table:()=>'', rm:String, date:String,
    g:String, badge:String, glyphButton:()=>'', rerender(){}};
  const previous=globalThis.document;
  try {
    globalThis.document={querySelector:id=>{assert.equal(id,'#period');return body.includes('id="period"')?chartControl:null;}};
    registerDashboard(ui);
    page();
    assert.match(body, /Timbangan penerimaan dan penghantaran belum disahkan/);
    assert.match(body, /<svg class="chart" viewBox="0 0 650 169"/);
    chartControl.onchange({target:{value:'30'}});
    page();
    assert.match(body, /value="30" selected/);
  } finally {
    if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
  }
});

test('unallocated source cash and invoice documents stay out of verified balances and P&L', () => {
  const s = initialState();
  s.transfers.push({id:'T', historical:true, agentId:'A', amount:40, requestId:null, sourceBalance:-40});
  s.sales.push({id:'S', historical:true, refineryId:'F', status:'historical', amount:80, lotIds:[]},
    {id:'DOC', historical:true, historicalDocumentOnly:true, refineryId:'F', documentAmount:80});
  s.receipts.push({id:'R', historical:true, refineryId:'F', saleId:null, amount:60});
  assert.equal(reportResult(s,'funds',{agent:'A'}).rows[0].transferred,40);
  assert.equal(reportResult(s,'supplierSOA',{agent:'A'}).rows[0].balance,null);
  assert.equal(reportResult(s,'refinerySOA',{refinery:'F'}).rows.length,2);
  const profits=reportResult(s,'profit').rows;
  assert.equal(profits.length,1);
  assert.equal(profits[0].profit,null);
  const [period]=reportResult(s,'periods',{period:'month'}).rows;
  assert.equal(period.sales,80);
  assert.equal(period.receipts,60);
});

test('penyata assay menggunakan pemilik dan ejen yang tepat apabila nama sama', () => {
  const state=initialState(), owner='Nama dikongsi';
  state.agents.push({id:'A',name:'Ejen A'},{id:'B',name:'Ejen B'});
  state.dispatches.push({id:'D',lotIds:['L1','L2','L3','L4','L5'],prNo:'PR1',refineryId:'K'});
  const add=(id,agentId,ownerRef)=>{
    state.purchases.push({id,owner,agentId,ownerRef});
    state.assays.push({id:'ASY-'+id,lotId:id,dispatchId:'D',owner,agentId,ownerRef,reportNo:'AS-'+id,after:1,purity:916});
  };
  add('L1','A','Z'); add('L2','A','Z'); add('L3','B','Z'); add('L4','A',null); add('L5','A',null);
  const options=documentChoices(state,'assayOwner');
  assert.equal(options.length,4);
  const a=options.find(o=>o.label.includes('Ejen A')&&o.label.endsWith(' · Z'));
  const doc=buildDocument(state,'assayOwner',a.value);
  assert.deepEqual(doc.tables[0].rows.map(r=>r[0]),['L1','L2']);
  assert.deepEqual(doc.files,[]);
  assert.deepEqual(doc.photos,[]);
  assert.throws(()=>buildDocument(state,'assayOwner',JSON.stringify(['D',owner])),/Pilih rekod pemilik/);
  assert.throws(()=>buildDocument(state,'assayOwner','D',{owner,agentId:'A'}),/Pilih rekod pemilik/);
  assert.equal(buildDocument(state,'assayOwner','D',{owner,agentId:'B'}).tables[0].rows[0][0],'L3');
  const sole=options.find(o=>o.label.endsWith(' · L4'));
  assert.equal(buildDocument(state,'assayOwner',sole.value).tables[0].rows.length,1);
});
