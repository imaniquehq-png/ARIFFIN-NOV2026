import {requestTotals,saleTotals} from './ledger.mjs';
import {fromLedger,ledgerOnly,reportResult,stockPosition} from './report-data.js';
const dateKey=(offset=0)=>new Date(Date.now()+8*3600000+offset*86400000).toISOString().slice(0,10);
const short=(n,dp=0)=>Number(n).toLocaleString('en-MY',{minimumFractionDigits:dp,maximumFractionDigits:dp});
const sum=(a,fn)=>a.reduce((t,x)=>t+fn(x),0);
const needsLock=p=>p.weight==null||(p.lockedWeight==null&&ledgerOnly(p))||(p.lockedWeight||0)<p.weight;
const missingInvoice=p=>!p.invoiceNo&&!p.invoiceFile;
const gramsSum=(rows,key)=>sum(rows,r=>Math.round((r[key]||0)*1000))/1000;
function plot(s,days,ui){
  const bins=days===7?7:6;
  const {icon,esc}=ui;
  const dates=Array.from({length:bins},(_,i)=>({start:dateKey(-days+1+Math.floor(days*i/bins)),end:dateKey(-days+Math.floor(days*(i+1)/bins))}));
  const data=dates.map(({start,end})=>({
    label:new Intl.DateTimeFormat('ms-MY',days===7?{weekday:'short'}:{day:'numeric',month:'short'}).format(new Date(start+'T12:00:00Z')),
    full:start===end?ui.date(start):ui.date(start)+' – '+ui.date(end),
    received:sum(s.deliveries.filter(d=>d.status==='received' && d.receivedDate>=start && d.receivedDate<=end),d=>d.receivedWeight||0),
    sent:sum(s.dispatches.filter(d=>!d.prOnly&&d.date>=start&&d.date<=end),d=>d.weight)
  }));
  const top=Math.max(1,...data.flatMap(d=>[d.received,d.sent])),unit=Math.pow(10,Math.floor(Math.log10(top))),step=Math.ceil(top/(unit*.25*4))*unit*.25,limit=step*4;
  const width=650,height=169,pad=41,bottom=139,left=pad,right=width-12,group=(right-left)/bins,bw=Math.min(14,group*.21);
  let marks='';for(let i=0;i<5;i++){const y=bottom-116*i/4;marks+='<line x1="'+left+'" x2="'+right+'" y1="'+y+'" y2="'+y+'" stroke="#e6eae7" stroke-dasharray="3 5"/><text x="'+(left-10)+'" y="'+(y+4)+'" text-anchor="end">'+short(step*i,step<1?2:step%1?1:0)+'</text>'}
  data.forEach((d,i)=>{const cx=left+group*(i+.5),h1=116*d.received/limit,h2=116*d.sent/limit;
    const title=esc(d.full+' · Diterima '+ui.g(d.received)+' · Ke kilang '+ui.g(d.sent));
    marks+='<g tabindex="0" aria-label="'+title+'"><title>'+title+'</title><rect x="'+(cx-bw-2)+'" y="'+(bottom-h1)+'" width="'+bw+'" height="'+h1+'" rx="3" fill="#28654e"/><rect x="'+(cx+2)+'" y="'+(bottom-h2)+'" width="'+bw+'" height="'+h2+'" rx="3" fill="#cda95d"/><text x="'+cx+'" y="'+(bottom+20)+'" text-anchor="middle">'+esc(d.label)+'</text></g>';
  });
  return '<div class="chart-unit">Berat (g)</div><svg class="chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Carta berat harian diterima dan dihantar ke kilang">'+marks+'</svg><div class="chart-legend"><span><i></i>Diterima</span><span><i></i>Ke kilang</span></div><details class="chart-table"><summary>Data carta</summary>'+ui.table(['Tempoh','Diterima','Ke kilang'],data.map(d=>[esc(d.full),ui.g(d.received),ui.g(d.sent)]))+'</details>';
}
export function registerDashboard(ui){
  let days=7,tab='Semua';
  ui.page('dashboard',()=>{
    const s=ui.state,e=ui.esc,ico=ui.icon,bind=ui.bind;
    const shipments=s.dispatches.filter(d=>!d.prOnly),shipmentLot=new Set(shipments.flatMap(d=>d.lotIds||[])),stockInfo=stockPosition(s);
    const sales=s.sales.filter(x=>!x.historicalDocumentOnly),settlements=sales.map(x=>saleTotals(s,x.id));
    const due=sum(settlements,x=>Math.max(0,x.outstanding||0)),credit=sum(settlements,x=>Math.max(0,-(x.outstanding||0))),dueUnknown=settlements.some(x=>x.outstanding==null)||s.receipts.some(r=>fromLedger(r)&&!r.saleId);
    const paid=sum(s.transfers,t=>Math.round(t.amount*100))/100,sourceTransfers=s.transfers.filter(fromLedger);
    const requests=s.requests.filter(x=>x.status==='pending'),unlocked=s.purchases.filter(needsLock),noInvoice=s.purchases.filter(missingInvoice);
    const assayed=new Set(s.assays.map(a=>a.lotId)),pending=[...shipmentLot].filter(id=>!assayed.has(id)),agents=new Map(s.agents.map(a=>[a.id,a.name]));
    const physical=new Map([...s.purchases,...(s.custodyLots||[])].map(l=>[l.id,l])),refineries=new Map(s.refineries.map(f=>[f.id,f.name]));
    const other=[
      ...s.purchases.filter(p=>!missingInvoice(p)&&p.invoiceStatus!=='confirmed').map(p=>[p.id,p.owner||agents.get(p.agentId),p.invoiceFile?'Invois menunggu pengesahan':'Salinan invois belum diterima','purchases',p.id]),
      ...s.deliveries.filter(d=>d.status!=='received'||d.formNeedsReissue).map(d=>[d.id,'Ariffin Jewels',d.formNeedsReissue?'Borang dibetulkan perlu dikeluarkan semula':'Menunggu timbangan penerimaan','deliveries',d.id]),
      ...shipments.filter(d=>!d.prNo).map(d=>[d.id,refineries.get(d.refineryId),'Nombor PR belum diterima','shipments',d.id]),
      ...(s.locks||[]).filter(k=>!k.lotId).map(k=>[k.id,agents.get(k.agentId)||refineries.get(k.refineryId),'MKS lejar belum dipadankan kepada lot','locks',k.id,'locks']),
      ...s.assays.filter(a=>ledgerOnly(a)&&(!a.lotId||!a.ownerVerified)).map(a=>[a.id,a.owner,'Assay memerlukan pengesahan lot / pemilik','assays',a.id,'assays']),
      ...s.requests.filter(r=>requestTotals(s,r.id).unreturnedExcess>0).map(r=>[r.id,agents.get(r.agentId),'Lebihan disahkan belum dipulangkan','requests',r.id]),
      ...s.supplements.filter(r=>r.status==='pending').map(r=>[r.id,agents.get(s.requests.find(q=>q.id===r.requestId)?.agentId),'Tambahan dana menunggu kelulusan','requests',r.requestId]),
      ...(s.refundRequests||[]).filter(r=>r.status==='pending'||r.status==='approved').map(r=>[r.id,refineries.get(r.refineryId),r.status==='approved'?'Pemulangan kilang menunggu pindahan':'Pemulangan kilang menunggu kelulusan','sales',r.saleId]),
      ...s.corrections.filter(c=>c.status==='pending').map(c=>[c.id,c.user?.name,'Pembetulan menunggu kelulusan','audit',c.id]),
      ...s.sales.filter(r=>r.status==='provisional').map(r=>[r.id,refineries.get(r.refineryId),'Jualan menunggu penyelesaian akhir','sales',r.id]),
      ...s.receipts.filter(r=>!r.saleId).map(r=>[r.id,refineries.get(r.refineryId),'Terimaan belum dipadankan','refineries',r.refineryId,'receipts']),
      ...s.transfers.filter(r=>!r.requestId).map(r=>[r.id,agents.get(r.agentId),'Pindahan belum dipadankan','agents',r.agentId,'transfers']),
      ...(s.supplierCredits||[]).filter(r=>r.classification!=='purchase-invoice'&&!r.requestId&&!r.operationalReady).map(r=>[r.id,agents.get(r.agentId),'Kredit pembekal belum dikelaskan','agents',r.agentId,'supplierCredits']),
      ...(s.reconciliations||[]).filter(r=>r.status==='pending').map(r=>[r.id,r.byName,'Padanan bukti menunggu kelulusan','audit',r.target]),
    ];
    const jumps=[
      ['wallet','Permohonan dana',requests.length,'requests'],['lock','MKS belum lengkap',unlocked.length,'locks'],['file','Invois belum diterima',noInvoice.length,'purchases'],['assay','Menunggu assay',pending.length,'assays'],['file','Semakan lain',other.length,'other']
    ];
    const intro='<div class="date-line">'+ico('calendar',15)+e(new Intl.DateTimeFormat('ms-MY',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kuala_Lumpur'}).format(new Date()))+'</div>';
    const stat=(glyph,label,n,caption,key,tone)=>'<button class="metric" data-action="'+bind(()=>key==='reports'?ui.go('reports',{type:'funds'}):ui.go(key))+'"><div class="metric-head"><span class="icon-tile '+tone+'">'+ico(glyph,21)+'</span>'+ico('up',15)+'</div><h2>'+label+'</h2><strong>'+n+'</strong><small>'+caption+'</small></button>';
    const stockValue=stockInfo.unknown?'—':short(stockInfo.knownWeight,3)+' <em>g</em>';
    const stockCaption=stockInfo.unknown?(stockInfo.held.length?ui.g(stockInfo.knownWeight)+' ditimbang · baki sejarah belum disahkan':'Penerimaan dan penghantaran belum dipadankan'):stockInfo.held.length+' lot di Ariffin Jewels';
    const stock='<div class="stock-card"><div class="stock-photo"></div><div class="stock-body"><div class="stock-label">'+ico('gold',19)+'Stok emas di tangan</div><strong>'+stockValue+'</strong><p>'+stockCaption+'</p><button data-action="'+bind(()=>ui.printDoc('stock','stock'))+'">Semak stok '+ico('arrow',15)+'</button></div></div>';
    const paidCaption=sourceTransfers.length?s.transfers.length+' pindahan · '+sourceTransfers.length+' daripada lejar':s.transfers.length+' pindahan kepada ejen';
    const dueCaption=dueUnknown?(due>0?ui.rm(due)+' dipadankan · baki sejarah belum disahkan':'Terimaan belum dipadankan dengan invois'):settlements.filter(x=>x.outstanding>0).length+' invois kilang berbaki';
    const metrics='<div class="metrics">'+stock+stat('wallet','Dana dipindahkan',ui.rm(paid),paidCaption,sourceTransfers.length?'reports':'requests','mint')+stat('bank','Belum diterima',dueUnknown?'—':ui.rm(due),dueCaption,'sales','sand')+'</div>';
    const missingMovements=stockInfo.unknown&&!s.deliveries.length&&!shipments.length;
    const chartSubtitle=missingMovements?'Timbangan penerimaan dan penghantaran belum disahkan':'Berat diterima dan dihantar ke kilang';
    const chart='<section class="panel chart-panel"><header class="panel-head"><div><h2>Pergerakan emas</h2><p>'+chartSubtitle+'</p></div><select class="compact" id="period" aria-label="Tempoh carta"><option value="7" '+(days===7?'selected':'')+'>7 hari</option><option value="30" '+(days===30?'selected':'')+'>30 hari</option></select></header>'+plot(s,days,ui)+'</section>';
    function followUp(kind,title){
      const queues={
        requests:requests.map(r=>[r.id,agents.get(r.agentId),ui.rm(r.requested),'requests',r.id]),
        locks:unlocked.map(p=>[p.id,p.owner||agents.get(p.agentId),fromLedger(p)&&p.lockedWeight==null?'Padanan lot belum disahkan':ui.g(p.weight-(p.lockedWeight||0)),'purchases',p.id]),
        purchases:noInvoice.map(p=>[p.id,p.owner||agents.get(p.agentId),'Tiada nombor atau salinan invois','purchases',p.id]),
        assays:pending.map(id=>{const p=physical.get(id),d=shipments.find(x=>x.lotIds.includes(id));return [id,p?.owner,d.prNo||'Menunggu PR','shipments',d.id]}),
        other
      };
      const rows=queues[kind].map(([id,party,info,page,target,collection])=>{
        const open=()=>{ui.close();if(collection&&ui.reconcile)ui.reconcile(collection,id);else ui.go(page,{id:target});};
        return [ui.link(id,open),e(party||'—'),e(info),ui.link('Buka',open)];
      });
      ui.dialog(title,rows.length?ui.table(['Rujukan','Pihak berkaitan','Butiran',''],rows):'<p>Semua rekod telah disemak.</p>');
    }
    const needs='<section class="panel action-panel"><header class="panel-head"><div><h2>Perlu tindakan</h2><p>Rekod yang memerlukan susulan</p></div></header><div class="follow-list">'+jumps.map(([ic,txt,count,page])=>'<button data-action="'+bind(()=>followUp(page,txt))+'">'+ico(ic,18)+'<span>'+txt+'</span><b class="'+(count?'warn':'')+'">'+count+'</b>'+ico('right',13)+'</button>').join('')+'</div></section>';
    const recentLots=[...s.purchases].reverse();if(recentLots.some(fromLedger))recentLots.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const lotRows=recentLots.filter(p=>tab==='Semua'||(tab==='Belum lock'?needsLock(p):missingInvoice(p))).slice(0,6).map(p=>{
      const unknown=fromLedger(p)&&(p.lockedWeight==null||p.weight==null),locked=!unknown&&(p.lockedWeight||0)>=p.weight;
      const weight=p.weight!=null?ui.g(p.weight):p.recordedWeight!=null?ui.g(p.recordedWeight)+' · '+(p.weightBasis==='beforePull'?'sebelum tarik':'selepas tarik'):'—';
      return [ui.link(p.id,()=>ui.go('purchases',{id:p.id})),e(p.owner||(agents.get(p.agentId)?'Ejen · '+agents.get(p.agentId):'—')),ui.date(p.date),'<span class="numeric">'+weight+'</span>',ui.badge(unknown?'Belum dipadankan':locked?'Locked':p.lockedWeight?'Lock separa':'Pending Lock',locked?'green':'amber'),ui.link('Buka',()=>ui.go('purchases',{id:p.id}))];
    });
    const recent='<section class="panel recent"><header class="panel-head"><div><h2>Lot emas terkini</h2><p>Pembelian mengikut pemilik dan status lock</p></div>'+ui.link('Lihat semua →',()=>ui.go('purchases'))+'</header><div class="tabs">'+['Semua','Belum lock','Tiada invois'].map(t=>'<button class="'+(tab===t?'active':'')+'" data-action="'+bind(()=>{tab=t;ui.rerender()})+'">'+t+'</button>').join('')+'</div>'+(lotRows.length?ui.table(['No. lot','Pemilik emas',recentLots.some(fromLedger)?'Tarikh rekod':'Tarikh belian',recentLots.some(fromLedger)?'Berat direkod':'Berat asal','Status MKS',''],lotRows):'<p class="empty">Belum ada lot bagi pilihan ini.</p>')+'</section>';
    const breakdown=s.agents.map(a=>{
      const p=s.purchases.filter(x=>x.agentId===a.id),req=s.requests.filter(x=>x.agentId===a.id);
      const importedCash=s.transfers.some(t=>t.agentId===a.id&&fromLedger(t)&&!t.requestId)||(s.supplierCredits||[]).some(c=>c.agentId===a.id&&c.classification!=='purchase-invoice'&&!c.requestId&&!c.operationalReady);
      const totals=req.map(r=>requestTotals(s,r.id)),known=p.filter(l=>l.weight!=null),unknown=p.length-known.length;
      const weight=(known.length||!unknown?ui.g(gramsSum(known,'weight')):'')+(unknown?(known.length?' · ':'')+unknown+' lot tanpa berat asal':'');
      const excess=importedCash&&!req.length?'—':ui.rm(sum(totals,t=>t.unreturnedExcess));
      const available=totals.filter(t=>t.available!=null),availableText=(available.length||!totals.length?ui.rm(sum(available,t=>t.available)):'—')+(available.length<totals.length?' · nilai belian belum lengkap':'');
      return [e(a.name),importedCash&&!req.length?'—':ui.rm(sum(req,x=>x.requested)),importedCash&&!req.length?'—':availableText,excess+(importedCash?' · baki lejar belum dipadankan':''),weight];
    });
    const processes=[...physical.values()].map(l=>l.process).filter(p=>p&&p.mode!=='skip'),final=sales.filter(x=>x.status==='final');
    const measured=key=>{const known=processes.filter(p=>p[key]!=null),missing=processes.length-known.length;return (known.length||!missing?ui.g(gramsSum(known,key)):'—')+(missing?' · '+missing+' rekod tanpa timbangan':'');};
    const independent=s.locks||[],unknownLock=s.purchases.some(l=>fromLedger(l)&&(l.weight==null||l.lockedWeight==null));
    const factLocks=new Map([...s.purchases.flatMap(p=>p.locks?.length?p.locks:p.lock?[p.lock]:[]),...independent].map(k=>[k.id,k]));
    const lockRows=[...factLocks.values()];
    const totalLock=independent.length?'Pembekal '+ui.g(sum(lockRows.filter(k=>!k.refineryId),k=>k.weight||0))+' · kilang '+ui.g(sum(lockRows.filter(k=>k.refineryId),k=>k.weight||0)):ui.g(sum(s.purchases,p=>p.lockedWeight||0));
    const knownLock=s.purchases.filter(l=>!ledgerOnly(l)||(l.weight!=null&&l.lockedWeight!=null));
    const pendingWeight=(knownLock.length||!unknownLock?ui.g(sum(knownLock,x=>x.weight-(x.lockedWeight||0))):'—')+(unknownLock?' · baki lot sejarah belum dipadankan':'');
    const facts=[['Berat sebelum tarik',measured('before')],['Berat selepas tarik',measured('after')],['Berat sudah lock',totalLock],['Berat belum lock',pendingWeight],['Lot selesai assay',s.assays.some(fromLedger)?s.assays.filter(a=>a.lotId).length+' dipadankan / '+s.assays.length+' rekod':s.assays.length],['Bayaran kilang diterima',ui.rm(sum(s.receipts,x=>Math.max(0,x.amount)))],['Pemulangan kepada kilang',ui.rm(sum(s.receipts,x=>Math.max(0,-x.amount)))],['Kredit kilang belum dipulangkan',dueUnknown?(credit>0?ui.rm(credit)+' dipadankan · baki lejar belum disahkan':'Belum disahkan'):ui.rm(credit)],['Untung kasar muktamad',!final.length&&sales.some(fromLedger)?'Belum dimuktamadkan':ui.rm(sum(final,x=>saleTotals(s,x.id).profit))]];
    const assayRows=reportResult(s,'assays').rows.sort((a,b)=>(a.owner||'￿').localeCompare(b.owner||'￿','ms')).map(a=>[
      e(a.owner||'Belum disahkan'),e(a.ownerRef||agents.get(a.agentId)||'—'),ui.link(a.reportNo||a.id,()=>ui.go('assays',{id:a.id})),e(a.lotId||'—'),ui.date(a.date),ui.g(a.before),ui.g(a.after)+(a.afterBasis==='fineGoldEquivalent'?' · setara emas tulen':''),e(a.purity??'—')]);
    const profitRows=reportResult(s,'profit').rows.map(r=>[ui.link(r.id,()=>ui.go('sales',{id:r.id})),e(r.refinery),ui.rm(r.net),ui.rm(r.cost),ui.rm(r.directCost),r.profit==null?'Belum disahkan':ui.rm(r.profit),e(r.status)]);
    const detail=(label,headers,rows)=>'<details><summary>'+label+' ('+rows.length+')</summary>'+(rows.length?ui.table(headers,rows):'<p class="empty">Belum ada rekod.</p>')+'</details>';
    const summary='<details class="panel overview-detail"><summary>Butiran operasi, baki ejen, keputusan assay dan untung rugi</summary><div class="facts">'+facts.map(([k,v])=>'<div><small>'+k+'</small><strong>'+v+'</strong></div>').join('')+'</div>'+ui.table(['Ejen','Dana diminta','Dana tersedia (anggaran)','Lebihan disahkan belum dipulangkan','Emas dibeli'],breakdown)+detail('Keputusan assay mengikut pemilik',['Pemilik','Rujukan pemilik / ejen','Laporan','Lot','Tarikh assay','Sebelum','Selepas','Mutu (‰)'],assayRows)+detail('Untung rugi mengikut transaksi',['Invois','Kilang','Jualan bersih','Kos belian','Kos langsung','Untung kasar','Status'],profitRows)+'</details>';
    ui.show({title:'Ringkasan operasi',actions:ui.glyphButton('Rekod baharu',ui.quick,'plus','primary'),body:intro+metrics+'<div class="middle-grid">'+chart+needs+'</div>'+recent+summary});
    document.querySelector('#period').onchange=ev=>{days=Number(ev.target.value);ui.rerender()};
  });
}

