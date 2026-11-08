import { priceAmount, requestTotals, priorExcess } from './ledger.mjs';

const roles = ['staff', 'accountant', 'management'];
const thousandths = value => Math.round(value * 1000);
const grams = units => units / 1000;
const totalWeight = values => grams(values.reduce((sum, value) => sum + thousandths(value), 0));
const delta = (before, after) => grams(thousandths(before) - thousandths(after));

function ensure(test, message) {
  if (!test) throw new Error(message);
}

function label(value, name, max = 160) {
  ensure(typeof value === 'string' && value.trim() && value.trim().length <= max, 'Masukkan ' + name + ' yang sah.');
  return value.trim();
}

function dateValue(value, name) {
  const validFormat = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = validFormat ? new Date(value + 'T00:00:00Z') : null;
  ensure(parsed && Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value, 'Tarikh ' + name + ' tidak sah.');
  return value;
}

function orderedDate(value, earliest, name) {
  const date = dateValue(value, name);
  ensure(!earliest || date >= earliest, 'Tarikh ' + name + ' mesti pada atau selepas ' + earliest + '.');
  return date;
}

function numeric(value, name, max, decimalPlaces) {
  ensure((typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '', 'Masukkan ' + name + '.');
  const raw = String(value).trim();
  const n = Number(raw);
  const valid = new RegExp('^\\d+(?:\\.\\d{1,' + decimalPlaces + '})?$').test(raw);
  ensure(valid && Number.isFinite(n) && n > 0 && n <= max, name + ' mesti positif dengan maksimum ' + decimalPlaces + ' tempat perpuluhan.');
  return n;
}

const weight = (n, name = 'Berat') => numeric(n, name, 100000000, 3);
const purity = n => numeric(n, 'Mutu (‰)', 1000, 3);
const rate = n => numeric(n, 'Harga', 100000000, 4);

function attachment(ctx, id, name, imageOnly = false) {
  const key = label(id, name + ' (lampiran)', 180);
  const file = ctx.files?.[key];
  ensure(file, 'Muat naik ' + name + ' dahulu.');
  ensure(!imageOnly || String(file.type).startsWith('image/'), name + ' mesti fail gambar.');
  return key;
}

function findRecord(records, id, name) {
  const rec = records.find(row => row.id === id);
  ensure(rec, name + ' tidak ditemui.');
  return rec;
}

const physicalLots = state => [...state.purchases, ...(state.custodyLots || [])];
const usable = lot => !lot.historical && !lot.imported || lot.operationalReady;

function lotsIn(state, ids) {
  ensure(Array.isArray(ids) && ids.length > 0 && ids.length <= 1000, 'Pilih 1 hingga 1,000 lot emas.');
  ensure(new Set(ids).size === ids.length, 'Lot yang sama dipilih dua kali.');
  const lots = physicalLots(state);
  return ids.map(id => findRecord(lots, id, 'Lot emas'));
}

function shipmentOf(records, lotId) {
  return records.find(record => record.lotIds.includes(lotId));
}

function push(array, rec) {
  array.push(rec);
  return rec;
}

function createPurchase(state, data, ctx) {
  const request = findRecord(state.requests, data.requestId, 'Permohonan bayaran');
  ensure(request.status === 'active' && requestTotals(state, request.id).balance > 0, 'Pilih permohonan yang telah menerima pindahan dan masih mempunyai baki.');
  ensure(!state.purchases.some(p => p.requestId === request.id), 'Pembelian baharu memerlukan permohonan bayaran baharu.');
  const agent = findRecord(state.agents, request.agentId, 'Ejen');
  ensure(!data.agentId || data.agentId === agent.id, 'Ejen tidak sepadan dengan permohonan bayaran.');
  const funded = state.transfers.filter(t => t.requestId === request.id).map(t => t.date).sort()[0];
  ensure(funded, 'Permohonan ini belum menerima pindahan.');
  const date = orderedDate(data.date, funded, 'pembelian');
  if ((ctx.schemaVersion ?? 2) >= 2) {
    const other = priorExcess(state, request, date);
    ensure(!other, 'Pulangkan lebihan bagi permohonan ' + other + ' sebelum merekod pembelian baharu.');
  }
  const fundsOnDate = rows => rows.filter(x => x.requestId === request.id && x.date <= date).reduce((sum, x) => sum + Math.round(x.amount * 100), 0);
  ensure(fundsOnDate(state.transfers) > fundsOnDate(state.returns), 'Permohonan belum mempunyai baki dana pada tarikh pembelian.');
  const original = weight(data.weight);
  const price = rate(data.price);
  const method = agent.method;
  const gramsPerTael = method === 'Tahil' ? numeric(agent.gramsPerTael, 'Gram per tahil', 100000, 6) : null;
  const amount = priceAmount(method, original, price, gramsPerTael);
  ensure(amount > 0, 'Nilai pembelian mesti sekurang-kurangnya RM 0.01.');
  const invoiceNo = data.invoiceNo?.trim() || '';
  ensure(!!invoiceNo === !!data.invoiceFile, 'Sertakan nombor dan salinan invois bersama-sama.');
  if (invoiceNo) {
    label(invoiceNo, 'nombor invois');
    ensure(!state.purchases.some(p => p.agentId === agent.id && p.invoiceNo?.toLowerCase() === invoiceNo.toLowerCase()),
      'Nombor invois ini sudah direkodkan untuk ejen tersebut.');
  }
  return push(state.purchases, {
    id: ctx.id('LOT'), requestId: request.id, agentId: agent.id, owner: label(data.owner, 'nama pemilik emas'),
    ownerRef: data.ownerRef ? label(data.ownerRef, 'rujukan pemilik') : null,
    date, type: label(data.type, 'jenis emas'), purity: purity(data.purity), weight: original, method,
    price, gramsPerTael, amount, photo: attachment(ctx, data.photo, 'gambar emas', true),
    invoiceNo, invoiceFile: invoiceNo ? attachment(ctx, data.invoiceFile, 'invois pembekal') : '',
    invoiceDate: invoiceNo ? orderedDate(data.invoiceDate || date, date, 'invois') : '',
    invoiceStatus: invoiceNo ? 'submitted' : 'pending', lock: null, locks: [], process: null,
  });
}

function createCustody(state, data, ctx) {
  ensure(['ariffin', 'thirdParty'].includes(data.ownership), 'Pilih pemilik emas.');
  const own = data.ownership === 'ariffin';
  const owner = own ? 'Ariffin Jewels' : label(data.owner, 'nama pemilik emas');
  const ownerRef = own ? 'AJ' : label(data.ownerRef, 'rujukan tetap pemilik');
  const agentId = data.agentId ? findRecord(state.agents, data.agentId, 'Ejen').id : null;
  const rec = {
    id: ctx.id('LOT'), custodyOnly: true, ownership: data.ownership, owner, ownerRef, agentId,
    date: dateValue(data.date, 'rekod emas'), weight: weight(data.weight),
    photo: attachment(ctx, data.photo, 'gambar lot emas', true),
    type: data.type ? label(data.type, 'jenis emas') : null, purity: data.purity ? purity(data.purity) : null,
    process: null, costVerified: false, registeredBy: ctx.user.name,
  };
  return push(state.custodyLots ??= [], rec);
}

function verifyCustodyCost(state, data, ctx) {
  ensure(['accountant','management'].includes(ctx.user.role), 'Kos perlu disahkan oleh akauntan atau pengurusan.');
  const lot = findRecord(state.custodyLots || [], data.lotId, 'Lot emas');
  ensure(!lot.costVerified, 'Kos sudah disahkan. Gunakan pembetulan untuk mengubahnya.');
  const raw = String(data.cost ?? '').trim();
  ensure(/^\d+(?:\.\d{1,2})?$/.test(raw) && Number(raw) <= 1e12, 'Masukkan kos sebenar dalam RM, sehingga dua tempat perpuluhan.');
  const proof = attachment(ctx, data.costProof, 'dokumen kos');
  Object.assign(lot,{verifiedCost:Number(raw), costVerified:true, costProof:proof, costNote:label(data.note,'asas kos',800),
    costVerifiedBy:ctx.user.name, costVerifiedAt:ctx.now});
  return lot;
}

function lockGold(state, data, ctx) {
  const lot = findRecord(state.purchases, data.lotId, 'Lot emas');
  const number = label(data.number, 'nombor MKS Lock');
  const allLocks = p => Array.isArray(p.locks) && p.locks.length ? p.locks : (p.lock ? [p.lock] : []);
  ensure(![...state.purchases.flatMap(allLocks),...(state.locks||[])].some(l => l.number?.toLowerCase() === number.toLowerCase()), 'Nombor MKS Lock sudah digunakan.');
  const dateTime = label(data.dateTime, 'tarikh dan masa lock');
  ensure(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(dateTime), 'Masukkan tarikh dan masa lock (waktu Malaysia).');
  orderedDate(dateTime.slice(0, 10), lot.date, 'lock');
  const previous = allLocks(lot);
  const locked = weight(data.weight);
  const filled = totalWeight([...previous.map(l => l.weight), locked]);
  ensure(filled <= lot.weight, 'Jumlah berat semua MKS Lock melebihi berat asal lot.');
  const lock = { id: ctx.id('MKS'), agentId: lot.agentId, number, dateTime, price: rate(data.price), weight: locked };
  lot.locks = [...previous, lock];
  lot.lock = lock;
  lot.lockedWeight = filled;
  return lot;
}

function processGold(state, data, ctx) {
  const lot = findRecord(physicalLots(state), data.lotId, 'Lot emas');
  ensure(!lot.process && !shipmentOf(state.deliveries, lot.id), 'Pilihan proses sudah direkodkan. Gunakan pembetulan untuk mengubahnya.');
  ensure(['tarik', 'skip'].includes(data.mode), 'Pilih Tarik atau Tidak tarik.');
  const date = orderedDate(data.date, lot.date, 'proses');
  const isPull = data.mode === 'tarik';
  const before = isPull ? weight(data.before, 'Berat sebelum tarik') : lot.weight;
  const after = isPull ? weight(data.after, 'Berat selepas tarik') : lot.weight;
  ensure(after <= before, 'Berat selepas tarik melebihi berat sebelum tarik.');
  const note = data.note ? label(data.note, 'catatan timbangan', 800) : '';
  ensure(before === lot.weight || note, 'Nyatakan sebab berat sebelum tarik berbeza daripada berat asal.');
  lot.process = {
    id: ctx.id('PRC'), mode: data.mode, date, operator: label(data.operator || ctx.user.name, 'pihak yang menjalankan proses'),
    before, after, loss: delta(before, after), note,
    beforePhoto: isPull ? attachment(ctx, data.beforePhoto, 'gambar sebelum tarik', true) : '',
    afterPhoto: isPull ? attachment(ctx, data.afterPhoto, 'gambar selepas tarik', true) : '',
  };
  return lot;
}

function createDelivery(state, data, ctx) {
  const lots = lotsIn(state, data.lotIds);
  const date = dateValue(data.date, 'penghantaran');
  for (const p of lots) {
    ensure(usable(p) && (p.custodyOnly || (p.process && p.process.mode !== 'recorded')), 'Lengkapkan pilihan proses untuk ' + p.id + '.');
    const earliest = p.process?.date || p.date;
    ensure(date >= earliest, 'Tarikh penghantaran mendahului rekod lot ' + p.id + '.');
    attachment(ctx, p.photo, 'gambar lot ' + p.id, true);
    ensure(!shipmentOf(state.deliveries, p.id), 'Lot ' + p.id + ' sudah berada dalam penghantaran.');
  }
  const expectedWeights = Object.fromEntries(lots.map(p => [p.id, weight(p.process?.after ?? p.weight)]));
  const total = totalWeight(Object.values(expectedWeights));
  if (data.weight != null && data.weight !== '') ensure(weight(data.weight) === total, 'Berat keseluruhan tidak sepadan dengan jumlah semua lot.');
  const delivery = {
    id: ctx.id('DLV'), date, lotIds: lots.map(p => p.id), expectedWeights, weight: total,
    photo: attachment(ctx, data.photo, 'gambar penghantaran', true), status: 'sent', receivedWeights: {},
    sentBy: ctx.user.name,
  };
  delivery.formBasis = JSON.stringify([delivery.id,date,total,delivery.photo,delivery.sentBy,lots.map(p => [
    p.id,p.owner,p.ownerRef,p.agentId,state.agents.find(a=>a.id===p.agentId)?.name,expectedWeights[p.id],p.photo,
  ])]);
  return push(state.deliveries, delivery);
}

function issueDeliveryForm(state, data, ctx) {
  const delivery = findRecord(state.deliveries, data.deliveryId, 'Penghantaran');
  ensure(ctx.replaying || delivery.status === 'sent' || delivery.formNeedsReissue, 'Borang mesti dikeluarkan sebelum penerimaan.');
  const file = attachment(ctx, data.file, 'borang penghantaran PDF');
  ensure(ctx.files[file].type === 'application/pdf', 'Borang penghantaran mesti fail PDF.');
  ensure(!!data.basis, 'Borang PDF memerlukan rujukan kepada butiran penghantaran semasa.');
  const current = data.basis === delivery.formBasis;
  ensure(ctx.replaying || current, 'Butiran penghantaran telah berubah. Jana semula borang PDF.');
  const history = delivery.formHistory ??= [];
  const previous = history.find(r=>r.file===file);
  if (previous) {
    ensure(previous.basis===data.basis && (ctx.replaying || delivery.formFile===file), 'Gunakan PDF baharu untuk borang gantian.');
    return delivery;
  }
  ensure(ctx.replaying || !delivery.formFile, 'Borang untuk penghantaran ini sudah dikeluarkan.');
  // Each version retains its original PDF. An approved upstream correction can
  // change a historical snapshot while the actual measured receipt remains on record.
  history.push({file,basis:data.basis,issuedAt:ctx.now,issuedBy:ctx.user.name});
  Object.assign(delivery, {formNeedsReissue:!current, formFile:current?file:null,
    formIssuedAt:current?ctx.now:null, formIssuedBy:current?ctx.user.name:null});
  return delivery;
}

function receiveDelivery(state, data, ctx) {
  const delivery = findRecord(state.deliveries, data.deliveryId, 'Penghantaran');
  ensure(delivery.status === 'sent', 'Penghantaran sudah diterima.');
  ensure((ctx.schemaVersion ?? 2) < 2 || delivery.formFile || ctx.replaying && delivery.formNeedsReissue, 'Keluarkan borang penghantaran PDF sebelum mengesahkan penerimaan.');
  const date = orderedDate(data.receivedDate, delivery.date, 'penerimaan');
  const incoming = data.receivedWeights;
  ensure(incoming && typeof incoming === 'object' && !Array.isArray(incoming) && Object.keys(incoming).length === delivery.lotIds.length, 'Masukkan timbangan sebenar bagi setiap lot.');
  const receivedWeights = {};
  let different = false;
  for (const lotId of delivery.lotIds) {
    const measured = weight(incoming[lotId], 'Timbangan ' + lotId);
    receivedWeights[lotId] = measured;
    const expected = delivery.expectedWeights?.[lotId] ?? findRecord(physicalLots(state), lotId, 'Lot').process.after;
    if (measured !== expected) different = true;
  }
  const note = data.note ? label(data.note, 'catatan penerimaan', 800) : '';
  ensure(!different || note, 'Catat sebab perbezaan timbangan pada rekod penerimaan. Jika timbangan asal hendak dibetulkan, lengkapkan catatan penerimaan dahulu.');
  Object.assign(delivery, {
    status: 'received', receivedDate: date, receivedWeights, receivedWeight: totalWeight(Object.values(receivedWeights)),
    receivedBy: ctx.user.name, receiveNote: note,
  });
  return delivery;
}

function createDispatch(state, data, ctx) {
  const lots = lotsIn(state, data.lotIds);
  const refinery = findRecord(state.refineries, data.refineryId, 'Kilang');
  const date = dateValue(data.date, 'penghantaran ke kilang');
  const lotWeights = {};
  for (const p of lots) {
    const received = shipmentOf(state.deliveries, p.id);
    ensure(received?.status === 'received' && date >= received.receivedDate, 'Lot ' + p.id + ' perlu diterima sebelum dihantar ke kilang.');
    ensure(ctx.replaying || !received.formNeedsReissue, 'Keluarkan borang penghantaran gantian bagi ' + received.id + ' dahulu.');
    const existing = shipmentOf(state.dispatches, p.id);
    ensure(!existing?.prOnly, 'Lot ' + p.id + ' sudah disenaraikan pada PR ' + existing?.prNo + '. Sahkan penghantaran pada rekod PR tersebut.');
    ensure(!existing, 'Lot ' + p.id + ' sudah dihantar ke kilang.');
    lotWeights[p.id] = received.receivedWeights[p.id];
  }
  const total = totalWeight(Object.values(lotWeights));
  if (data.weight != null && data.weight !== '') ensure(weight(data.weight) === total, 'Berat dihantar perlu sepadan dengan jumlah timbangan lot.');
  return push(state.dispatches, {
    id: ctx.id('DO'), date, refineryId: refinery.id, lotIds: lots.map(p => p.id), lotWeights, weight: total,
    photo: attachment(ctx, data.photo, 'gambar penghantaran ke kilang', true),
    document: attachment(ctx, data.document, 'dokumen sokongan kilang'), prNo: '', prDate: '', sentBy: ctx.user.name,
  });
}

function recordPR(state, data) {
  const dispatch = findRecord(state.dispatches, data.dispatchId, 'Penghantaran ke kilang');
  ensure(!dispatch.prNo, 'PR sudah direkodkan. Gunakan pembetulan untuk mengubahnya.');
  const prNo = label(data.prNo, 'nombor PR');
  ensure(!state.dispatches.some(d => d.refineryId === dispatch.refineryId && d.prNo?.toLowerCase() === prNo.toLowerCase()),
    'Nombor PR sudah digunakan untuk kilang ini.');
  const prDate = orderedDate(data.prDate, dispatch.date, 'PR');
  Object.assign(dispatch, { prNo, prDate });
  return dispatch;
}

function recordAssay(state, data, ctx) {
  const dispatch = findRecord(state.dispatches, data.dispatchId, 'Penghantaran ke kilang');
  const lot = findRecord(physicalLots(state), data.lotId, 'Lot emas');
  ensure(!dispatch.prOnly && usable(dispatch) && usable(lot), 'Sahkan penghantaran dan lot sebelum merekod assay.');
  ensure(dispatch.prNo && dispatch.lotIds.includes(lot.id), 'Pilih lot yang disenaraikan dalam PR kilang ini.');
  ensure(!state.assays.some(a => a.lotId === lot.id), 'Keputusan assay lot ini sudah direkodkan.');
  const date = orderedDate(data.date, dispatch.prDate, 'assay');
  const before = weight(data.before, 'Berat sebelum assay');
  const after = weight(data.after, 'Berat selepas assay');
  const note = data.note ? label(data.note, 'catatan assay', 800) : '';
  const sent = dispatch.lotWeights?.[lot.id] ?? shipmentOf(state.deliveries, lot.id)?.receivedWeights[lot.id];
  ensure(before === sent || note, 'Terangkan perbezaan antara timbangan sebelum assay dengan timbangan dihantar.');
  ensure(after <= before || note, 'Berat selepas assay lebih tinggi. Terangkan perbezaan timbangan.');
  return push(state.assays, {
    id: ctx.id('ASY'), dispatchId: dispatch.id, lotId: lot.id, owner: lot.owner, ownerRef: lot.ownerRef || null, agentId: lot.agentId, prNo: dispatch.prNo,
    date, reportNo: label(data.reportNo, 'nombor laporan assay'), before, after, variance: delta(before, after),
    purity: purity(data.purity), file: attachment(ctx, data.file, 'laporan assay'), note, enteredBy: ctx.user.name,
  });
}

const operations = {
  'purchase.create': createPurchase,
  'custody.create': createCustody,
  'custody.cost': verifyCustodyCost,
  'mks.lock': lockGold,
  'process.save': processGold,
  'delivery.create': createDelivery,
  'delivery.issue': issueDeliveryForm,
  'delivery.receive': receiveDelivery,
  'dispatch.create': createDispatch,
  'dispatch.pr': recordPR,
  'assay.create': recordAssay,
};

export function applyGold(state, action, data, ctx) {
  if (!Object.hasOwn(operations, action)) return null;
  ensure(roles.includes(ctx.user?.role), 'Akses ditolak.');
  return operations[action](state, data, ctx);
}
