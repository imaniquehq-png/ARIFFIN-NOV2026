import { priceAmount } from './ledger.mjs';

export function registerGold(ui) {
  const esc = ui.esc;
  const nowLocal = () => new Date(new Date().getTime() + 8 * 3600000).toISOString().slice(0, 16);
  const today = () => nowLocal().slice(0, 10);
  const opt = (value, label) => ({ value, label });
  const field = (key, label, type = 'text', config = {}) => ({ key, label, type, required: true, ...config });
  const file = (key, label, image = false, required = true) => field(key, label, 'file', { required, accept: image ? 'image/jpeg,image/png,image/webp' : '.pdf,.jpg,.jpeg,.png,.webp' });
  const weigh = (key, label, config) => field(key, label, 'number', { min: '0.001', step: '0.001', ...config });
  const price = (key, label, config) => field(key, label, 'number', { min: '0.0001', step: '0.0001', ...config });
  const dateField = (key, label, min) => field(key, label, 'date', { value: today(), min });
  const note = label => field('note', label, 'textarea', { required: false });
  const purity = config => weigh('purity', 'Mutu emas (‰)', { max: '1000', help: 'Contoh 916 atau 999.9.', ...config });
  const op = (label, cb, style = 'secondary') => ui.btn(label, cb, style);
  const docButton = (label, type, id) => op(label, () => ui.printDoc(type, id));
  const mainButton = (label, cb) => op(label, cb, 'primary');
  const actions = (...arr) => '<div class="actions">' + arr.filter(Boolean).join('') + '</div>';
  const facts = pairs => '<div class="facts">' + pairs.map(([k,v]) => '<div><small>' + esc(k) + '</small><strong>' + v + '</strong></div>').join('') + '</div>';
  const text = value => value == null || value === '' ? '—' : esc(String(value));
  const link = (page, id, label = id) => id ? ui.link(label || id, () => ui.go(page==='purchases' && lookup('custodyLots',id)?'deliveries':page, { id })) : '—';
  const weightText = value => value==null ? '—' : ui.g(value);
  const moneyText = value => value==null ? '—' : ui.rm(value);
  const rateText = value => value==null ? '—' : 'RM '+Number(value).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:6});
  const sourceRef = x => x?.source ? text((x.source.sheetTitle||x.source.title)+' · baris '+x.source.rowNo) : '—';
  const weightDisplay = p => p.weight!=null ? ui.g(p.weight) : p.recordedWeight==null ? '—' : ui.g(p.recordedWeight)+'<br><small>'+text(p.weightBasis==='beforePull'?'Sebelum tarik':'Selepas tarik')+'</small>';
  const table = (heads, rows, message) => rows.length ? ui.table(heads, rows) : '<div class="empty">' + esc(message) + '</div>';
  const badge = (label, tone) => ui.badge(label, tone);
  const lookup = (key, id) => (ui.state[key]||[]).find(row => row.id === id);
  const physicalLots = () => [...ui.state.purchases,...(ui.state.custodyLots||[])];
  const physicalLot = id => lookup('purchases',id) || lookup('custodyLots',id);
  const usable = p => !p.historical && !p.imported || p.operationalReady;
  const beforeDelivery = p => p.process?.after ?? p.weight;
  const agent = id => lookup('agents', id)?.name || id;
  const refinery = id => lookup('refineries', id)?.name || id;
  const deliveryOf = p => ui.state.deliveries.find(d => d.lotIds.includes(p.id));
  const dispatchOf = p => ui.state.dispatches.find(d => d.lotIds.includes(p.id));
  const assayOf = p => ui.state.assays.find(a => a.lotId === p.id);
  const lotsIn = d => d.lotIds.map(physicalLot).filter(Boolean);
  const listOfLocks = p => p.locks?.length ? p.locks : p.lock ? [p.lock] : [];
  const locked = p => p.lockedWeight ?? listOfLocks(p).reduce((sum, l) => sum + l.weight, 0);
  const lockBadge = p => p.historical && p.lockedWeight==null ? badge('Belum dipadankan','neutral') : locked(p) >= p.weight ? badge('Locked', 'green') : locked(p) > 0 ? badge('Lock separa', 'amber') : badge('Pending Lock', 'amber');
  const invoiceBadge = p => !usable(p) ? badge(p.invoiceNo?'Rujukan direkod':'Tiada rujukan','neutral') : p.invoiceStatus === 'confirmed' ? badge('Disahkan', 'green') : p.invoiceStatus === 'submitted' ? badge('Untuk semakan', 'blue') : badge('Belum ada invois', 'amber');
  const processBadge = p => !p.process ? badge('Belum direkod', 'amber') : p.process.mode==='recorded' ? badge('Timbangan direkod','neutral') : badge(p.process.mode === 'tarik' ? 'Tarik' : 'Tidak tarik', 'green');
  const receiptBadge = d => d.formNeedsReissue ? badge('Borang gantian diperlukan','amber') : d.status === 'received' ? badge('Diterima', 'green') : badge('Dalam penghantaran', 'amber');
  const assayBadge = d => {
    if(d.prOnly)return badge('PR direkod','blue');
    const count = ui.state.assays.filter(a => a.dispatchId === d.id).length;
    return count === d.lotIds.length ? badge('Assay lengkap', 'green') : count ? badge(count + '/' + d.lotIds.length + ' keputusan', 'blue') : d.prNo ? badge('Menunggu assay', 'amber') : badge('Menunggu PR', 'amber');
  };
  const attachment = (id, label) => id ? ui.file(id, label) : '—';
  const audit = id => op('Sejarah & pembetulan', () => ui.go('audit', { id }));
  const reconcile = (collection,r) => r.historical && ui.reconcile ? op('Padankan rekod asal',()=>ui.reconcile(collection,r.id)) : '';
  const back = (label, page) => op(label, () => ui.go(page), 'ghost');
  const newAction = (params, callback) => { if (params.new) queueMicrotask(callback); };
  const sortLatest = arr => [...arr].reverse().sort((a, b) => (b.date || b.sourceDate || '').localeCompare(a.date || a.sourceDate || ''));

  function actForm(title, fields, action, prepare = v => v, description) {
    ui.form({ title, fields, description, onSubmit: async values => {
      const data = prepare(values);
      await ui.act(action, data);
    } });
  }
  function prerequisite(title, message, page, buttonLabel) {
    ui.dialog(title, '<p>' + esc(message) + '</p>' + actions(mainButton(buttonLabel, () => { ui.close(); ui.go(page); })));
  }
  function pick(title, options, hint, callback) {
    ui.dialog(title, (hint ? '<p class="muted">' + esc(hint) + '</p>' : '') +
      '<div class="aj-pick-list">' + options.map(([label, key]) => '<div>' + op(label, () => { ui.close(); callback(key); }) + '</div>').join('') + '</div>');
  }

  function installCalculation(keys, calculate) {
    queueMicrotask(() => {
      const inputs = keys.map(k => document.querySelector('dialog [name="' + k + '"], [role="dialog"] [name="' + k + '"]'));
      if (inputs.some(el => !el)) return;
      const output = document.createElement('output');
      output.className = 'notice';
      output.setAttribute('aria-live', 'polite');
      const container = inputs.at(-1).closest('label') || inputs.at(-1).parentElement;
      container.after(output);
      const refresh = () => { output.textContent = calculate(...inputs.map(el => el.value)); };
      inputs.forEach(el => el.addEventListener('input', refresh));
      refresh();
    });
  }

  function purchaseForm(preferredId) {
    const s = ui.state;
    const available = s.requests.filter(r => {
      const total = rows => rows.filter(t => t.requestId === r.id).reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
      return r.status === 'active' && total(s.transfers) > total(s.returns) && !s.purchases.some(p => p.requestId === r.id);
    });
    if (!available.length) return prerequisite('Rekod pembelian', 'Untuk merekod lot baharu, pilih permohonan yang telah menerima pindahan dan mempunyai baki.', 'requests', 'Lihat permohonan');
    const render = requestId => {
      const request = lookup('requests', requestId);
      const supplier = lookup('agents', request.agentId);
      const tael = supplier.method === 'Tahil';
      const unitText = tael ? 'RM/tahil' : 'RM/g';
      const formula = tael ? 'Berat (g) ÷ ' + supplier.gramsPerTael + ' g/tahil × harga (RM/tahil)' : 'Berat (g) × harga (RM/g)';
      actForm('Rekod pembelian', [
        field('owner', 'Pemilik emas', 'text', { value: supplier.name }),
        field('ownerRef','Rujukan tetap pemilik (jika berlainan daripada ejen)','text',{required:false,help:'Gunakan rujukan pemilik yang sama untuk menggabungkan lot dalam penyata assay.'}),
        dateField('date', 'Tarikh pembelian'),
        field('type', 'Jenis emas', 'text', { help: 'Contoh barang kemas terpakai atau jongkong.' }),
        purity(), weigh('weight', 'Berat asal (g)'), price('price', 'Harga belian (' + unitText + ')', { help: formula }),
        file('photo', 'Gambar emas', true),
        field('invoiceNo', 'Nombor invois pembekal', 'text', { required: false, help: 'Jika belum diterima, biarkan kedua-dua medan invois kosong.' }),
        file('invoiceFile', 'Salinan invois pembekal', false, false),
        field('invoiceDate','Tarikh invois pembekal','date',{required:false,help:'Jika kosong, tarikh pembelian digunakan.'}),
      ], 'purchase.create', v => ({ ...v, requestId }), supplier.name + ' · ' + requestId + ' · ' + supplier.method);
      installCalculation(['weight', 'price'], (w, p) => {
        if (!w || !p) return 'Jumlah belian ' + ui.rm(0);
        try { return 'Jumlah belian ' + ui.rm(priceAmount(supplier.method,w,p,supplier.gramsPerTael)); }
        catch { return 'Semak berat dan harga seunit untuk mengira jumlah belian.'; }
      });
    };
    if (available.some(r => r.id === preferredId)) return render(preferredId);
    if (available.length === 1) return render(available[0].id);
    pick('Pilih permohonan bayaran', available.map(r => [r.id + ' · ' + agent(r.agentId), r.id]), 'Setiap pembelian menggunakan satu permohonan yang telah dibiayai.', render);
  }

  function custodyForm(ownership) {
    if(!ownership)return pick('Daftar emas tanpa pembelian', [['Milik Ariffin Jewels','ariffin'],['Milik pihak lain','thirdParty']], '', custodyForm);
    const fields = ownership==='thirdParty' ? [field('owner','Nama pemilik emas'),field('ownerRef','Rujukan tetap pemilik','text',{help:'Contoh kod syarikat atau nombor pelanggan. Gunakan kod yang sama untuk pemilik ini.'})] : [];
    fields.push(field('agentId','Ejen penghantar (jika ada)','select',{required:false,options:[opt('','Tiada ejen'),...ui.state.agents.map(a=>opt(a.id,a.name))]}),
      dateField('date','Tarikh rekod lot'),weigh('weight','Berat asal (g)'),file('photo','Gambar emas milik pemilik ini',true),
      field('type','Jenis emas','text',{required:false}),purity({required:false}));
    actForm('Daftar lot '+(ownership==='ariffin'?'milik Ariffin Jewels':'milik pihak lain'), fields, 'custody.create', v=>({...v,ownership}));
  }

  function custodyDetail(p) {
    const inward=deliveryOf(p),outward=dispatchOf(p),assay=assayOf(p);
    const costForm=()=>actForm('Sahkan kos lot',[
      field('cost','Kos sebenar lot (RM)','number',{min:0,step:'0.01'}),file('costProof','Dokumen sokongan kos'),field('note','Asas kos','textarea')
    ],'custody.cost',v=>({...v,lotId:p.id}),p.id+' · '+p.owner);
    ui.show({title:p.id,subtitle:'Lot emas milik '+p.owner,actions:back('Semua penerimaan','deliveries'),
      body:ui.section('Butiran lot',facts([['Pemilik',text(p.owner)],['Rujukan pemilik',text(p.ownerRef)],['Ejen penghantar',text(agent(p.agentId))],
        ['Tarikh rekod',ui.date(p.date)],['Berat asal',weightText(p.weight)],['Jenis',text(p.type)],['Mutu (‰)',text(p.purity)],
        ['Gambar emas',attachment(p.photo,'Lihat gambar')],['Proses',processBadge(p)],['Sebelum tarik',weightText(p.process?.before)],['Selepas tarik',weightText(p.process?.after)],
        ['Susut',weightText(p.process?.loss)],['Penghantaran ke Ariffin Jewels',link('deliveries',inward?.id)],['Penghantaran ke kilang',link('shipments',outward?.id)],['Keputusan assay',link('assays',assay?.id)]]))+
      ui.section('Kos lot',facts([['Kos disahkan',p.costVerified?moneyText(p.verifiedCost):'Belum disahkan'],['Dokumen sokongan',attachment(p.costProof,'Lihat dokumen')],['Asas kos',text(p.costNote)]])+
        actions(!p.costVerified&&ui.can('accountant','management')?op('Sahkan kos',costForm):'', !p.process&&!inward?op('Rekod proses',()=>processForm(p)):'',audit(p.id)))});
  }

  function lockForm(lot) {
    if (!lot) {
      const pending = ui.state.purchases.filter(p => usable(p) && locked(p) < p.weight);
      if (!pending.length) return prerequisite('Rekod MKS Lock', 'Tiada lot belian dengan baki berat yang belum dikunci.', 'purchases', 'Lihat pembelian');
      return pick('Pilih lot untuk MKS Lock', pending.map(p => [p.id + ' · ' + p.owner + ' · ' + ui.g(p.weight - locked(p)), p]), '', lockForm);
    }
    const remaining = Math.round((lot.weight - locked(lot)) * 1000) / 1000;
    actForm('Rekod MKS Lock', [
      field('number', 'Nombor MKS Lock'),
      field('dateTime', 'Tarikh dan masa lock (Malaysia)', 'datetime-local', { value: nowLocal() }),
      price('price', 'Harga lock (RM/g)'),
      weigh('weight', 'Berat dikunci (g)', { max: remaining, value: remaining, help: 'Baki belum lock ' + ui.g(remaining) }),
    ], 'mks.lock', v => ({ ...v, lotId: lot.id }), lot.id + ' · ' + lot.owner);
  }

  function processForm(lot, mode) {
    if (!lot) {
      const pending = physicalLots().filter(p => usable(p) && (!p.process || p.process.historical) && !deliveryOf(p));
      if (!pending.length) return prerequisite('Rekod proses', 'Tiada lot belian yang menunggu pilihan proses.', 'purchases', 'Lihat pembelian');
      return pick('Pilih lot untuk proses', pending.map(p => [p.id + ' · ' + p.owner, p]), '', p => processForm(p));
    }
    if (!mode) return pick('Pilihan proses emas', [['Tarik emas', 'tarik'], ['Tidak tarik', 'skip']], lot.id + ' · ' + lot.owner + ' · ' + ui.g(lot.weight), key => processForm(lot, key));
    const isPull = mode === 'tarik';
    const fields = [
      dateField('date', 'Tarikh proses', lot.date),
      field('operator', isPull ? 'Pihak yang menjalankan proses' : 'Direkodkan oleh', 'text', { value: ui.user.name }),
    ];
    if (isPull) fields.push(weigh('before', 'Berat sebelum tarik (g)', { value: lot.weight }), weigh('after', 'Berat selepas tarik (g)'),
      file('beforePhoto', 'Gambar sebelum tarik', true), file('afterPhoto', 'Gambar selepas tarik', true),
      note('Catatan jika timbangan berbeza daripada berat asal'));
    actForm(isPull ? 'Rekod proses tarik' : 'Rekod tidak tarik', fields, 'process.save',
      v => ({ ...v, lotId: lot.id, mode }), lot.id + ' · ' + lot.owner + ' · Berat asal ' + ui.g(lot.weight));
    if (isPull) installCalculation(['before','after'], (b,a) => a ? 'Susut proses ' + ui.g(Number(b) - Number(a)) : 'Masukkan timbangan selepas tarik untuk mengira susut.');
  }

  function shipmentForm(toFactory) {
    const s = ui.state;
    if (toFactory && !s.refineries.length) return prerequisite('Hantar ke kilang', 'Daftarkan kilang penerima sebelum merekod penghantaran.', 'refineries', 'Lihat kilang');
    const eligible = physicalLots().filter(p => usable(p) && (toFactory ? deliveryOf(p)?.status === 'received' && !deliveryOf(p).formNeedsReissue && !dispatchOf(p) : (p.custodyOnly || p.process && p.process.mode !== 'recorded') && !deliveryOf(p)));
    if(toFactory && !eligible.length){
      const reserved=s.dispatches.filter(d=>d.prOnly && lotsIn(d).some(p=>deliveryOf(p)?.status==='received'));
      if(reserved.length)return pick('Sahkan penghantaran pada PR sedia ada',reserved.map(d=>[d.prNo+' · '+refinery(d.refineryId),d]),
        'Lot yang diterima telah disenaraikan pada PR berikut.',d=>ui.go('shipments',{id:d.id}));
    }
    if (!eligible.length) return prerequisite(toFactory ? 'Hantar ke kilang' : 'Hantar ke Ariffin Jewels',
      toFactory ? 'Lot yang telah ditimbang dan diterima akan tersedia untuk penghantaran ke kilang.' : 'Rekodkan pilihan Tarik atau Tidak tarik pada lot belian sebelum menyediakan penghantaran.',
      toFactory ? 'deliveries' : 'processing', toFactory ? 'Lihat penerimaan' : 'Lihat proses emas');
    const fields = [dateField('date', 'Tarikh penghantaran')];
    if (toFactory) fields.unshift(field('refineryId', 'Kilang penerima', 'select', { options: s.refineries.map(r => opt(r.id, r.name)) }));
    eligible.forEach((p, i) => {
      const w = toFactory ? deliveryOf(p).receivedWeights[p.id] : beforeDelivery(p);
      fields.push(field('lot_' + i, p.id + ' · ' + p.owner + ' · ' + ui.g(w), 'checkbox', { required: false }));
    });
    fields.push(file('photo', 'Gambar emas untuk penghantaran ini', true));
    if (toFactory) fields.push(file('document', 'Dokumen sokongan kilang'));
    actForm(toFactory ? 'Hantar ke kilang' : 'Hantar ke Ariffin Jewels', fields, toFactory ? 'dispatch.create' : 'delivery.create', v => {
      const lotIds = eligible.filter((p,i) => v['lot_' + i] === true || ['on','true','1'].includes(v['lot_' + i])).map(p => p.id);
      if (!lotIds.length) throw new Error('Pilih sekurang-kurangnya satu lot.');
      return { date: v.date, refineryId: v.refineryId, photo: v.photo, document: v.document, lotIds };
    }, 'Pilih semua lot yang dihantar bersama. Berat keseluruhan dikira daripada timbangan setiap lot.');
    const boxes = [...document.querySelectorAll('dialog .check-field input[type="checkbox"]')];
    if (boxes.length === eligible.length) {
      const summary = document.createElement('output');
      summary.className = 'notice';
      summary.setAttribute('aria-live','polite');
      boxes.at(-1).closest('label').after(summary);
      const refresh = () => {
        const selected = eligible.filter((lot,i) => boxes[i].checked);
        const total = selected.reduce((sum,p) => sum + Math.round((toFactory ? deliveryOf(p).receivedWeights[p.id] : beforeDelivery(p)) * 1000), 0) / 1000;
        summary.textContent = selected.length + ' lot dipilih · Jumlah berat ' + ui.g(total);
      };
      boxes.forEach(box => box.addEventListener('change',refresh));
      refresh();
    }
  }

  function receiveForm(d) {
    const lots = lotsIn(d);
    actForm('Timbang & sahkan terima', [
      dateField('receivedDate', 'Tarikh penerimaan', d.date),
      ...lots.map((p, i) => weigh('measured_' + i, p.id + ' · ' + p.owner + ' (g)', { help: 'Berat dihantar ' + ui.g(d.expectedWeights?.[p.id] ?? beforeDelivery(p)) })),
      note('Catatan perbezaan timbangan (jika ada)'),
    ], 'delivery.receive', v => ({ deliveryId: d.id, receivedDate: v.receivedDate, note: v.note,
      receivedWeights: Object.fromEntries(lots.map((p, i) => [p.id, v['measured_' + i]])) }),
    d.id + ' · Timbang semula setiap lot. Pengakuan penerimaan tersedia selepas disahkan.');
  }

  function prForm(d) {
    actForm('Rekod PR kilang', [field('prNo', 'Nombor PR kilang'), dateField('prDate', 'Tarikh PR', d.date)],
      'dispatch.pr', v => ({ ...v, dispatchId: d.id }), d.id + ' · ' + refinery(d.refineryId));
  }

  function assayForm(d, lot) {
    if (!d) {
      const pending = ui.state.dispatches.filter(d => !d.prOnly && lotsIn(d).some(l => !assayOf(l)));
      if (!pending.length) return prerequisite('Rekod keputusan assay', 'Keputusan direkodkan mengikut lot dalam penghantaran ke kilang.', 'shipments', 'Lihat penghantaran ke kilang');
      return pick('Pilih penghantaran kilang', pending.map(d => [d.id + ' · ' + refinery(d.refineryId) + ' · ' + (d.prNo || 'Belum ada PR'), d]), '', selected => assayForm(selected));
    }
    if (!d.prNo) return prForm(d);
    if (!lot) return pick('Pilih lot pada laporan kilang', lotsIn(d).filter(l => !assayOf(l)).map(p => [p.id + ' · ' + p.owner, p]),
      d.id + ' · PR ' + d.prNo, selected => assayForm(d, selected));
    actForm('Rekod keputusan assay', [
      field('reportNo', 'Nombor laporan assay'), dateField('date', 'Tarikh assay', d.prDate),
      weigh('before', 'Berat sebelum assay (g)', { help: 'Berat dihantar ' + ui.g(d.lotWeights[lot.id]) }),
      weigh('after', 'Berat selepas assay (g)'), purity(), file('file', 'Salinan laporan assay'),
      note('Catatan perbezaan daripada timbangan dihantar'),
    ], 'assay.create', v => ({ ...v, dispatchId: d.id, lotId: lot.id }),
    d.prNo + ' · ' + lot.id + ' · Pemilik ' + lot.owner + '. Masukkan keputusan sebenar lot ini daripada laporan kilang.');
    installCalculation(['before','after'], (b,a) => b && a ? 'Perbezaan berat ' + ui.g(Number(b) - Number(a)) : 'Masukkan kedua-dua timbangan untuk mengira perbezaan.');
  }

  function standaloneLock(l) {
    ui.dialog(l.id,facts([['Sumber',sourceRef(l)],['Rakan niaga',text(l.partnerName)],['Tarikh lock',ui.date(l.date)],
      ['Nombor MKS',text(l.number)],['Sebutan harga MKS (lajur G)',text(l.price)],['Unit sebut harga',text(l.priceUnit)],['Berat lock',weightText(l.weight)],
      ['Tolok (lajur J)',text(l.deduction)],['Baki dalam lejar (lajur M)',weightText(l.weightRemaining)],['Lot sepadan',link('purchases',l.lotId)]])+actions(reconcile('locks',l)));
  }
  const prices = (role,fn) => (ui.state.goldAllocations||[]).filter(x=>x.role===role && fn(x));
  function allocationDetail(x) {
    ui.dialog(x.id,facts([['Sumber',sourceRef(x)],[x.refineryId?'Kilang':'Ejen',text(x.refineryId?refinery(x.refineryId):agent(x.agentId))],['Pemilik',text(x.owner)],['Tarikh emas',ui.date(x.sourceDate)],
      ['Berat untuk harga',weightText(x.allocatedWeight)],['Harga per gram',rateText(x.price)],['Nilai baris',moneyText(x.amount)],['Rujukan invois',text(x.invoiceNo)],
      ['Lot sepadan',link('purchases',x.lotId)]]));
  }
  function priceTable(rows){
    return rows.length ? ui.table(['Baris harga','Berat untuk harga','Harga per gram','Nilai baris'],rows.map(x=>[
      ui.link(x.id,()=>allocationDetail(x)),weightText(x.allocatedWeight),rateText(x.price),moneyText(x.amount)])) : '';
  }
  function purchaseDetail(p) {
    const d = deliveryOf(p), dispatch = dispatchOf(p), assay = assayOf(p);
    const lotLocks = listOfLocks(p), proc = p.process;
    ui.show({ title: p.id, subtitle: 'Rekod lot emas · ' + (p.owner||agent(p.agentId)),
      actions: actions(back('Semua pembelian','purchases'), docButton('Rekod pembelian PDF','purchase',p.id),reconcile('purchases',p)),
      body: ui.section('Butiran pembelian', facts([
        ['Pemilik emas', text(p.owner)], ['Ejen pembekal', text(agent(p.agentId))], ['Permohonan bayaran',link('requests',p.requestId)],
        [usable(p)?'Tarikh pembelian':'Tarikh emas',ui.date(p.date)], ['Jenis & mutu',[p.type,p.purity!=null?p.purity+'‰':null].filter(Boolean).map(text).join(' · ')||'—'], ['Berat asal',weightText(p.weight)],
        ['Kaedah harga',text(p.method) + (p.method === 'Tahil' && p.gramsPerTael!=null ? ' · ' + text(p.gramsPerTael) + ' g/tahil' : '')],
        ['Harga seunit',p.price==null?'—':rateText(p.price) + (p.priceUnit==='RM/g'?'/g':p.method === 'Tahil' ? '/tahil' : '/g')], ['Nilai pembelian',moneyText(p.amount)],
        ['Gambar emas',attachment(p.photo,'Lihat gambar')], ['Invois pembekal',p.invoiceFile?attachment(p.invoiceFile,p.invoiceNo || 'Lihat invois'):text(p.invoiceNo)], ['Status invois', invoiceBadge(p)],
        ...(p.historical?[['Sumber',sourceRef(p)]]:[]),
      ]) + (p.historical?priceTable(prices('supplier',x=>x.lotId===p.id)):'') + (usable(p)?actions(p.invoiceStatus === 'confirmed' ? docButton('Bil belian PDF','bill',p.id) : op('Urus invois pembekal', () => ui.go('requests', {id:p.requestId})), audit(p.id)):'')) +
      ui.section('MKS Lock', facts([['Status',lockBadge(p)],['Berat dikunci',weightText(usable(p)?locked(p):p.lockedWeight)],['Baki berat',weightText(usable(p)?p.weight-locked(p):null)]]) +
        (lotLocks.length ? ui.table(['Nombor lock','Tarikh & masa (MY)','Harga','Berat'], lotLocks.map(l => [text(l.number),text(l.dateTime?.replace('T',' ')||l.date),l.priceUnit&&l.priceUnit!=='RM/g'?text(l.price)+' '+text(l.priceUnit):rateText(l.price)+'/g',weightText(l.weight)])) : '') +
        (usable(p) && locked(p) < p.weight ? actions(op('Rekod MKS Lock', () => lockForm(p))) : '')) +
      ui.section('Proses emas', proc ? facts([
        ['Pilihan',processBadge(p)], ['Tarikh proses',ui.date(proc.date)], ['Pihak pelaksana',text(proc.operator)], ['Sebelum',weightText(proc.before)], ['Selepas',weightText(proc.after)], ['Susut',weightText(proc.loss)],
        ...(proc.mode === 'tarik' ? [['Gambar sebelum',attachment(proc.beforePhoto,'Lihat gambar')], ['Gambar selepas',attachment(proc.afterPhoto,'Lihat gambar')]] : []),
        ...(proc.note ? [['Catatan',text(proc.note)]] : []),
      ]) + (proc.historical && usable(p) && !d ? actions(op('Sahkan proses emas',()=>processForm(p))) : '') : !usable(p)?'—':actions(op('Pilih proses emas', () => processForm(p)))) +
      ui.section('Pergerakan & assay', facts([
        ['Penghantaran ke Ariffin Jewels', d ? link('deliveries',d.id) : p.historical?'—':'Belum dihantar'],
        ['Berat diterima', d?.status === 'received' ? ui.g(d.receivedWeights[p.id]) : p.historical?'—':'Belum diterima'],
        ['Penghantaran ke kilang',dispatch && !dispatch.prOnly ? link('shipments',dispatch.id) : p.historical?'—':'Belum dihantar'], ['PR kilang',dispatch?.prNo?link('shipments',dispatch.id,dispatch.prNo):text(assay?.prNo)],
        ['Keputusan assay',assay ? link('assays',assay.id,assay.reportNo) : p.historical?'—':'Belum ada keputusan'],
        ...(p.supplierAssay?[['Bacaan assay pembekal',p.supplierAssay.purity!=null?text(p.supplierAssay.purity)+'‰':text(p.supplierAssay.sourcePurity)],
          ['Berat selepas assay dalam lejar pembekal',weightText(p.supplierAssay.after)]]:[]),
      ])),
    });
  }

  function deliveryDetail(d) {
    const received = d.status === 'received';
    const rows = lotsIn(d).map(p => [link('purchases',p.id),text(p.owner), text(agent(p.agentId)), ui.g(d.expectedWeights?.[p.id] ?? beforeDelivery(p)),
      received ? ui.g(d.receivedWeights[p.id]) : '—',attachment(p.photo,'Gambar lot')]);
    ui.show({ title:d.id, subtitle:'Penghantaran kepada Ariffin Jewels', actions: actions(back('Semua penghantaran','deliveries'),
      d.formNeedsReissue?docButton('Keluarkan borang gantian','delivery',d.id): received ? docButton('Pengakuan penerimaan PDF','acknowledgement',d.id) : d.formFile?mainButton('Timbang & sahkan terima',() => receiveForm(d)):docButton('Keluarkan borang penghantaran','delivery',d.id)),
      body:ui.section('Butiran penghantaran',facts([
        ['Tarikh dihantar',ui.date(d.date)], ['Dihantar oleh',text(d.sentBy)], ['Berat dihantar',ui.g(d.weight)], ['Status',receiptBadge(d)],
        ['Gambar penghantaran',attachment(d.photo,'Lihat gambar')],['Borang penghantaran',d.formNeedsReissue?'Perlu dijana semula selepas pembetulan':d.formFile?attachment(d.formFile,'Buka PDF'):received?'—':'Belum dikeluarkan'],['Borang dikeluarkan oleh',text(d.formIssuedBy)],
        ...((d.formHistory||[]).some(r=>r.file!==d.formFile)?[['Versi borang terdahulu',d.formHistory.filter(r=>r.file!==d.formFile).map(r=>attachment(r.file,r.issuedBy+' · '+ui.date(r.issuedAt))).join('<br>')]]:[]), ...(received ? [
          ['Tarikh diterima',ui.date(d.receivedDate)], ['Diterima oleh',text(d.receivedBy)], ['Berat diterima',ui.g(d.receivedWeight)],
          ['Perbezaan dihantar − diterima',ui.g(d.weight-d.receivedWeight)], ['Catatan penerimaan', text(d.receiveNote)],
        ] : []),
      ]) + actions(!d.formNeedsReissue&&(d.formFile||received)?docButton('Borang penghantaran PDF','delivery',d.id):'',audit(d.id))) +
      ui.section('Lot dalam penghantaran',ui.table(['Lot emas','Pemilik','Ejen','Dihantar','Diterima','Gambar'],rows)),
    });
  }

  function dispatchDetail(d) {
    if(d.prOnly){
      const decisions=ui.state.assays.filter(a=>a.dispatchId===d.id);
      ui.show({title:d.prNo,subtitle:'Purchase Requisition · '+refinery(d.refineryId),actions:actions(back('Semua penghantaran','shipments'),reconcile('dispatches',d)),
        body:ui.section('Butiran PR kilang',facts([['Kilang',text(refinery(d.refineryId))],['Nombor PR',text(d.prNo)],['Tarikh PR',ui.date(d.prDate)],
          ['Tarikh dihantar',ui.date(d.date)],['Berat dihantar',weightText(d.weight)],['Status',assayBadge(d)],
          ['Sumber',d.sourceRows.map(ref=>sourceRef({source:ref})).join('<br>')]]))+
          ui.section('Keputusan mengikut lot',table(['Laporan assay','Lot emas','Pemilik','Mutu assay'],decisions.map(a=>[
            link('assays',a.id,a.reportNo||a.id),link('purchases',a.lotId),text(a.owner),a.purity!=null?text(a.purity)+'‰':text(a.sourcePurity)
          ]),'Belum ada keputusan assay yang sepadan.'))});
      return;
    }
    const lots = lotsIn(d), pending = lots.filter(p => !assayOf(p));
    ui.show({title:d.id,subtitle:'Penghantaran ke ' + refinery(d.refineryId),actions:actions(back('Semua penghantaran','shipments'),
      !d.prNo ? mainButton('Rekod PR kilang',() => prForm(d)) : pending.length ? mainButton('Rekod keputusan assay',() => assayForm(d)) : ''),
      body:ui.section('Butiran penghantaran',facts([
        ['Kilang',text(refinery(d.refineryId))], ['Tarikh dihantar',ui.date(d.date)], ['Berat dihantar',ui.g(d.weight)],
        ['Nombor PR',text(d.prNo)], ['Tarikh PR',d.prDate ? ui.date(d.prDate) : '—'],['Status',assayBadge(d)],
        ['Gambar penghantaran',attachment(d.photo,'Lihat gambar')], ['Dokumen sokongan',attachment(d.document,'Lihat dokumen')],
      ]) + actions(docButton('Delivery Order PDF','dispatch',d.id),audit(d.id))) +
      ui.section('Keputusan mengikut lot',ui.table(['Lot emas','Pemilik','Berat dihantar','Status / laporan assay','Tindakan'],
        lots.map(p => {
          const a = assayOf(p);
          return [link('purchases',p.id),text(p.owner),ui.g(d.lotWeights[p.id]), a ? link('assays',a.id,a.reportNo) : badge('Belum assay','amber'),
            a ? docButton('Penyata lot PDF','assay',a.id) : d.prNo ? op('Rekod assay',() => assayForm(d,p)) : 'Menunggu PR'];
        }))),
    });
  }

  function assayDetail(a) {
    const p = physicalLot(a.lotId), d = lookup('dispatches',a.dispatchId);
    ui.show({title:a.reportNo||a.id, subtitle:'Keputusan assay'+(a.owner?' · '+a.owner:''), actions:actions(back('Semua keputusan','assays'),(!a.historical||a.ownerVerified)?docButton('Penyata lot PDF','assay',a.id):''),
      body:ui.section('Keputusan lot',facts([
        ['Lot emas',link('purchases',p?.id)], ['Pemilik',text(a.owner||p?.owner)], ['Ejen',text(agent(a.agentId||p?.agentId))], ['Penghantaran',d?.prOnly?'—':link('shipments',d?.id)],
        ['Kilang',text(refinery(a.refineryId||d?.refineryId))], ['PR kilang',d?.prOnly?link('shipments',d.id,a.prNo):text(a.prNo)], ['Nombor laporan',text(a.reportNo)], ['Tarikh assay',ui.date(a.date)],
        ['Berat sebelum assay',weightText(a.before)], [a.afterBasis==='fineGoldEquivalent'?'Berat emas tulen dikira':'Berat selepas assay',weightText(a.after)], ['Perbezaan',weightText(a.variance)], ['Mutu assay',a.purity!=null?text(a.purity)+'‰':a.sourcePurity!=null?text(a.sourcePurity)+' (seperti dalam helaian)':'—'],
        ['Salinan laporan',attachment(a.file,'Lihat laporan')], ['Catatan',text(a.note)],
        ...(a.historical?[['Sumber',sourceRef(a)],['Tarikh emas',ui.date(a.sourceDate)]]:[]),
      ]) + (a.historical?priceTable(prices('refinery',x=>x.assayId===a.id))+actions(reconcile('assays',a)):actions(audit(a.id)))),
    });
  }

  ui.page('purchases', (params = {}) => {
    const p = params.id && lookup('purchases',params.id);
    if (p) return purchaseDetail(p);
    ui.show({title:'Pembelian emas',subtitle:'Lot emas mengikut pemilik, ejen dan permohonan bayaran.',actions:mainButton('Rekod pembelian',purchaseForm),
      body:table(['Rujukan','Tarikh','Pemilik / ejen','Berat','Nilai belian','Invois','MKS Lock'],
        sortLatest([...ui.state.purchases,...prices('supplier',x=>!x.lotId)]).map(p => p.allocatedWeight!=null && p.role==='supplier'?
          [ui.link(p.id,()=>allocationDetail(p)),ui.date(p.sourceDate),text(agent(p.agentId)),weightText(p.allocatedWeight)+'<br><small>Agihan harga</small>',moneyText(p.amount),text(p.invoiceNo),'—']:
          [link('purchases',p.id),ui.date(p.date),text(p.owner) + '<br><small>' + text(agent(p.agentId)) + '</small>',
          weightDisplay(p),moneyText(p.amount),invoiceBadge(p),lockBadge(p)]), 'Belum ada pembelian emas. Mulakan dengan permohonan bayaran yang telah dibiayai.')});
    newAction(params,() => purchaseForm(params.requestId));
  });
  ui.page('locks', (params = {}) => {
    const lot = params.id && lookup('purchases',params.id);
    if (lot) return purchaseDetail(lot);
    const independent=ui.state.locks||[];
    ui.show({title:'MKS Lock',subtitle:'Semak baki berat yang perlu dikunci bagi setiap lot.',actions:mainButton('Rekod MKS Lock',() => lockForm()),
      body:table(['Rujukan','Pemilik / rakan niaga','Berat asal','Berat dikunci','Baki belum lock','Status','Tindakan'],
        sortLatest([...ui.state.purchases.filter(usable),...independent]).map(p => independent.includes(p)?
          [ui.link(p.id,()=>standaloneLock(p)),text(p.partnerName),'—',weightText(p.weight),'—',badge('Direkod','neutral'),op('Lihat rekod',()=>standaloneLock(p))]:
          [link('purchases',p.id),text(p.owner),ui.g(p.weight),ui.g(locked(p)),ui.g(p.weight-locked(p)),lockBadge(p),
          locked(p) < p.weight ? op('Rekod lock',() => lockForm(p)) : link('purchases',p.id,'Lihat rekod')]), 'Belum ada lot untuk MKS Lock.')});
    if(params.id && independent.some(l=>l.id===params.id))standaloneLock(independent.find(l=>l.id===params.id));
    newAction(params,() => lockForm());
  });
  ui.page('processing', (params = {}) => {
    const lot = params.id && physicalLot(params.id);
    if (lot) return lot.custodyOnly?custodyDetail(lot):purchaseDetail(lot);
    ui.show({title:'Proses tarik emas',subtitle:'Pilih Tarik atau Tidak tarik dan semak susut berat setiap lot.',actions:mainButton('Rekod proses',() => processForm()),
      body:table(['Lot emas','Pemilik','Pilihan proses','Sebelum','Selepas','Susut','Tindakan'],
        sortLatest(physicalLots()).map(p => [link('purchases',p.id),text(p.owner||agent(p.agentId)),processBadge(p),weightText(p.process?.before ?? p.weight),weightText(p.process?.after),
          weightText(p.process?.loss), !usable(p) || deliveryOf(p) || p.process && !p.process.historical ? link('purchases',p.id,'Lihat rekod') : op(p.process?'Sahkan proses':'Pilih proses',() => processForm(p))]), 'Belum ada lot emas.')});
    newAction(params,() => processForm());
  });
  ui.page('deliveries', (params = {}) => {
    const d = params.id && lookup('deliveries',params.id);
    if (d) return deliveryDetail(d);
    const custody=params.id&&lookup('custodyLots',params.id);
    if(custody)return custodyDetail(custody);
    const custodyRows=ui.state.custodyLots||[];
    ui.show({title:'Penghantaran ke Ariffin Jewels',subtitle:'Gabungkan lot dan sahkan timbangan penerimaan mengikut pemilik.',actions:actions(op('Daftar lot tanpa pembelian',()=>custodyForm()),mainButton('Buat penghantaran',() => shipmentForm(false))),
      body:table(['Rujukan','Tarikh','Pemilik','Bil. lot','Berat dihantar','Status','Tindakan'],
        sortLatest(ui.state.deliveries).map(d => [link('deliveries',d.id),ui.date(d.date),text([...new Set(lotsIn(d).map(p => p.owner))].join(', ')),text(d.lotIds.length),ui.g(d.weight),
          receiptBadge(d),d.formNeedsReissue?docButton('Keluarkan borang gantian','delivery',d.id): d.status === 'sent' ? d.formFile?op('Sahkan terima',()=>receiveForm(d)):docButton('Keluarkan borang','delivery',d.id) : link('deliveries',d.id,'Lihat rekod')]), 'Belum ada penghantaran ke Ariffin Jewels.')+
        (custodyRows.length?ui.section('Lot tanpa pembelian',ui.table(['No. lot','Pemilik','Berat asal','Penghantaran'],sortLatest(custodyRows).map(p=>[link('deliveries',p.id),text(p.owner),weightText(p.weight),link('deliveries',deliveryOf(p)?.id)]))):'')});
    newAction(params,() => shipmentForm(false));
  });
  ui.page('shipments', (params = {}) => {
    const d = params.id && lookup('dispatches',params.id);
    if (d) return dispatchDetail(d);
    ui.show({title:'Penghantaran ke kilang',subtitle:'Jejaki lot yang dihantar, PR kilang dan keputusan assay.',actions:mainButton('Hantar ke kilang',() => shipmentForm(true)),
      body:table(['Rujukan','Tarikh dihantar','Kilang','Bil. lot','Berat dihantar','PR kilang','Status'],
        sortLatest(ui.state.dispatches).map(d => [link('shipments',d.id),ui.date(d.date),text(refinery(d.refineryId)),d.prOnly?(d.lotIds.length?text(d.lotIds.length)+' dipadankan':'—'):text(d.lotIds.length),weightText(d.weight),text(d.prNo),assayBadge(d)]),
        'Belum ada penghantaran ke kilang. Lot yang telah diterima boleh dihantar.')});
    newAction(params,() => shipmentForm(true));
  });
  ui.page('assays', (params = {}) => {
    const a = params.id && lookup('assays',params.id);
    if (a) return assayDetail(a);
    const waiting = ui.state.dispatches.filter(d=>!d.prOnly).flatMap(d => lotsIn(d).filter(p => !assayOf(p)).map(p => [link('purchases',p.id),text(p.owner),link('shipments',d.id),
      text(d.prNo),d.prNo ? op('Rekod assay',()=>assayForm(d,p)) : op('Rekod PR',()=>prForm(d))]));
    ui.show({title:'PR & keputusan assay',subtitle:'Masukkan keputusan sebenar bagi lot dan pemilik yang tertera pada laporan kilang.',actions:mainButton('Rekod keputusan',() => assayForm()),
      body:ui.section('Menunggu keputusan',table(['Lot emas','Pemilik','Penghantaran','PR kilang','Tindakan'],waiting,'Tiada lot kilang menunggu keputusan.')) +
      ui.section('Keputusan diterima',table(['Laporan assay','Lot emas','Pemilik','Tarikh','Sebelum','Selepas','Perbezaan','Mutu'],
        sortLatest(ui.state.assays).map(a => [link('assays',a.id,a.reportNo||a.id),link('purchases',a.lotId),text(a.owner),a.date?ui.date(a.date):a.sourceDate?ui.date(a.sourceDate)+'<br><small>Tarikh emas</small>':'—',weightText(a.before),weightText(a.after),weightText(a.variance),a.purity!=null?text(a.purity)+'‰':text(a.sourcePurity)]),
        'Belum ada keputusan assay direkodkan.'))});
    newAction(params,() => assayForm());
  });
}
