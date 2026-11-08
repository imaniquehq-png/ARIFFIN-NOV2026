/* Values leave the domain in RM and grams. Monetary arithmetic uses sen. */
export function initialState() {
  return Object.fromEntries([
    'agents','refineries','requests','transfers','returns','supplements','purchases','custodyLots',
    'deliveries','dispatches','assays','sales','receipts','refundRequests','supplierCredits','einvoices','audit','history','corrections'
  ].map(key => [key, []]));
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}
function required(value, label, limit = 180) {
  check(typeof value === 'string' && value.trim() && value.trim().length <= limit, 'Sila isi ' + label + ' yang sah.');
  return value.trim();
}
function date(value, earliest) {
  const result = required(value, 'tarikh', 10);
  const instant = new Date(result + 'T00:00:00Z');
  check(/^\d{4}-\d{2}-\d{2}$/.test(result) && Number.isFinite(+instant) && instant.toISOString().slice(0,10) === result, 'Tarikh tidak sah.');
  check(!earliest || result >= earliest, 'Tarikh mestilah pada atau selepas ' + earliest + '.');
  return result;
}
function decimal(value, digits, label, {min = 0, inclusive = false, max = 9999999999} = {}) {
  const raw = String(value ?? '').trim();
  const pattern = new RegExp('^-?\\d+(?:\\.\\d{1,' + digits + '})?$');
  const number = Number(raw);
  check(pattern.test(raw) && Number.isFinite(number) && (inclusive ? number >= min : number > min) && number <= max,
    label + ' tidak sah. Had tempat perpuluhan ialah ' + digits + '.');
  return number;
}
function money(value, label, options) { return decimal(value, 2, label, options); }
function sen(value) { return Math.round(Number(value || 0) * 100); }
function total(records, key) { return records.reduce((sum, r) => sum + sen(r[key]), 0); }
function byId(records, id, label) {
  const found = records.find(r => r.id === id);
  check(found, label + ' tidak dijumpai.');
  return found;
}
function finance(ctx) {
  check(['management','accountant'].includes(ctx.user.role), 'Hanya pengurusan atau akauntan boleh mengesahkan transaksi ini.');
}
function currentRules(ctx) { return (ctx.schemaVersion ?? 2) >= 2; }
function reconcileFunds(ctx) {
  if (!currentRules(ctx)) return finance(ctx);
  check(ctx.user.role === 'accountant', 'Pengesahan akauntan diperlukan untuk rekonsiliasi bil dan dana.');
}
function manage(ctx) {
  check(ctx.user.role === 'management', 'Kelulusan pengurusan diperlukan.');
}
function scaled(number, digits) {
  const [whole, fraction = ''] = String(number).split('.');
  return BigInt(whole + fraction.padEnd(digits,'0'));
}
export function priceAmount(method, weight, rate, gramsPerTael) {
  check(['WeBuy','Tahil'].includes(method), 'Pilih kaedah harga yang sah.');
  const mass = scaled(decimal(weight, 3, 'Berat'), 3);
  const price = scaled(decimal(rate, 4, 'Harga seunit'), 4);
  const factor = method === 'Tahil' ? scaled(decimal(gramsPerTael, 6, 'Gram setiap tahil', {max: 100000}), 6) : 1000000n;
  // mass is milligrams, price is 1/10,000 RM, factor is micrograms.
  const numerator = mass * price * 10n;
  const cents = (numerator * 2n + factor) / (2n * factor);
  check(cents > 0n && cents <= 999999999900n, 'Nilai harga terkira berada di luar julat.');
  return Number(cents) / 100;
}

export function requestTotals(s, id) {
  const forRequest = rows => rows.filter(r => r.requestId === id);
  const sent = total(forRequest(s.transfers),'amount');
  const back = total(forRequest(s.returns),'amount');
  const lots = forRequest(s.purchases);
  const bought = total(lots.filter(p => p.invoiceStatus === 'confirmed'),'amount');
  const pending = lots.filter(p => p.invoiceStatus !== 'confirmed');
  const pendingKnown = pending.every(p => Number.isFinite(p.amount));
  const reserved = total(pending,'amount');
  const balance = sent - back - bought;
  return {transferred: sent / 100, purchased: bought / 100, returned: back / 100, balance: balance / 100,
    pendingPurchase:pendingKnown ? reserved / 100 : null,
    available:pendingKnown ? Math.max(balance - reserved,0) / 100 : null,
    unreturnedExcess:lots.length && !pending.length ? Math.max(balance,0) / 100 : 0,
    refundable:pending.length ? 0 : Math.max(balance, 0) / 100, payable:Math.max(-balance, 0) / 100};
}
export function priorExcess(s,request,asOf) {
  for (const r of s.requests.filter(r=>r.id!==request.id && r.agentId===request.agentId)) {
    const lot=s.purchases.find(p=>p.requestId===r.id && p.invoiceStatus==='confirmed');
    if (!lot) continue;
    if (requestTotals(s,r.id).unreturnedExcess>0) return r.id;
    if (asOf && lot.billDate && lot.billDate<=asOf) {
      const throughDate=rows=>total(rows.filter(x=>x.requestId===r.id && x.date && x.date<=asOf),'amount');
      if (throughDate(s.transfers)-throughDate(s.returns)>sen(lot.amount)) return r.id;
    }
  }
  return null;
}
export function saleTotals(s,id) {
  const sale = byId(s.sales,id,'Jualan');
  const receipts=s.receipts.filter(r => r.saleId === id);
  const received=total(receipts,'amount');
  if(sale.historical && !sale.operationalReady) {
    const net=sale.amount??(sale.settlementVerified?sale.documentAmount:null)??null;
    const outstanding=sale.settlementVerified && net!=null ? (sen(net)-received)/100 : null;
    return {net,received:receipts.length || sale.settlementVerified ? received/100 : null,outstanding,cost:null,directCost:null,profit:null};
  }
  const net = sen(sale.amount) + sen(sale.adjustment);
  const lines=sale.lotIds.map(id=>saleLot(s,id));
  const cost=lines.every(l=>Number.isFinite(l?.cost)) ? total(lines,'cost') : null;
  const direct = sen(sale.directCost);
  const covered=!sale.historical || sale.settlementVerified;
  return {net: net / 100, received:covered || receipts.length ? received / 100 : null, outstanding:covered ? (net - received) / 100 : null,
    cost:cost===null ? null : cost / 100, directCost: direct / 100, profit:cost===null ? null : (net - cost - direct) / 100};
}
export function saleLot(s,id) {
  const p=s.purchases.find(p=>p.id===id);
  if (p) return {lot:p,cost:p.amount,confirmed:p.invoiceStatus==='confirmed',reference:p.billNo};
  const c=(s.custodyLots||[]).find(l=>l.id===id);
  if(c) return {lot:c,cost:c.costVerified ? c.verifiedCost : null,confirmed:!!c.costVerified && Number.isFinite(c.verifiedCost),reference:c.costVerified?'Kos disahkan':''};
  return null;
}
export function saleAssay(s,sale,lotId) {
  return s.assays.find(a=>a.lotId===lotId && a.dispatchId===sale.shipmentId
    && (!(a.historical || a.imported) || a.operationalReady));
}
export function advanceLimit(sale) {
  return Number((BigInt(sen(sale.amount))*BigInt(sen(sale.advancePercent))+5000n)/10000n)/100;
}
export function receiptLimit(s,sale,onDate) {
  const t=saleTotals(s,sale.id);
  if (t.outstanding==null) return 0;
  if (sale.status==='final' && (!onDate || onDate>=sale.finalDate)) return Math.max(0,t.outstanding);
  const advances=s.receipts.filter(r=>r.saleId===sale.id && (!sale.finalDate || r.date<sale.finalDate));
  const remaining=sen(advanceLimit(sale))-total(advances,'amount');
  return Math.max(0,Math.min(remaining,sen(t.outstanding)))/100;
}
function bankRecord(s, action, d, ctx, request, earliest) {
  const refund = action === 'request.return';
  const proof = required(d.proof,'bukti transaksi bank');
  const bankRef = required(d.bankRef,'rujukan transaksi bank');
  const list = refund ? s.returns : s.transfers;
  check(!list.some(r => r.bankRef?.toLowerCase() === bankRef.toLowerCase()), 'Rujukan transaksi bank telah digunakan.');
  const record = {id: ctx.id(refund ? 'RTN' : 'PV'), requestId: request.id, date: date(d.date, earliest), amount: money(d.amount,'Jumlah'), proof, bankRef, verifiedBy: ctx.user.id};
  list.push(record);
  return record;
}
function partner(s, action, d, ctx) {
  const isAgent = action === 'agent.create';
  const records = isAgent ? s.agents : s.refineries;
  const name = required(d.name, 'nama');
  const code = required(d.code,'kod',24).toUpperCase();
  const existing=records.find(r=>r.name.toLowerCase()===name.toLowerCase());
  const completing=existing?.historical && !existing.code;
  check((!existing || completing) && !records.some(r => r.code?.toUpperCase() === code), 'Nama atau kod sudah digunakan.');
  const method = isAgent ? d.method : 'Tahil';
  check(['WeBuy','Tahil'].includes(method), 'Kaedah harga tidak sah.');
  const gramsPerTael = method === 'Tahil' ? decimal(d.gramsPerTael,6,'Gram setiap tahil',{max:100000}) : null;
  const r = {id:existing?.id || ctx.id(isAgent ? 'AG' : 'KLG'),name,code,method,gramsPerTael};
  if (isAgent) {
    r.bank = required(d.bank,'nama bank');
    r.account = required(d.account,'nombor akaun bank',64);
  } else {
    r.advancePercent = decimal(d.advancePercent ?? 90,2,'Peratus pendahuluan',{inclusive:true,max:100});
  }
  if(completing){Object.assign(existing,r);return existing;}
  records.push(r);
  return r;
}
function applyRequest(s, action, d, ctx) {
  if (action === 'request.create') {
    const agent = byId(s.agents,d.agentId,'Ejen');
    const r = {id:ctx.id('PRQ'), agentId:agent.id, date:date(d.date), requested:money(d.requested,'Jumlah diminta'),
      approved:0, status:'pending', purpose:required(d.purpose,'tujuan permohonan',800), createdBy:ctx.user.id};
    s.requests.push(r);
    return r;
  }
  const r = byId(s.requests,d.requestId,'Permohonan');
  const t = requestTotals(s,r.id);
  const lot = s.purchases.find(p => p.requestId === r.id);
  switch (action) {
    case 'request.approve':
    case 'request.reject':
      manage(ctx);
      check(r.status === 'pending', 'Permohonan ini sudah disemak.');
      if (action === 'request.approve') {
        r.approved = money(d.approved,'Jumlah diluluskan',{max:r.requested});
        r.status = 'approved';
      } else {
        r.reason = required(d.reason,'sebab penolakan',800);
        r.status = 'rejected';
      }
      r.reviewedBy = ctx.user.id;
      r.reviewedAt = ctx.now;
      return r;
    case 'request.transfer': {
      finance(ctx);
      const payee=byId(s.agents,r.agentId,'Ejen');
      check(payee.bank && payee.account,'Lengkapkan butiran bank ejen sebelum merekod pindahan.');
      check(['approved','active'].includes(r.status), 'Permohonan perlu diluluskan terlebih dahulu.');
      const amount = money(d.amount,'Jumlah pindahan');
      if (currentRules(ctx) && !lot) {
        const other=priorExcess(s,r,d.date);
        check(!other,'Pulangkan lebihan yang disahkan pada permohonan '+other+' sebelum merekod pindahan bagi belian baharu.');
      }
      const limit = sen(r.approved) + total(s.supplements.filter(x => x.requestId === r.id && x.status === 'approved'),'amount');
      check(sen(amount) + sen(t.transferred) <= limit, 'Pindahan melebihi jumlah diluluskan.');
      if (lot) check(lot.invoiceStatus === 'confirmed' && amount <= t.payable, 'Selepas pembelian, pindahan hanya untuk baki bil disahkan.');
      const entry = bankRecord(s,action,d,ctx,r,lot?.date || r.date);
      r.status = 'active';
      return entry;
    }
    case 'request.return': {
      finance(ctx);
      check(r.status === 'active', 'Pemulangan memerlukan permohonan aktif.');
      check(!lot || lot.invoiceStatus === 'confirmed', 'Sahkan bil terlebih dahulu.');
      check(money(d.amount,'Jumlah pemulangan') <= t.refundable, 'Pemulangan melebihi baki dana ejen.');
      const entry = bankRecord(s,action,d,ctx,r,lot?.date || r.date);
      const availableAt = total(s.transfers.filter(x => x.requestId === r.id && x.date <= entry.date),'amount');
      const returnedAt = total(s.returns.filter(x => x.requestId === r.id && x.date <= entry.date),'amount');
      check(availableAt >= returnedAt, 'Tarikh pemulangan mendahului penerimaan dana.');
      return entry;
    }
    case 'request.supplement': {
      check(r.status === 'active' && lot?.invoiceStatus === 'confirmed' && t.payable > 0, 'Tiada baki bil disahkan untuk kelulusan tambahan.');
      check(!s.supplements.some(x => x.requestId === r.id && x.status === 'pending'), 'Permohonan tambahan masih menunggu kelulusan.');
      const headroom = sen(r.approved) + total(s.supplements.filter(x => x.requestId === r.id && x.status === 'approved'),'amount') - sen(t.transferred);
      const needed = (sen(t.payable) - headroom) / 100;
      check(needed > 0, 'Had kelulusan sedia ada mencukupi.');
      const x = {id:ctx.id('TMB'),requestId:r.id,date:date(d.date,lot.date),amount:money(d.amount,'Jumlah tambahan',{max:needed}),
        reason:required(d.reason,'sebab tambahan',800),status:'pending',createdBy:ctx.user.id};
      s.supplements.push(x);
      return x;
    }
    case 'request.supplementApprove':
    case 'request.supplementReject': {
      manage(ctx);
      const x = byId(s.supplements,d.supplementId,'Permohonan tambahan');
      check(x.requestId === r.id && x.status === 'pending' && r.status === 'active', 'Permohonan tambahan sudah diproses atau tidak sepadan.');
      x.status = action === 'request.supplementApprove' ? 'approved' : 'rejected';
      x.reviewedBy = ctx.user.id;
      x.reviewedAt = ctx.now;
      return x;
    }
    case 'request.close':
      reconcileFunds(ctx);
      check(r.status === 'active' && (!lot || lot.invoiceStatus === 'confirmed') && t.balance === 0, 'Sahkan bil dan selesaikan baki sebelum menutup permohonan.');
      check(!s.supplements.some(x => x.requestId === r.id && x.status === 'pending'),'Semak permohonan tambahan terlebih dahulu.');
      r.status = 'closed';
      r.closedBy = ctx.user.id;
      r.closedAt = ctx.now;
      return r;
    default: return null;
  }
}

function purchaseBill(s, action, d, ctx) {
  const p = byId(s.purchases,d.purchaseId,'Lot belian');
  const req = byId(s.requests,p.requestId,'Permohonan');
  check(req.status === 'active' && p.invoiceStatus !== 'confirmed', 'Bil ini telah disahkan atau permohonan telah ditutup.');
  if (action === 'purchase.invoice') {
    p.invoiceNo = required(d.invoiceNo,'nombor invois');
    p.invoiceFile = required(d.invoiceFile,'salinan invois');
    p.invoiceDate = date(d.date,p.date);
    p.invoiceStatus = 'submitted';
  } else {
    reconcileFunds(ctx);
    check(p.invoiceStatus === 'submitted' && p.invoiceFile && p.invoiceNo, 'Salinan dan nombor invois diperlukan.');
    check(p.weight > 0 && p.amount > 0 && p.purity && p.price > 0, 'Butiran berat, mutu, harga dan nilai belian perlu lengkap.');
    p.billDate = date(d.date, p.invoiceDate || p.date);
    p.billNo = ctx.id('PB');
    p.invoiceStatus = 'confirmed';
    p.verifiedBy = ctx.user.id;
    if (currentRules(ctx)) {
      const t=requestTotals(s,req.id);
      p.fundReview={requestId:req.id,transferred:t.transferred,purchased:t.purchased,returned:t.returned,balance:t.balance,verifiedAt:ctx.now};
    }
  }
  check(!s.purchases.some(x => x.id !== p.id && x.agentId === p.agentId && x.invoiceNo && x.invoiceNo.toLowerCase() === p.invoiceNo.toLowerCase()), 'Nombor invois ejen telah digunakan pada lot lain.');
  return p;
}

function sales(s, action, d, ctx) {
  if (action === 'sale.create') {
    const ship = byId(s.dispatches,d.shipmentId,'Penghantaran ke kilang');
    check(!ship.prOnly,'PR sumber belum mempunyai penghantaran yang disahkan.');
    const refinery = byId(s.refineries,ship.refineryId,'Kilang');
    check(!s.sales.some(x => x.shipmentId === ship.id), 'Penghantaran ini telah mempunyai invois jualan.');
    check(ship.lotIds.length > 0 && ship.lotIds.every(id => saleLot(s,id)), 'Penghantaran tidak mempunyai senarai lot yang lengkap.');
    const weight = decimal(d.weight,3,'Berat penetapan harga');
    const price = decimal(d.price,4,'Harga setiap tahil');
    const amount = priceAmount('Tahil',weight,price,refinery.gramsPerTael);
    const x = {id:ctx.id('INV'),shipmentId:ship.id,lotIds:[...ship.lotIds],refineryId:refinery.id,date:date(d.date,ship.date),
      weight,price,method:'Tahil',gramsPerTael:refinery.gramsPerTael,advancePercent:refinery.advancePercent,
      amount,adjustment:0,directCost:0,status:'provisional',createdBy:ctx.user.id};
    s.sales.push(x);
    return x;
  }
  const x = byId(s.sales,d.saleId,'Invois jualan');
  check(!x.historical || (x.operationalReady && x.settlementVerified),'Sahkan penghantaran, harga dan kelengkapan peruntukan bank bagi invois sumber terlebih dahulu.');
  if (action==='sale.refundRequest') {
    const credit=-saleTotals(s,x.id).outstanding;
    check(x.status==='final' && credit>0,'Tiada lebihan bayaran kilang untuk dipulangkan.');
    check(!s.refundRequests.some(r=>r.saleId===x.id && ['pending','approved'].includes(r.status)),'Selesaikan permohonan pemulangan kilang yang terdahulu.');
    const r={id:ctx.id('RFQ'),saleId:x.id,refineryId:x.refineryId,date:date(d.date,x.finalDate),requested:money(d.amount,'Jumlah diminta',{max:credit}),
      purpose:required(d.purpose,'tujuan pemulangan',800),createdBy:ctx.user.id,status:'pending',approved:0};
    s.refundRequests.push(r);
    return r;
  }
  if(action==='sale.refundApprove' || action==='sale.refundReject') {
    manage(ctx);
    const r=byId(s.refundRequests,d.refundRequestId,'Permohonan pemulangan kilang');
    check(r.saleId===x.id && r.status==='pending','Permohonan ini telah disemak atau tidak sepadan dengan invois.');
    if(action==='sale.refundApprove') {
      r.approved=money(d.approved,'Jumlah diluluskan',{max:Math.min(r.requested,-saleTotals(s,x.id).outstanding)});
      r.status='approved';
    } else {
      r.reason=required(d.reason,'sebab penolakan',800);
      r.status='rejected';
    }
    Object.assign(r,{reviewedBy:ctx.user.id,reviewedAt:ctx.now});
    return r;
  }
  finance(ctx);
  if (action === 'sale.receive' || action === 'sale.refund') {
    const t = saleTotals(s,x.id);
    const refund=action==='sale.refund';
    const request=refund ? byId(s.refundRequests,d.refundRequestId,'Permohonan pemulangan kilang') : null;
    if(refund) check(request.saleId===x.id && request.status==='approved','Kelulusan Payment Request kilang diperlukan sebelum duit keluar.');
    const onDate=date(d.date,refund ? request.date : x.date);
    let max=t.outstanding;
    if (refund) {
      check(x.status==='final' && t.outstanding<0,'Tiada lebihan bayaran kilang untuk dipulangkan.');
      const receivedByDate=total(s.receipts.filter(r=>r.saleId===x.id && r.date<=onDate),'amount');
      max=Math.min(-sen(t.outstanding),receivedByDate-sen(t.net))/100;
      check(max>0,'Tiada lebihan bayaran pada tarikh pemulangan ini.');
    } else if (currentRules(ctx)) {
      max=receiptLimit(s,x,onDate);
      check(max>0,'Had pendahuluan telah dicapai atau tiada baki pada tarikh ini. Bayaran baki memerlukan jualan muktamad selepas assay.');
    }
    const amount = money(d.amount,refund?'Pemulangan kepada kilang':'Bayaran diterima',{max});
    if(refund) check(sen(amount)===sen(request.approved),'Amaun bayaran mesti sepadan dengan Payment Request yang diluluskan.');
    const bankRef = required(d.bankRef,'rujukan bank');
    check(!s.receipts.some(r => r.bankRef?.toLowerCase() === bankRef.toLowerCase()), 'Rujukan bayaran telah digunakan.');
    const y = {id:ctx.id(refund?'RFK':'RCP'),saleId:x.id,date:onDate,amount:refund?-amount:amount,bankRef,proof:required(d.proof,'bukti transaksi bank'),receivedBy:ctx.user.id};
    if (refund) {
      Object.assign(y,{kind:'refund',requestId:request.id,refineryId:x.refineryId});
      Object.assign(request,{status:'paid',receiptId:y.id,paidDate:onDate,paidAmount:amount});
    }
    s.receipts.push(y);
    return y;
  }
  if (action === 'sale.finalize') {
    check(x.status === 'provisional', 'Jualan telah dimuktamadkan.');
    const matched = x.lotIds.map(id => currentRules(ctx) ? saleAssay(s,x,id) :
      s.assays.find(a => a.lotId === id && a.dispatchId === x.shipmentId));
    check(matched.every(Boolean), 'Setiap lot dalam penghantaran mesti mempunyai assay yang sepadan.');
    check(x.lotIds.length && x.lotIds.every(id=>saleLot(s,id)?.confirmed), 'Sahkan setiap bil belian dan kos lot simpanan terlebih dahulu.');
    x.adjustment = money(d.adjustment ?? 0,'Pelarasan selepas assay',{min:-9999999999,inclusive:true});
    x.directCost = money(d.directCost ?? 0,'Kos langsung',{inclusive:true});
    x.note = required(d.note,'catatan pengesahan harga, assay dan pelarasan',800);
    const billDates=currentRules(ctx)?s.purchases.filter(p=>x.lotIds.includes(p.id)).map(p=>p.billDate).filter(Boolean):[];
    x.finalDate = date(d.date, [x.date,...matched.map(a => a.date),...billDates].sort().at(-1));
    const t = saleTotals(s,x.id);
    check(t.net >= 0, 'Nilai jualan bersih tidak boleh negatif.');
    if (!currentRules(ctx)) check(t.outstanding>=0,'Nilai muktamad tidak boleh kurang daripada bayaran yang telah diterima.');
    x.status = 'final';
    x.confirmedBy = ctx.user.id;
    return x;
  }
  return null;
}
function recordEinvoice(s,d,ctx) {
  finance(ctx);
  check(!!d.purchaseId !== !!d.saleId, 'Pilih satu transaksi bagi rekod e-Invois.');
  const tx = d.purchaseId ? byId(s.purchases,d.purchaseId,'Belian') : byId(s.sales,d.saleId,'Jualan');
  check(d.purchaseId ? tx.invoiceStatus === 'confirmed' : tx.status === 'final', 'Sahkan transaksi sumber terlebih dahulu.');
  const reference = required(d.reference,'rujukan e-Invois');
  const externalStatus = required(d.status,'status e-Invois',32);
  check(['submitted','validated','cancelled','rejected'].includes(externalStatus), 'Status e-Invois tidak sah.');
  const earlier = s.einvoices.filter(e => e.reference.toLowerCase() === reference.toLowerCase());
  check(earlier.every(e => (e.purchaseId || e.saleId) === tx.id), 'Rujukan e-Invois telah dipautkan kepada transaksi lain.');
  const last = earlier.at(-1);
  const transitions = {submitted:['validated','cancelled','rejected'],validated:['cancelled'],cancelled:[],rejected:[]};
  check(!last || transitions[last.status]?.includes(externalStatus), 'Perubahan status e-Invois ini tidak sah.');
  const x = {id:ctx.id('EINV'), purchaseId:d.purchaseId || null, saleId:d.saleId || null,reference,status:externalStatus,
    date:date(d.date,last?.date || tx.billDate || tx.finalDate || tx.date),file:required(d.file,'salinan e-Invois'),recordedBy:ctx.user.id};
  s.einvoices.push(x);
  return x;
}

export function applyLedger(s,action,d,ctx) {
  if (action === 'agent.create' || action === 'refinery.create') return partner(s,action,d,ctx);
  if (action.startsWith('request.')) return applyRequest(s,action,d,ctx);
  if (action === 'purchase.invoice' || action === 'purchase.confirm') return purchaseBill(s,action,d,ctx);
  if (['sale.create','sale.receive','sale.refundRequest','sale.refundApprove','sale.refundReject','sale.refund','sale.finalize'].includes(action)) return sales(s,action,d,ctx);
  if (action === 'einvoice.record') return recordEinvoice(s,d,ctx);
  return null;
}
