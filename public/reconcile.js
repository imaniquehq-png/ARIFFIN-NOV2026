import {reconciliationTypes} from './reconciliation.mjs';

const tableLabels={transfers:'Pindahan ejen',supplierCredits:'Kredit pembekal',purchases:'Lot pembelian',locks:'MKS Lock',dispatches:'PR kilang',assays:'Assay',sales:'Invois jualan',receipts:'Terimaan kilang'};
const labels={requestId:'Payment Request',saleId:'Invois kilang',shipmentId:'Penghantaran fizikal ke kilang',dispatchId:'PR kilang',lotId:'Lot emas',lotIds:'Lot dalam dokumen (boleh pilih beberapa)',owner:'Pemilik emas',type:'Jenis emas',price:'Harga mengikut kaedah ejen atau kilang',weight:'Berat (g)',purity:'Mutu (‰)',invoiceNo:'Nombor invois',invoiceDate:'Tarikh invois',date:'Tarikh transaksi pada dokumen',dateTime:'Tarikh dan masa lock',prDate:'Tarikh PR',number:'Nombor MKS Lock',bankRef:'Rujukan bank',amount:'Jumlah yang diperuntukkan (RM)',photo:'Gambar emas',beforePhoto:'Gambar sebelum tarik',afterPhoto:'Gambar selepas tarik',before:'Berat sebelum (g)',after:'Berat selepas (g)',mode:'Pilihan proses',note:'Catatan timbangan',operator:'Pihak yang menjalankan proses',reportNo:'Nombor laporan assay'};
const refTables={requestId:'requests',saleId:'sales',shipmentId:'dispatches',dispatchId:'dispatches',lotId:'purchases',lotIds:'purchases'};
const financeKinds=new Set(['transfer','creditBill','creditReturn','receipt','sale','settlement']);
const opts=(value,label)=>({value,label});
export function registerReconcile(ui){
  const isSource=r=>r.historical||r.imported;
  const choice=(title,items,next)=>ui.form({title,fields:[{key:'selected',label:'Pilih',type:'select',required:true,options:items}],submitLabel:'Seterusnya',onSubmit:v=>next(v.selected)});
  function describe(r){return [r.id,r.invoiceNo||r.prNo||r.reportNo||r.bankRef,r.owner||r.partnerName,r.date,r.amount!=null?ui.rm(r.amount):''].filter(Boolean).join(' · ');}
  function possible(kind,r){
    if(financeKinds.has(kind)&&!ui.can('accountant'))return false;
    if(['purchase','dispatch','sale','assay','transfer'].includes(kind)&&r.operationalReady)return false;
    if(kind==='process')return !r.process||isSource(r.process);
    if(kind==='owner')return !r.ownerVerified;
    if(kind==='lock')return !r.lotId;
    if(kind==='receipt')return !r.saleId;
    if(kind==='settlement')return !r.settlementVerified&&(r.amount??r.documentAmount)!=null;
    if(kind==='pr')return r.prOnly;
    if(kind==='assayLink')return !r.lotId || !r.dispatchId;
    if(kind.startsWith('credit'))return r.classification==='unclassified';
    return true;
  }
  function edit(kind,r){
    const spec=reconciliationTypes[kind];
    const fields=spec.fields.split(' ').filter(Boolean).map(key=>{
      const def={key,label:labels[key],required:!['note','before','after','beforePhoto','afterPhoto'].includes(key)};
      if(refTables[key]){
        let options=ui.state[refTables[key]]||[];
        if(['assay','assayLink','pr','dispatch'].includes(kind)&&['lotId','lotIds'].includes(key))options=options.concat(ui.state.custodyLots||[]);
        if(key==='requestId')options=options.filter(x=>x.agentId===r.agentId && ['approved','active'].includes(x.status));
        if(key==='shipmentId')options=options.filter(x=>!x.prOnly && x.refineryId===r.refineryId);
        if(key==='dispatchId')options=options.filter(x=>x.prNo && (!r.refineryId||x.refineryId===r.refineryId));
        if(key==='saleId')options=options.filter(x=>x.refineryId===r.refineryId);
        if(key==='lotId' && r.agentId)options=options.filter(x=>x.agentId===r.agentId);
        return {...def,type:'select',multiple:key==='lotIds',options:options.map(x=>opts(x.id,describe(x))),value:r[key]||''};
      }
      if(['photo','beforePhoto','afterPhoto'].includes(key))return {...def,type:'file',accept:'image/jpeg,image/png,image/webp'};
      if(key==='mode')return {...def,type:'select',options:[opts('tarik','Tarik'),opts('skip','Tidak tarik')]};
      if(['date','prDate','invoiceDate'].includes(key))return {...def,type:'date',value:r[key]||''};
      if(key==='dateTime')return {...def,type:'datetime-local',value:r.dateTime||''};
      if(['before','after','weight','purity','amount','price'].includes(key)){
        const step=key==='amount'?'.01':key==='price'?'.0001':'.001';
        const method=kind==='sale'?'Tahil':ui.state.agents.find(a=>a.id===r.agentId)?.method;
        return {...def,label:key==='price'?'Harga ('+(method==='WeBuy'?'RM/g':'RM/tahil')+')':def.label,type:'number',step,min:step,value:key==='amount'?r.amount:(key==='weight'&&r.weight)||''};
      }
      return {...def,type:key==='note'?'textarea':'text',value:r[key]||''};
    });
    fields.push({key:'evidence',label:'Bukti asal (gambar atau PDF)',type:'file',accept:'application/pdf,image/jpeg,image/png,image/webp',required:true},
      {key:'reason',label:'Asas padanan mengikut dokumen',type:'textarea',required:true,maxlength:250});
    ui.form({title:spec.label,description:describe(r),fields,submitLabel:'Hantar untuk kelulusan',onSubmit:async v=>{
      const {evidence,reason,...values}=v;
      await ui.act('reconciliation.request',{kind,target:r.id,fields:values,evidence,reason});
    }});
  }
  const types=(table,r)=>Object.entries(reconciliationTypes).filter(([k,v])=>v.table===table && possible(k,r));
  ui.reconcile=(table,id)=>{
    if(!table){
      const available=Object.entries(tableLabels).filter(([k])=>(ui.state[k]||[]).some(r=>isSource(r)&&types(k,r).length));
      return choice('Pilih rekod untuk dipadankan',available.map(([k,v])=>opts(k,v)),v=>ui.reconcile(v));
    }
    const rows=(ui.state[table]||[]).filter(isSource);
    if(!id)return choice('Pilih '+tableLabels[table],rows.filter(r=>types(table,r).length).map(r=>opts(r.id,describe(r))),v=>ui.reconcile(table,v));
    const r=rows.find(x=>x.id===id);if(!r)return;
    const pending=ui.state.reconciliations?.find(p=>p.target===id&&p.status==='pending');
    if(pending)return review(pending);
    const kinds=types(table,r);
    if(!kinds.length)return ui.dialog('Padanan '+id,'<p>Tiada tindakan padanan untuk peranan atau status rekod ini.</p>');
    if(kinds.length===1)return edit(kinds[0][0],r);
    return choice('Padankan '+id,kinds.map(([k,v])=>opts(k,v.label)),kind=>edit(kind,r));
  };
  function review(p){
    const rows=Object.entries(p.fields).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>[ui.esc(labels[k]||k),['photo','beforePhoto','afterPhoto'].includes(k)?ui.file(v):ui.esc(Array.isArray(v)?v.join(', '):String(v))]);
    const decide=async approved=>{await ui.act(approved?'reconciliation.approve':'reconciliation.reject',{proposal:p.id});ui.close();ui.rerender();};
    const controls=p.status==='pending'&&p.by!==ui.user.id&&ui.can('management')?'<div class="actions">'+ui.btn('Luluskan padanan',()=>decide(true),'primary')+ui.btn('Tolak',()=>decide(false),'secondary')+'</div>':'';
    ui.dialog(reconciliationTypes[p.kind].label,'<p><strong>'+ui.esc(p.target)+'</strong> · '+ui.esc(p.byName)+'</p><p>'+ui.esc(p.reason)+'</p>'+ui.file(p.evidence,'Buka bukti asal')+ui.table(['Medan','Maklumat daripada bukti'],rows)+controls);
  }
  ui.reconciliationPanel=()=>{
    const open=(ui.state.reconciliations||[]).filter(p=>p.status==='pending');
    return open.length?ui.section('Padanan menunggu kelulusan',ui.table(['Rekod','Tindakan','Pemohon',''],open.map(p=>[ui.esc(p.target),ui.esc(reconciliationTypes[p.kind].label),ui.esc(p.byName),ui.link('Semak',()=>review(p))]))):'';
  };
}
