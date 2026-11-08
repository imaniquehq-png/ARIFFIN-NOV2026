// F–M is the lock ledger. N–Z records physical gold and allocations. Identical row positions do not link them.
const sourceText = (r,col) => String(r.values?.[col.charCodeAt(0)-65] ?? '').trim();
const formula = (r,col) => String(r.formulas?.[col] ?? '').trim();
const recordKey = (prefix,sheet,row) => 'GS-'+prefix+'-'+sheet.sheetId+'-'+row.rowNo;
const provenance = (sheet,row,column) => ({sourceId:sheet.sourceId??null,sheetId:String(sheet.sheetId),sheetTitle:sheet.title,title:sheet.title,rowNo:row.rowNo,column});
const mark = (sheet,row,col) => ({historical:true,imported:true,source:provenance(sheet,row,col)});
function numberAt(row,col) {
  const literal=sourceText(row,col);
  if(!literal) return null;
  const typed=row.effective?.[col];
  if(typeof typed==='number' && Number.isFinite(typed))return typed;
  const cleaned=literal.replaceAll(',','').replace(/%$/,'');
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) && Number.isFinite(Number(cleaned))?Number(cleaned):null;
}
function positive(row,col) {
  const n=numberAt(row,col);
  return n>0?n:null;
}
function sheetDate(row,col) {
  const displayed=sourceText(row,col);
  if(!displayed)return null;
  const serial=row.effective?.[col];
  if(typeof serial==='number' && serial>=1 && serial<2958466)
    return new Date(Date.UTC(1899,11,30)+Math.floor(serial)*86400000).toISOString().slice(0,10);
  const iso=/^(\d{4}-\d{2}-\d{2})$/.exec(displayed);
  if(iso && Number.isFinite(Date.parse(iso[1])) && new Date(iso[1]).toISOString().slice(0,10)===iso[1])return iso[1];
  return null;
}
function datesAndRow(sheet,row) {
  return {...mark(sheet,row,'N:Z'),sourceDate:sheetDate(row,'N')};
}
const normalize = txt=>String(txt??'').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function ownerMatches(owner,name) {
  const bare=s=>normalize(s).replace(/\s+(JEWELS|JEWELLERY|JEWELRY)$/,'');
  return owner && (bare(owner)===bare(name) || normalize(owner)===normalize(name).split(' ')[0]);
}
function numericMeasurement(row,col) {
  if(positive(row,col)===null)return false;
  const expr=formula(row,col);
  if(!expr)return true;
  const refs=[...expr.matchAll(/\$?([A-Z]+)\$?(\d+)/ig)];
  if(!refs.length)return true; // An entered constant or arithmetic on literal weights.
  if(/\bSUM\s*\(|:/i.test(expr))return false;
  return refs.every(m=>Number(m[2])===row.rowNo);
}
function newPhysicalLine(row) {
  if(sourceText(row,'P') && !formula(row,'P'))return true;
  if(['R','S'].some(col=>numericMeasurement(row,col)))return true;
  // A dated entry may explicitly record the remainder of a measured total (e.g. =123.45-S17).
  return sheetDate(row,'N')!==null && positive(row,'S')!==null && /^=\s*\d+(?:\.\d+)?\s*-\s*\$?S\$?\d+\s*$/i.test(formula(row,'S'));
}
function readAssay(sheet,row,usesPermille) {
  const reportNo=sourceText(row,'P')||null, sourcePurity=positive(row,'Q');
  const displayed=sourceText(row,'Q');
  const percent=/\s*%$/.test(displayed);
  const unit=percent?'%':usesPermille?'‰':null;
  const raw=percent?Number(displayed.replace(/%$/,'').trim()):sourcePurity;
  const normalized=raw===null||unit===null?null:unit==='%'?raw*10:raw;
  const expr=formula(row,'T');
  return {...datesAndRow(sheet,row),reportNo,prNo:sourceText(row,'O')||null,date:null,before:null,
    after:positive(row,'T'),afterBasis:/\bQ\$?\d+/i.test(expr)?'fineGoldEquivalent':'reportedAfterAssay',variance:null,
    purity:normalized>0&&normalized<=1000?Math.round(normalized*1000)/1000:null,
    sourcePurity:raw,sourcePurityUnit:unit,assayDate:null,file:null,enteredBy:null,note:null};
}
function makeLot(sheet,r,partner,usesPermille) {
  const id=recordKey('LOT',sheet,r), before=positive(r,'R'),after=positive(r,'S');
  const process=before===null && after===null?null:{
    ...mark(sheet,r,'R:S'),id:recordKey('PRC',sheet,r),mode:before!==null&&after!==null?'tarik':'recorded',
    date:null,before,after,loss:before!==null&&after!==null?Math.round((before-after)*1000)/1000:null,
    operator:null,note:null,beforePhoto:null,afterPhoto:null,
  };
  const allocated=positive(r,'U'),fine=positive(r,'T'),lineAmount=positive(r,'X');
  // X values can price fractions of a single lot at different locks. A row total is only
  // a lot total when U covers the full after-assay weight on that row.
  const fullAmount=allocated!==null && fine!==null && Math.abs(allocated-fine)<0.000005;
  const invoiceNo=sourceText(r,'Z')||null;
  const supplierAssay=sourceText(r,'P') || positive(r,'Q')!==null ? readAssay(sheet,r,usesPermille):null;
  return {...datesAndRow(sheet,r),id,requestId:null,agentId:partner.id,owner:null,ownerVerified:false,date:sheetDate(r,'N'),
    dateBasis:'goldLedgerDate',type:null,purity:null,weight:null,recordedWeight:before??after,weightBasis:before!==null?'beforePull':after!==null?'afterPull':null,method:partner.method??null,gramsPerTael:null,
    price:positive(r,'W'),priceUnit:'RM/g',amount:fullAmount?lineAmount:null,sourceLineAmount:lineAmount,allocationWeight:allocated,
    photo:null,invoiceNo,invoiceFile:null,invoiceDate:null,invoiceStatus:invoiceNo?'recorded':'unknown',lock:null,locks:[],lockedWeight:null,
    process,supplierAssay,custodyVerified:false};
}
function appendLock(s,sheet,r,partner) {
  const date=sheetDate(r,'F'),weight=positive(r,'L');
  if(!date||weight===null)return;
  s.locks.push({...mark(sheet,r,'F:M'),id:recordKey('MKS',sheet,r),lotId:null,number:null,date,dateTime:null,
    price:positive(r,'G'),priceUnit:null,weight,agentId:sheet.role==='supplier'?partner.id:null,
    refineryId:sheet.role==='refinery'?partner.id:null,owner:null,partnerName:partner.name,
    weightRemaining:numberAt(r,'M'),deduction:numberAt(r,'J')});
}

function priceLine(sheet,row,partner) {
  const side=sheet.role==='supplier'?'X':'Y';
  const amount=positive(row,side), weight=positive(row,'U'),price=positive(row,'W');
  if(amount===null || weight===null || price===null)return null;
  const expr=formula(row,side);
  const refs=[...expr.matchAll(/\$?([A-Z]+)\$?(\d+)/ig)];
  if(/\bSUM\s*\(|:/i.test(expr) || refs.some(ref=>Number(ref[2])!==row.rowNo))return null;
  return {...mark(sheet,row,'U:'+side),id:recordKey('HGR',sheet,row),role:sheet.role,
    agentId:sheet.role==='supplier'?partner.id:null,refineryId:sheet.role==='refinery'?partner.id:null,
    sourceDate:sheetDate(row,'N'),date:sheetDate(row,'N'),allocatedWeight:weight,price,priceUnit:'RM/g',amount,
    lotId:null,assayId:null,owner:sheet.role==='refinery' && numberAt(row,'R')===null?sourceText(row,'R')||null:null,
    sourceAssayRef:sourceText(row,'P')||null,invoiceNo:sourceText(row,'Z')||null};
}
function attachPrices(s,sheets,partners) {
  const coord=(sheetId,n)=>String(sheetId)+'/'+n;
  const records=new Map();
  for(const record of [...s.purchases,...s.assays]){
    if(record.historical && record.source)records.set(coord(record.source.sheetId,record.source.rowNo),record);
  }
  const existing=new Set(s.goldAllocations.map(p=>p.id));
  for(const {sheet,rows} of sheets){
    const partner=partners.get(String(sheet.sheetId));
    if(!partner || !/HARGA PER GRAM/i.test(sheet.headers?.[22]||''))continue;
    for(const row of [...rows].sort((a,b)=>a.rowNo-b.rowNo)){
      if(!['both','gold'].includes(row.kind))continue;
      const allocation=priceLine(sheet,row,partner);
      if(!allocation)continue;
      let parent=records.get(coord(sheet.sheetId,row.rowNo));
      if(!parent){
        // A directly copied weight, or a remaining allocation, can refer back to one known lot.
        // References to multiple lots, pure price references and proximity alone are insufficient.
        const refs=['R','S','T','U'].flatMap(c=>[...formula(row,c).matchAll(/\$?([RSTU])\$?(\d+)/ig)]);
        const other=refs.filter(m=>Number(m[2])!==row.rowNo);
        const referenced=other.map(m=>records.get(coord(sheet.sheetId,Number(m[2]))));
        if(other.length && referenced[0] && referenced.every(p=>p===referenced[0]))parent=referenced[0];
      }
      if(parent){
        records.set(coord(sheet.sheetId,row.rowNo),parent);
        if(sheet.role==='supplier')allocation.lotId=parent.id;
        else {allocation.assayId=parent.id;allocation.lotId=parent.lotId;}
        allocation.owner??=parent.owner;
      }
      if(!existing.has(allocation.id)){s.goldAllocations.push(allocation);existing.add(allocation.id);}
    }
  }
  const byLot=new Map();
  for(const price of s.goldAllocations){
    if(price.role==='supplier' && price.lotId)byLot.set(price.lotId,[...(byLot.get(price.lotId)||[]),price]);
  }
  for(const lot of s.purchases.filter(p=>p.historical)){
    const prices=byLot.get(lot.id)||[],fine=lot.supplierAssay?.after;
    const weights=prices.reduce((n,p)=>n+Math.round(p.allocatedWeight*1000),0);
    if(fine!=null)lot.amount=weights===Math.round(fine*1000)?prices.reduce((n,p)=>n+Math.round(p.amount*100),0)/100:null;
  }
}
function attachRefineryPRs(s,sheets,partners) {
  const assays=new Map(s.assays.filter(a=>a.historical).map(a=>[a.source.sheetId+'/'+a.source.rowNo,a]));
  const grouped=new Map(), prior=new Set(s.dispatches.map(d=>d.id));
  for(const {sheet,rows} of sheets){
    const partner=partners.get(String(sheet.sheetId));
    if(sheet.role!=='refinery' || !partner || !/PR/i.test(sheet.headers?.[14]||''))continue;
    for(const row of [...rows].sort((a,b)=>a.rowNo-b.rowNo)){
      const prNo=sourceText(row,'O');
      if(!prNo || !['both','gold'].includes(row.kind) || formula(row,'O'))continue;
      const key=JSON.stringify([partner.id,prNo]);
      if(!grouped.has(key)){
        grouped.set(key,{...mark(sheet,row,'O'),id:recordKey('PR',sheet,row),prOnly:true,prNo,prDate:null,
          refineryId:partner.id,date:null,sourceDate:sheetDate(row,'N'),sourceRows:[],weight:null,lotIds:[],lotWeights:{},
          assayIds:[],document:null,photo:null,sentBy:null,status:'recorded'});
      }
      const record=grouped.get(key),a=assays.get(String(sheet.sheetId)+'/'+row.rowNo);
      record.sourceRows.push(provenance(sheet,row,'O'));
      if(a){
        a.dispatchId=record.id;
        record.assayIds.push(a.id);
        if(a.lotId && !record.lotIds.includes(a.lotId))record.lotIds.push(a.lotId);
      }
    }
  }
  for(const item of grouped.values())if(!prior.has(item.id))s.dispatches.push(item);
}

export function importGold(s,sheets,partners) {
  s.locks??=[];
  s.goldAllocations??=[];
  const suppliers=[...new Map(sheets.filter(x=>x.sheet.role==='supplier').map(x=>partners.get(String(x.sheet.sheetId))).filter(Boolean).map(p=>[p.id,p])).values()];
  const lotsByReport=new Map(),factories=[];
  const already=new Set([...s.purchases,...s.assays,...s.locks].map(r=>r.id));
  for(const {sheet,rows} of sheets){
    const partner=partners.get(String(sheet.sheetId));
    if(!partner)continue;
    const headers=sheet.headers||[];
    if(!/MKS/i.test(headers[6]||'') || !/ASSAY/i.test(headers[16]||'') || !/TARIK/i.test(headers[18]||''))continue;
    const usesPermille=rows.some(r=>['T','W'].some(c=>/\bQ\$?\d+\s*\/\s*1000\b/i.test(formula(r,c)))) || /‰/.test(headers[16]||'');
    for(const r of rows){
      if(!['both','gold'].includes(r.kind))continue;
      if(!already.has(recordKey('MKS',sheet,r)))appendLock(s,sheet,r,partner);
      if(sheet.role==='supplier' && newPhysicalLine(r)){
        const id=recordKey('LOT',sheet,r);
        const p=already.has(id)?s.purchases.find(l=>l.id===id):makeLot(sheet,r,partner,usesPermille);
        if(!already.has(id))s.purchases.push(p);
        const report=p.supplierAssay?.reportNo;
        if(report)lotsByReport.set(report,[...(lotsByReport.get(report)||[]),p]);
      }
      if(sheet.role==='refinery' && (sourceText(r,'P') || (positive(r,'Q')!==null && newPhysicalLine(r))))
        factories.push({sheet,r,partner,usesPermille});
    }
  }
  const matched=new Set(),refCount=new Map();
  for(const {r} of factories){const key=sourceText(r,'P');if(key)refCount.set(key,(refCount.get(key)||0)+1);}
  for(const {sheet,r,partner,usesPermille} of factories){
    const id=recordKey('ASY',sheet,r),a=readAssay(sheet,r,usesPermille),key=a.reportNo;
    const owner=sourceText(r,'R') && numberAt(r,'R')===null?sourceText(r,'R'):null;
    const owners=suppliers.filter(p=>ownerMatches(owner,p.name));
    const candidates=lotsByReport.get(key)||[];
    const lot=refCount.get(key)===1 && candidates.length===1 && owners.length===1 && candidates[0].agentId===owners[0].id?candidates[0]:null;
    if(lot){lot.owner=owner;lot.ownerVerified=true;lot.ownerSource=provenance(sheet,r,'R');matched.add(lot.id);}
    if(!already.has(id))s.assays.push({...a,id,lotId:lot?.id??null,dispatchId:null,refineryId:partner.id,
      agentId:owners.length===1?owners[0].id:null,owner,ownerVerified:!!owner,supplierSource:lot?.supplierAssay?.source??null,status:'recorded'});
  }
  // A supplier-only assay with its own report identifier can stand alone. Unnumbered supplier readings
  // remain on their original lot, as a second unnumbered refinery reading could describe the same assay.
  for(const lots of lotsByReport.values()){
    for(const lot of lots){
      if(matched.has(lot.id) || refCount.has(lot.supplierAssay.reportNo))continue;
      const a=lot.supplierAssay,id=lot.id.replace('GS-LOT-','GS-ASY-');
      if(!already.has(id))s.assays.push({...a,id,lotId:lot.id,dispatchId:null,refineryId:null,agentId:lot.agentId,
        owner:lot.owner,ownerVerified:false,status:'recorded'});
    }
  }
  attachPrices(s,sheets,partners);
  attachRefineryPRs(s,sheets,partners);
  return s;
}
