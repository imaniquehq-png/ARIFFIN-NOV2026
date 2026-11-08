import test from 'node:test';
import assert from 'node:assert/strict';
import {applyNewEvents,materialize} from '../src/events.mjs';
import {nativeChanges} from '../src/import-operations.mjs';

const owner={id:'owner',role:'management',name:'Pengurus'};
const now='2026-05-01T10:00:00Z';
const entry=(seq,action,data)=>({seq,action,data,now,user:owner});

test('real source debits join an existing supplier without fabricating an approval or bank confirmation',()=>{
  const base=[entry(1,'agent.create',{name:'Pembekal contoh',code:'P1',bank:'Bank',account:'123',method:'WeBuy'})];
  const state=materialize(base,{});
  const source=[{sheet:{sheetId:'101',role:'supplier',partner:'Pembekal contoh',title:'Pembekal contoh',headers:[]},
    rows:[{rowNo:3,kind:'cash',effective:{A:46001},values:['10 Dec 25','45.25',null,'-45.25']},
          {rowNo:4,kind:'calculation',values:[null,'45.25',null,'-45.25']}]}];
  const changes=nativeChanges(state,source);
  const events=[...base,entry(2,'sheet.records',{entries:changes})];
  const restored=materialize(events,{});
  assert.equal(restored.agents.length,1);
  assert.equal(restored.agents[0].code,'P1');
  assert.equal(restored.agents[0].account,'123');
  assert.equal(restored.transfers.length,1);
  assert.equal(restored.transfers[0].amount,45.25);
  assert.equal(restored.transfers[0].agentId,restored.agents[0].id);
  assert.equal(restored.transfers[0].bankRef,null);
  assert.equal(restored.requests.length,0);
  assert.throws(()=>applyNewEvents(events,[{action:'sheet.records',data:{entries:changes}}],owner,{},now),/migrasi/);
  assert.throws(()=>applyNewEvents(events,[{action:'correction.request',data:{target:2,reason:'Semak',values:{}}}],owner,{},now),/sah/);
  const [created]=applyNewEvents(events,[{action:'request.create',data:{agentId:restored.agents[0].id,
    date:'2026-05-01',requested:100,purpose:'Pembelian seterusnya'}}],owner,{},now);
  assert.equal(materialize([...events,created],{}).requests[0].requested,100);
});
