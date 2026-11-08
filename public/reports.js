import {reportTypes,reportResult,displayCell,fmtDate} from './report-data.js';
import {docNames,documentChoices,buildDocument,reportDocument} from './report-documents.js';
import {downloadFile,renderPDF,pdfFilename} from './report-pdf.js';
import {registerSheetImport} from './sheet-import.js';

const docGroups={
  'Dana dan pembelian':['request','voucher','purchase','bill'],
  'Emas dan penghantaran':['delivery','acknowledgement','dispatch','assay','assayOwner','stock'],
  'Jualan dan penyata':['sale','supplierSOA','refinerySOA','einvoice'],
};
const emptyFilter=()=>({from:'',to:'',agent:'',refinery:'',ref:'',status:'',period:'day',dateBasis:'event'});
function csvValue(value){
  let v=String(value??'');
  if(/^[\s]*[=+@-]/.test(v)&&!/^[-+]?\d+(?:\.\d+)?$/.test(v))v="'"+v;
  return '"'+v.replaceAll('"','""')+'"';
}
export function registerReports(ui){
  if(!document.querySelector('link[href="/reports.css"]')){
    const css=document.createElement('link');css.rel='stylesheet';css.href='/reports.css';document.head.append(css);
  }
  const esc=v=>ui.esc(String(v??''));
  const url=id=>ui.fileUrl?ui.fileUrl(id):'/api/file/'+encodeURIComponent(id);
  const opt=(value,label,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
  const select=(id,label,options)=>'<label class="aj-field" for="'+id+'">'+esc(label)+'<select id="'+id+'">'+options+'</select></label>';
  const input=(key,label,type,value)=>'<label class="aj-field" for="r-'+key+'">'+esc(label)+'<input id="r-'+key+'" type="'+type+'" value="'+esc(value)+'"></label>';
  const note=(msg)=>'<div class="aj-notice bad" role="alert">'+esc(msg)+'</div>';
  const hint=msg=>'<p class="aj-help">'+esc(msg)+'</p>';
  const error=e=>ui.dialog('Semakan diperlukan',note(e.message||e));
  let activeType='requests', filters=emptyFilter(), currentPage=1,currentDoc='request',selectedId='',docOptions={},lastDemo;
  function workspace(){
    if(lastDemo===ui.demo)return;
    filters=emptyFilter();currentPage=1;selectedId='';docOptions={};lastDemo=ui.demo;
    const hasPurchases=ui.state.purchases.length>0 && ui.state.requests.length===0;
    activeType=hasPurchases?'purchases':'requests';
    currentDoc=hasPurchases?'purchase':'request';
  }
  function docHTML(d){
    const pairs=(list,cls)=>list.length?'<dl class="'+cls+'">'+list.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>':'';
    const tables=d.tables.map(t=>'<section>'+(t.title?'<h3>'+esc(t.title)+'</h3>':'')+'<div class="aj-doc-scroll"><table><thead><tr>'+t.cols.map(c=>'<th scope="col">'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+t.rows.map(row=>'<tr>'+row.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+(!t.rows.length?hint('Tiada rekod dalam tempoh ini.'):'')+'</section>').join('');
    const images=d.photos.map(p=>'<figure><img src="'+esc(url(p.id))+'" alt="'+esc(p.caption)+'"><figcaption>'+esc(p.caption)+'</figcaption></figure>').join('');
    return '<article class="aj-document"><div class="aj-letterhead"><strong>ARIFFIN JEWELS</strong>'+(d.demo?'<b>CONTOH · RUANG LATIHAN</b>':'')+'</div><h2>'+esc(d.title)+'</h2><p class="aj-doc-ref">'+esc(d.ref)+' &nbsp; / &nbsp; '+esc(fmtDate(d.date))+'</p>'+pairs(d.meta,'aj-doc-meta')+tables+pairs(d.totals,'aj-doc-totals')+(d.note?hint(d.note):'')+(d.files.length?'<section><h3>Lampiran rekod</h3><ul>'+d.files.map(f=>'<li>'+ui.file(f.id,f.label)+'</li>').join('')+'</ul></section>':'')+(images?'<div class="aj-doc-photos">'+images+'</div>':'')+'</article>';
  }
  async function printHTML(d){
    if(document.querySelector('dialog[open]'))ui.close();
    document.getElementById('aj-print-root')?.remove();
    const printable=document.createElement('div');printable.id='aj-print-root';printable.innerHTML=docHTML(d);
    document.body.append(printable);document.body.classList.add('aj-printing');
    await Promise.all([...printable.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));
    const finish=()=>{printable.remove();document.body.classList.remove('aj-printing');};
    window.addEventListener('afterprint',finish,{once:true});
    window.print();
  }
  async function pdfBlob(d){
    const delivery=ui.state.deliveries.find(item=>item.id===d.deliveryId);
    const archived=async id=>{
      const response=await fetch(url(id));
      if(!response.ok)throw new Error('Borang asal tidak dapat dimuatkan.');
      return response.blob();
    };
    if(delivery?.formFile&&!delivery.formNeedsReissue)return archived(delivery.formFile);
    const blob=new Blob([await renderPDF(d,url)],{type:'application/pdf'});
    if((delivery?.status==='sent'||delivery?.formNeedsReissue)&&delivery.formBasis){
      const file=await ui.upload(new File([blob],pdfFilename(d),{type:blob.type}));
      try{await ui.act('delivery.issue',{deliveryId:delivery.id,file,basis:d.deliveryFormBasis});}
      catch(e){
        await ui.refresh();
        const current=ui.state.deliveries.find(item=>item.id===delivery.id);
        if(current?.formFile&&!current.formNeedsReissue)return archived(current.formFile);
        throw e;
      }
      if(document.querySelector('dialog[open]'))ui.close();
      ui.rerender();
    }
    return blob;
  }
  let downloading=false;
  const output=async(d,print=false)=>{
    if(downloading)return;
    downloading=true;
    try{
      if(d.deliveryId||d.acknowledgementId){
        await ui.refresh();
        d=buildDocument(ui.state,d.deliveryId?'delivery':'acknowledgement',d.deliveryId||d.acknowledgementId);
        d.demo=!!ui.demo;
      }
      if(print&&!d.deliveryId&&!d.files.length){await printHTML(d);return;}
      const blob=await pdfBlob(d);
      if(!print){downloadFile(blob,pdfFilename(d));return;}
      const frame=document.createElement('iframe'),target=URL.createObjectURL(blob);
      frame.title='Cetak dokumen PDF';frame.style.cssText='position:fixed;width:1px;height:1px;opacity:0;border:0';frame.src=target;
      const finish=()=>{frame.remove();URL.revokeObjectURL(target);};
      frame.onload=()=>{try{frame.contentWindow.focus();frame.contentWindow.print();}catch(e){finish();error(e);}};
      document.body.append(frame);
      setTimeout(finish,300000);
    }catch(e){error(e);}finally{downloading=false;}
  };
  const save=d=>output(d);
  const docActions=d=>ui.btn('Muat turun PDF',()=>save(d),'primary')+ui.btn('Cetak',()=>output(d,true),'secondary');
  function previewDoc(type,id,options){
    try{const d=buildDocument(ui.state,type,id,options);d.demo=!!ui.demo;
      ui.dialog('Pratonton dokumen','<div class="aj-actions">'+docActions(d)+'</div>'+docHTML(d));}
    catch(e){error(e);}
  }
  ui.printDoc=async(type,id,options)=>{
    try{if(type==='delivery'||type==='acknowledgement')await ui.refresh();previewDoc(type,id,options);}
    catch(e){error(e);}
  };
  function documents(params={}){
    workspace();if(params.type&&docNames[params.type])currentDoc=params.type;if(params.id)selectedId=params.id;
    const choices=documentChoices(ui.state,currentDoc);
    if(!choices.some(c=>c.value===selectedId))selectedId=choices[0]?.value||'';
    const selectors='<div class="aj-fields">'+select('d-type','Jenis dokumen',Object.entries(docGroups).map(([group,types])=>'<optgroup label="'+esc(group)+'">'+types.map(type=>opt(type,docNames[type],currentDoc)).join('')+'</optgroup>').join(''))+
      select('d-id','Rekod sumber',choices.length?choices.map(c=>opt(c.value,c.label,selectedId)).join(''):opt('','Tiada rekod tersedia',''))+'</div>';
    const soa=['supplierSOA','refinerySOA'].includes(currentDoc);
    let form=selectors;
    if(soa)form+='<div class="aj-fields">'+input('docfrom','Dari','date',docOptions.from||'')+input('docto','Hingga','date',docOptions.to||'')+'</div>';
    let doc;
    if(selectedId){doc=buildDocument(ui.state,currentDoc,selectedId,docOptions);doc.demo=!!ui.demo;}
    ui.show({title:'Dokumen',subtitle:'Jana dokumen daripada rekod transaksi.',actions:doc?docActions(doc):'',body:'<div class="aj-report">'+ui.section('Pilih dokumen',form)+(doc?docHTML(doc):'<div class="aj-blank"><h3>Belum ada dokumen untuk dijana</h3>'+hint('Rekod transaksi yang berkaitan akan muncul di sini.')+'</div>')+'</div>'});
    document.getElementById('d-type').onchange=e=>{currentDoc=e.target.value;selectedId='';docOptions={};documents();};
    document.getElementById('d-id').onchange=e=>{selectedId=e.target.value;documents();};
    if(soa)for(const key of ['from','to'])document.getElementById('r-doc'+key).onchange=e=>{const values={...docOptions,[key]:e.target.value};if(values.from&&values.to&&values.from>values.to){error(Error('Tarikh akhir mestilah pada atau selepas tarikh awal.'));e.target.value=docOptions[key]||'';return;}docOptions=values;documents();};
  }
  function descriptions(){
    const agents=ui.state.agents,refineries=ui.state.refineries;
    return [['Dari',filters.from?fmtDate(filters.from):null],['Hingga',filters.to?fmtDate(filters.to):null],['Asas tarikh',filters.dateBasis==='source'?'Tarikh catatan lejar jika tersedia':'Tarikh transaksi'],['Ejen',agents.find(a=>a.id===filters.agent)?.name],['Kilang',refineries.find(k=>k.id===filters.refinery)?.name],['Rujukan',filters.ref],['Status',filters.status]].filter(([,v])=>v);
  }
  function reports(params={}){
    workspace();if(params.type&&reportTypes[params.type]&&activeType!==params.type){activeType=params.type;filters=emptyFilter();currentPage=1;}
    const result=reportResult(ui.state,activeType,filters);
    const groups=[...new Set(Object.values(reportTypes).map(r=>r.group))];
    const reportSelect=select('r-type','Jenis laporan',groups.map(g=>'<optgroup label="'+esc(g)+'">'+Object.entries(reportTypes).filter(([,v])=>v.group===g).map(([k,v])=>opt(k,v.name,activeType)).join('')+'</optgroup>').join(''));
    const period=activeType==='periods'?select('r-period','Kumpulan tempoh',[['day','Harian'],['week','Mingguan (Isnin–Ahad)'],['month','Bulanan']].map(([k,v])=>opt(k,v,filters.period)).join('')):'';
    const opts=(list,current,label)=>opt('',label,current)+list.map(a=>opt(a.id,a.name,current)).join('');
    const filterCount=Object.entries(filters).filter(([key,value])=>key!=='period'&&(key==='dateBasis'?value==='source':value)).length;
    const filterLabel=filterCount?'Penapis ('+filterCount+' digunakan)':'Penapis';
    const dateFilter=Object.values(ui.state).some(rows=>Array.isArray(rows)&&rows.some(r=>r.sourceDate))
      ?select('r-dateBasis','Asas tarikh',opt('event','Tarikh transaksi',filters.dateBasis)+opt('source','Tarikh catatan lejar jika tersedia',filters.dateBasis)):'';
    const controls='<div class="aj-fields">'+reportSelect+period+'</div><details class="aj-filter-detail" '+(window.matchMedia('(min-width: 701px)').matches?'open':'')+'><summary>'+filterLabel+'</summary><div class="aj-filter-grid">'+input('from','Dari','date',filters.from)+input('to','Hingga','date',filters.to)+dateFilter+select('r-agent','Ejen',opts(ui.state.agents,filters.agent,'Semua ejen'))+select('r-refinery','Kilang',opts(ui.state.refineries,filters.refinery,'Semua kilang'))+input('ref','Nombor rujukan','search',filters.ref)+select('r-status','Status',opt('','Semua status',filters.status)+result.statuses.map(v=>opt(v,v,filters.status)).join(''))+'</div><div class="aj-actions">'+ui.btn('Tapis laporan',applyFilters,'primary')+ui.btn('Kosongkan penapis',()=>{filters=emptyFilter();currentPage=1;reports();},'ghost')+'</div></details>';
    const pageSize=30,pages=Math.max(1,Math.ceil(result.rows.length/pageSize));currentPage=Math.min(currentPage,pages);
    const slice=result.rows.slice((currentPage-1)*pageSize,currentPage*pageSize);
    const contents=slice.length?ui.table(result.cols.map(c=>c[1]),slice.map(r=>result.cols.map(([k,,type])=>esc(displayCell(r[k],type))))):'<div class="aj-blank"><h3>Tiada rekod sepadan</h3>'+hint('Semak penapis atau masukkan transaksi yang berkaitan.')+'</div>';
    const pagination=pages>1?'<div class="aj-strip"><span>Halaman '+currentPage+' daripada '+pages+'</span><div class="aj-actions">'+(currentPage>1?ui.btn('Sebelumnya',()=>{currentPage--;reports();},'secondary'):'')+(currentPage<pages?ui.btn('Seterusnya',()=>{currentPage++;reports();},'secondary'):'')+'</div></div>':'';
    let extra='';
    if(activeType==='funds')extra=hint('Baki dikira bagi setiap permohonan berdasarkan pindahan, bil yang telah disahkan dan pulangan bank. Amaun menunjukkan kedudukan semasa.');
    if(filters.agent&&['deliveries','profit','trading','refinerySOA','periods','outstanding'].includes(activeType))extra=hint('Transaksi bersama beberapa ejen dipaparkan pada nilai penuh transaksi.');
    const exportPDF=()=>{const d=reportDocument(result,descriptions());d.demo=!!ui.demo;return save(d);};
    const exportCSV=()=>{const values=[result.cols.map(c=>c[1]),...result.rows.map(row=>result.cols.map(([key])=>row[key]??''))];downloadFile(new Blob(['\uFEFF'+values.map(row=>row.map(csvValue).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),(ui.demo?'CONTOH-':'')+'Ariffin-Jewels-'+activeType+'.csv');};
    ui.show({title:'Laporan',subtitle:'Semak dana, pergerakan emas dan penyelesaian bayaran.',actions:ui.btn('Muat turun PDF',exportPDF,'primary')+ui.btn('Eksport CSV',exportCSV,'secondary'),body:'<div class="aj-report">'+ui.section('Pilihan laporan',controls)+ui.section(result.name,'<div class="aj-count">'+result.rows.length+' rekod</div>'+extra+contents+pagination)+'</div>'});
    document.getElementById('r-type').onchange=e=>{activeType=e.target.value;filters.status='';currentPage=1;reports();};
    if(period)document.getElementById('r-period').onchange=applyFilters;
    document.getElementById('r-ref').onkeydown=e=>{if(e.key==='Enter')applyFilters();};
  }
  function applyFilters(){
    const next=emptyFilter();for(const k of Object.keys(next)){const input=document.getElementById('r-'+k);if(input)next[k]=input.value;}
    if(next.from&&next.to&&next.from>next.to){error(Error('Tarikh akhir mestilah pada atau selepas tarikh awal.'));return;}
    filters=next;currentPage=1;reports();
  }
  ui.page('reports',reports);ui.page('documents',documents);registerSheetImport(ui);
}
