// The cash journal (A:D) and the gold subledger (F:AA) are independent tables
// printed side by side. A shared row number alone is not a payment allocation.
const sheetId = sheet => String(sheet.sheetId);
const cleanName = name => String(name || '').normalize('NFKC').toLocaleLowerCase().replace(/^syarikat\s+|\s+sdn\.?\s+bhd\.?$/g,'').replace(/\s+/g,' ').trim();
const reference = (type,sheet,row) => 'GS-'+type+'-'+sheetId(sheet)+'-'+row.rowNo;
const source = (sheet,row,column) => ({sheetId:sheetId(sheet),sheetTitle:sheet.title,rowNo:row.rowNo,column});
function figure(row,index) {
  const raw=row.values?.[index];
  if(raw==null || String(raw).trim()==='')return null;
  const value=String(raw).trim().replaceAll(',','');
  return /^-?\d+(\.\d+)?$/.test(value) ? Math.round(Number(value)*100)/100 : null;
}
function cashDate(row) {
  if(!row.values?.[0])return null;
  const serial=row.effective?.A;
  if(typeof serial==='number' && serial>0 && serial<2958466)return new Date((Math.floor(serial)-25569)*86400000).toISOString().slice(0,10);
  const m=String(row.values[0]).trim().match(/^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}|\d{4})$/i);
  if(!m)return null;
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const year=m[3].length===2?'20'+m[3]:m[3];
  const iso=year+'-'+String(months.indexOf(m[2].toLowerCase())+1).padStart(2,'0')+'-'+m[1].padStart(2,'0');
  const day=new Date(iso+'T00:00:00Z');
  return Number.isFinite(+day) && day.toISOString().startsWith(iso)?iso:null;
}
function postings(rows) {return rows.filter(r=>r.kind!=='calculation' && (figure(r,1)!==null || figure(r,2)!==null));}
function rowMeta(sheet,row,column) {
  return {historical:true,imported:true,status:'historical',source:source(sheet,row,column),sourceBalance:figure(row,3),date:cashDate(row)};
}
export function importPartners(s,sheets,pricingMethods={}) {
  const partners=new Map();
  const methods=new Map();
  for(const [name,method] of Object.entries(pricingMethods)){
    const key=cleanName(name);
    if(!key || !['WeBuy','Tahil'].includes(method))throw Error('Semak nama pembekal dan kaedah harga dalam tetapan import.');
    if(methods.has(key) && methods.get(key)!==method)throw Error('Lebih daripada satu kaedah harga ditetapkan untuk pembekal yang sama.');
    methods.set(key,method);
  }
  for(const {sheet,rows} of sheets) {
    const supplier=sheet.role==='supplier';
    if(!supplier && sheet.role!=='refinery')continue;
    const records=supplier?s.agents:s.refineries;
    const name=String(sheet.partner||'').trim();
    if(!name)continue;
    const normalized=cleanName(name);
    let partner=records.find(x=>cleanName(x.name)===normalized);
    if(!partner) {
      partner={id:'GS-'+(supplier?'AG':'KLG')+'-'+sheetId(sheet),name,code:null,
        method:supplier?(methods.get(normalized)??null):'Tahil',gramsPerTael:null,imported:true,historical:true,
        ...(supplier?{bank:null,account:null}:{advancePercent:null})};
      records.push(partner);
    }
    if(supplier && partner.historical && !partner.method && methods.has(normalized))partner.method=methods.get(normalized);
    const balances=(partner.sourceBalances||[]).filter(b=>b.sheetId!==sheetId(sheet));
    const closing=postings(rows).filter(r=>figure(r,3)!=null).sort((a,b)=>b.rowNo-a.rowNo)[0];
    balances.push({sheetId:sheetId(sheet),sheetTitle:sheet.title,rowNo:closing?.rowNo??null,column:'D',value:closing?figure(closing,3):null});
    partner.sourceBalances=balances;
    partner.sourceBalance=balances.length===1?balances[0].value:null;
    partners.set(sheetId(sheet),partner);
  }
  return partners;
}

// Match a named invoice summary only to a cash-journal invoice on the same
// row or a row explicitly included by the summary's Y-cell formula, at the
// same posted amount. Never join only by chronological proximity or amount.
function referencedRows(formula,all) {
  const refs=new Set();
  const input=String(formula||'').toUpperCase().replaceAll('$','');
  for(const match of input.matchAll(/\bY(\d+)\s*:\s*[YZ](\d+)\b/g)){
    const first=Number(match[1]),last=Number(match[2]);
    for(const row of all)if(row.rowNo>=first && row.rowNo<=last)refs.add(row.rowNo);
  }
  for(const match of input.matchAll(/\bY(\d+)\b/g))refs.add(Number(match[1]));
  return refs;
}
function salesBase(sheet,row,column,refineryId) {
  return {...rowMeta(sheet,row,column),id:reference(column==='C'?'INV':'DOC',sheet,row),refineryId,
    shipmentId:null,lotIds:[],invoiceNo:null,weight:null,price:null,gramsPerTael:null,advancePercent:null,
    directCost:null,adjustment:null,amount:null,confirmedBy:null};
}
function refinerySales(s,sheet,rows,refineryId,cash) {
  const invoices=cash.filter(r=>figure(r,2)!==null && figure(r,2)!==0).map(row=>({
    ...salesBase(sheet,row,'C',refineryId),amount:figure(row,2)
  }));
  const named=rows.filter(r=>r.kind!=='calculation' && r.values?.[25] && figure(r,24)!=null);
  const evidence=new Map();
  for(const row of named) {
    const refs=referencedRows(row.formulas?.Y,rows);
    refs.add(row.rowNo);
    const matching=invoices.filter(i=>refs.has(i.source.rowNo) && i.amount===figure(row,24));
    const key=matching.length===1?matching[0].id:null;
    evidence.set(row,{key,refs});
  }
  for(const [row,{key,refs}] of evidence) {
    const match=key && [...evidence.values()].filter(x=>x.key===key).length===1 ? invoices.find(i=>i.id===key):null;
    const rec=match || {...salesBase(sheet,row,'Z',refineryId),historicalDocumentOnly:true,status:'source-document',date:null};
    rec.invoiceNo=String(row.values[25]).trim();
    rec.documentAmount=figure(row,24);
    rec.invoiceSource=source(sheet,row,'Z');
    rec.allocationIds=(s.goldAllocations||[]).filter(a=>a.role==='refinery' && String(a.source?.sheetId)===sheetId(sheet) && refs.has(a.source?.rowNo)).map(a=>a.id);
    const assays=s.assays.filter(a=>a.historical && String(a.source?.sheetId)===sheetId(sheet) && refs.has(a.source?.rowNo));
    rec.lotIds=[...new Set(assays.map(a=>a.lotId).filter(Boolean))];
    rec.assayIds=assays.map(a=>a.id);
    if(!match)invoices.push(rec);
  }
  return invoices;
}
export function importFinance(s,sheets,partners) {
  s.supplierCredits ||= [];
  const ids=new Set(['transfers','receipts','sales','supplierCredits'].flatMap(table=>s[table].map(r=>r.id)));
  const add=(table,rec)=>{if(!ids.has(rec.id)){s[table].push(rec);ids.add(rec.id);}};
  for(const {sheet,rows} of sheets) {
    const partner=partners.get(sheetId(sheet));
    if(!partner)continue;
    const cash=postings(rows);
    for(const row of cash) {
      const bankAmount=figure(row,1),credit=figure(row,2);
      const bank={...rowMeta(sheet,row,'B'),amount:bankAmount,bankRef:null,proof:null,verifiedBy:null};
      if(sheet.role==='supplier'){
        if(bankAmount!==null && bankAmount!==0)
          add('transfers',{...bank,id:reference('PAY',sheet,row),agentId:partner.id,requestId:null});
        if(credit!==null && credit!==0)
          add('supplierCredits',{...rowMeta(sheet,row,'C'),id:reference('CR',sheet,row),agentId:partner.id,requestId:null,
            amount:credit,classification:'unclassified'});
      }else if(bankAmount!==null && bankAmount!==0){
        add('receipts',{...bank,id:reference('RCP',sheet,row),refineryId:partner.id,saleId:null,receivedBy:null});
      }
    }
    if(sheet.role==='refinery')for(const invoice of refinerySales(s,sheet,rows,partner.id,cash))add('sales',invoice);
  }
}
