import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNewEvents, materialize } from '../src/events.mjs';
import { registerControl } from '../public/control.js';

test('pembetulan kekal tertunda sehingga pengurus kedua meluluskan dan sejarah asal dipelihara', () => {
  const user = { id:'pengurus-A',name:'Pengurus A',role:'management' };
  const reviewer = { id:'pengurus-B',name:'Pengurus B',role:'management' };
  const staff = { id:'staf-A',name:'Staf A',role:'staff' };
  const events = [], files = {}, now='2026-11-02T03:13:00Z';
  const add = (action,data,actor) => events.push(...applyNewEvents(events,[{action,data}],actor,files,now));
  const initial={code:'EMP',name:'Embum Permata',method:'WeBuy',bank:'Bank Ujian',account:'0004'};
  add('agent.create',initial,staff);
  const corrected={...initial,name:'Pembekal Contoh A'};
  add('correction.request',{target:1,values:corrected,reason:'Betulkan ejaan nama pendaftaran.'},user);
  assert.equal(materialize(events,files).agents[0].name,initial.name);
  assert.throws(()=>add('correction.approve',{request:2},user),/lain/);
  assert.throws(()=>add('correction.approve',{request:2},staff),/pengurusan/);
  add('correction.approve',{request:2},reviewer);
  const s=materialize(events,files);
  assert.equal(s.agents[0].name,'Pembekal Contoh A');
  assert.equal(s.corrections[0].reviewer,'Pengurus B');
  assert.equal(s.audit[0].original.name,'Embum Permata');
  assert.equal(s.audit[0].data.name,'Pembekal Contoh A');
  assert.throws(()=>add('correction.approve',{request:2},reviewer),/sudah disemak/);
  add('correction.request',{target:1,values:{...corrected,account:'0005'},reason:'Semakan nombor akaun.'},staff);
  add('correction.reject',{request:4},reviewer);
  assert.equal(materialize(events,files).agents[0].account,'0004');
});

test('audit menunjukkan butiran asal dan borang pembetulan memelihara ID, lampiran dan jenis nilai',async()=>{
  const pages={},clicks={};let view='',modal='',form,write;
  const orig={requestId:'PRQ-1',owner:'Bunga',weight:1.125,photo:'f-1',invoiceFile:''};
  const ui={
    state:{requests:[{id:'PRQ-1'}],audit:[{id:'EV-1',seq:1,now:'2026-11-01T00:00:00Z',user:'Staf A',role:'staff',action:'purchase.create',ref:'LOT-1',original:orig,data:orig}],corrections:[]},
    page:(key,cb)=>{pages[key]=cb;}, show:v=>{view=v.body;},dialog:(title,html)=>{modal=title+html;},close:()=>{},form:v=>{form=v;},
    link:(title,cb)=>{clicks[title]=cb;return title;},btn:(title,cb)=>{clicks[title]=cb;return title;},
    section:(label,html)=>label+html,table:(cols,rows)=>cols.join(' ')+rows.flat().join(' '),file:id=>id,esc:String,
    can:()=>false,act:async (action,data)=>{write={action,data};},
  };
  registerControl(ui);
  pages.audit({id:'LOT-1'});
  assert.match(view,/Pembelian emas/);
  clicks.Butiran();
  assert.match(modal,/f-1/);
  clicks['Mohon pembetulan']();
  assert.equal(form.fields.find(f=>f.key==='edit_photo').type,'file');
  await form.onSubmit({edit_requestId:'PRQ-1',edit_owner:'Bunga A',edit_weight:'1.125',edit_photo:'',edit_invoiceFile:'',explanation:'Betulkan pemilik'});
  assert.deepEqual(write,{action:'correction.request',data:{target:1,reason:'Betulkan pemilik',values:{...orig,owner:'Bunga A'}}});
});
