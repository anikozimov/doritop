/* DORI TOP — dorixona egasi kabineti: ombor, CSV, ommaviy narx, bronlar, statistika, profil, xabarlar */
(function () {
  'use strict';
  const T = window.T;
  const D = window.DT;
  const { api, esc, price, fmtDate, daysAgo, statusMeta, resStatusMeta, rxBadge, verifiedBadge, icons, debounce, showToast, onError, loading, openModal, confirmModal, infoModal, actions } = D;
  const $ = (id) => document.getElementById(id);

  const cab = {
    pharmacies: [],
    activeId: null,
    tab: 'inventory',
    inv: { q: '', status: '', stale: false, category: '', sort: '', offset: 0, limit: 50, selected: new Set(), data: null },
    resStatus: '',
    staleDays: 7
  };

  const active = () => cab.pharmacies.find(p => p.id === cab.activeId);

  D.registerPage('pharmacy', async (main) => {
    loading(main);
    const r = await api('/api/my/pharmacies');
    cab.pharmacies = r.pharmacies;
    cab.staleDays = r.stale_threshold || 7;
    if (!cab.pharmacies.length) {
      main.innerHTML = `<div class="glass-strong rounded-3xl p-8 text-center text-sm text-slate-600">${esc(D.state.user.role === 'admin'
        ? T('Sizga biriktirilgan dorixona yo‘q. Boshqa dorixonalarni Admin panel → Dorixonalar bo‘limidan boshqarasiz.')
        : T('Sizga biriktirilgan tasdiqlangan dorixona yo‘q.'))}</div>`;
      return;
    }
    if (!cab.pharmacies.some(p => p.id === cab.activeId)) cab.activeId = cab.pharmacies[0].id;
    renderCabinet(main);
  });

  // Admin "Dorixonalar" ro'yxatidan istalgan dorixonani ochishi uchun
  D.openPharmacyCabinet = (id) => { cab.activeId = Number(id); cab.tab = 'inventory'; D.switchPage('pharmacy'); };

  function renderCabinet(main) {
    let ph = active();
    if (!ph && D.state.user.role === 'admin') {
      // admin boshqa egadagi dorixonani ochdi
      return api(`/api/admin/pharmacies?id=${cab.activeId}`).then(r => {
        const p = r.pharmacies.find(x => x.id === cab.activeId);
        if (!p) { cab.activeId = cab.pharmacies[0] && cab.pharmacies[0].id; return renderCabinet(main); }
        cab.pharmacies.unshift(p);
        renderCabinet(main);
      }).catch(onError);
    }
    const stale = ph.stale_days !== null && ph.stale_days >= cab.staleDays;
    const tabs = [
      ['inventory', 'package', T('Ombor')],
      ['reservations', 'calendar-check', T('Bronlar') + (ph.pending_reservations ? ` (${ph.pending_reservations})` : '')],
      ['stats', 'bar-chart-3', T('Statistika')],
      ['reports', 'flag', T('Xabarlar') + (ph.open_reports ? ` (${ph.open_reports})` : '')],
      ['profile', 'settings', T('Profil')]
    ];
    main.innerHTML = `
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-3 min-w-0">
          ${ph.logo_url ? `<img src="${esc(ph.logo_url)}" alt="" class="w-12 h-12 rounded-xl object-cover border border-slate-200 bg-white"/>` : `<div class="w-12 h-12 rounded-xl bg-sky-50 text-brand-blue flex items-center justify-center"><i data-lucide="building-2" class="w-5 h-5"></i></div>`}
          <div class="min-w-0">
            ${cab.pharmacies.length > 1 ? `<select id="phSelect" class="input font-bold py-2">${cab.pharmacies.map(p => `<option value="${p.id}" ${p.id === ph.id ? 'selected' : ''}>${esc(p.name)} (${esc(p.city)})</option>`).join('')}</select>`
              : `<h1 class="text-xl sm:text-2xl font-extrabold text-slate-900 truncate">${esc(ph.name)}</h1>`}
            <div class="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">${esc(ph.city)}, ${esc(ph.address)} ${verifiedBadge(ph.verified)}${ph.verified ? '' : `<span class="chip bg-slate-100 text-slate-600">${esc(T('Litsenziya tekshirilmagan'))}</span>`}</div>
          </div>
        </div>
        <nav class="flex items-center gap-1 overflow-x-auto bg-slate-200/50 p-1 rounded-2xl">
          ${tabs.map(([k, ic, l]) => `<button type="button" data-action="cab-tab" data-tab="${k}" class="tab inline-flex items-center gap-1.5 ${cab.tab === k ? 'tab-active' : ''}"><i data-lucide="${ic}" class="w-4 h-4"></i>${esc(l)}</button>`).join('')}
        </nav>
      </div>
      ${stale || ph.inventory_count === 0 ? `
      <div class="mb-4 p-4 rounded-2xl ${ph.inventory_count === 0 ? 'bg-sky-50 border border-sky-200 text-sky-900' : 'bg-amber-50 border border-amber-200 text-amber-900'} flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="text-sm">${ph.inventory_count === 0
          ? `<b>${esc(T('Boshlash uchun dorilaringizni qo‘shing.'))}</b> ${esc(T('Ro‘yxatdan tanlang yoki CSV shablonni yuklab, Excel’da to‘ldiring.'))}`
          : `<b>${esc(T('Narxlar {d} kundan beri yangilanmagan.', { d: ph.stale_days }))}</b> ${esc(T('Qidiruvda “eskirgan” deb ko‘rsatiladi. Narxlar o‘zgarmagan bo‘lsa — tasdiqlang.'))}`}</div>
        ${ph.inventory_count ? `<button type="button" data-action="inv-confirm-all" class="btn btn-md btn-green shrink-0"><i data-lucide="check-check" class="w-4 h-4"></i>${esc(T('Barcha narxlarni tasdiqlash'))}</button>` : ''}
      </div>` : ''}
      <div id="cabBody"></div>`;
    if ($('phSelect')) $('phSelect').addEventListener('change', (e) => { cab.activeId = Number(e.target.value); cab.inv.offset = 0; cab.inv.selected.clear(); D.switchPage('pharmacy', { replace: true }); });
    icons();
    const body = $('cabBody');
    ({ inventory: renderInventory, reservations: renderReservations, stats: renderStats, reports: renderReports, profile: renderProfile })[cab.tab](body).catch(onError).finally(icons);
  }

  // =========================================================================
  // OMBOR
  // =========================================================================
  async function renderInventory(body) {
    body.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
        <section class="lg:col-span-7 glass-strong rounded-3xl p-5 relative z-20">
          <h3 class="text-base font-bold text-slate-900 mb-3">${esc(T('Omborga dori qo‘shish'))}</h3>
          <div class="relative">
            <label class="field-label" for="catSearch">${esc(T('Katalogdan qidiring'))}</label>
            <input id="catSearch" autocomplete="off" class="input" placeholder="${esc(T('Dori nomini yozing: paratsetamol, amoksitsillin...'))}"/>
            <div id="catList" class="hidden absolute left-0 right-0 top-full mt-1 glass-strong rounded-2xl overflow-hidden z-30 max-h-80 overflow-y-auto"></div>
          </div>
          <form id="addInvForm" class="hidden mt-3 p-3 rounded-2xl bg-white/80 border border-slate-200">
            <input type="hidden" name="medicine_id"/>
            <div id="pickedMed" class="text-sm font-bold text-slate-900 mb-2"></div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
              <div class="col-span-2 sm:col-span-1"><label class="field-label">${esc(T('Narxi (so‘m)'))}</label><input name="price" type="number" min="0" step="100" required inputmode="numeric" class="input font-bold"/></div>
              <div><label class="field-label">${esc(T('Holati'))}</label><select name="status" class="input font-semibold"><option value="available">${esc(T('Mavjud'))}</option><option value="low">${esc(T('Kam qoldi'))}</option><option value="out">${esc(T('Tugagan'))}</option></select></div>
              <button class="btn btn-md btn-green">${esc(T('Qo‘shish'))}</button>
              <button type="button" data-action="inv-pick-cancel" class="btn btn-md btn-ghost">${esc(T('Bekor qilish'))}</button>
            </div>
          </form>
          <button type="button" data-action="inv-new-med" class="mt-3 text-xs font-bold text-brand-blue hover:underline">+ ${esc(T('Katalogda yo‘q — yangi dori qo‘shish'))}</button>
        </section>
        <section class="lg:col-span-5 glass rounded-3xl p-5">
          <h3 class="text-base font-bold text-slate-900 mb-3">${esc(T('Ko‘plab dorilar'))}</h3>
          <div class="flex flex-wrap gap-2">
            <a href="/api/csv-template" class="btn btn-sm btn-soft" download><i data-lucide="download" class="w-3.5 h-3.5"></i>${esc(T('CSV shablon'))}</a>
            <button type="button" data-action="csv-import-open" class="btn btn-sm btn-blue"><i data-lucide="upload" class="w-3.5 h-3.5"></i>${esc(T('CSV import'))}</button>
            <button type="button" data-action="csv-export" class="btn btn-sm btn-ghost"><i data-lucide="file-down" class="w-3.5 h-3.5"></i>${esc(T('Eksport'))}</button>
            <button type="button" data-action="bulk-price" class="btn btn-sm btn-warn"><i data-lucide="percent" class="w-3.5 h-3.5"></i>${esc(T('Narxlarni ommaviy o‘zgartirish'))}</button>
          </div>
          <p class="muted mt-3">${esc(T('Excel’da: Fayl → Saqlash → “CSV UTF-8”. Ustun nomlari o‘zbekcha yoki ruscha ham bo‘lishi mumkin (nomi, narx, holat...).'))}</p>
        </section>
      </div>
      <section class="glass rounded-3xl overflow-hidden">
        <div class="p-4 border-b border-slate-200/70 flex flex-col gap-3">
          <div id="invFilters" class="flex flex-wrap items-center gap-1.5"></div>
          <div class="flex flex-wrap items-center gap-2">
            <input id="invSearch" type="search" value="${esc(cab.inv.q)}" placeholder="${esc(T('Ombordan qidirish...'))}" class="input max-w-xs py-2"/>
            <select id="invCategory" class="input max-w-[200px] py-2 font-semibold"><option value="">${esc(T('Barcha kategoriyalar'))}</option></select>
            <select id="invSort" class="input max-w-[200px] py-2 font-semibold">
              <option value="">${esc(T('Avval tugaganlar'))}</option>
              <option value="name" ${cab.inv.sort === 'name' ? 'selected' : ''}>${esc(T('Nomi bo‘yicha'))}</option>
              <option value="oldest" ${cab.inv.sort === 'oldest' ? 'selected' : ''}>${esc(T('Eng eski narxlar'))}</option>
              <option value="price" ${cab.inv.sort === 'price' ? 'selected' : ''}>${esc(T('Narx bo‘yicha'))}</option>
            </select>
          </div>
          <div id="invBulkBar" class="hidden flex flex-wrap items-center gap-2 text-sm"></div>
        </div>
        <div id="invTable" class="divide-y divide-slate-200/60"></div>
        <div id="invPager" class="p-3 flex items-center justify-between text-xs text-slate-600"></div>
      </section>`;

    // Katalogdan tanlash
    const catSearch = $('catSearch');
    const catList = $('catList');
    catSearch.addEventListener('input', debounce(async () => {
      const q = catSearch.value.trim();
      if (q.length < 2) { catList.classList.add('hidden'); return; }
      try {
        const r = await api(`/api/medicines/suggest?q=${encodeURIComponent(q)}&pharmacy_id=${cab.activeId}`);
        catList.innerHTML = r.medicines.length ? r.medicines.map(m => `
          <button type="button" data-action="inv-pick" data-med='${esc(JSON.stringify({ id: m.id, name: m.name, dosage: m.dosage, manufacturer: m.manufacturer, my_price: m.my_price }))}' class="w-full px-4 py-2.5 text-left hover:bg-white border-b border-slate-200/60 last:border-0 flex justify-between gap-2">
            <span class="min-w-0"><span class="block text-sm font-bold text-slate-900 truncate">${esc(m.name)} <span class="font-normal text-slate-500">${esc(m.dosage)}</span></span>
            <span class="block text-xs text-slate-500 truncate">${esc(m.active_ingredient)}${m.manufacturer ? ' • ' + esc(m.manufacturer) : ''}${m.verified ? '' : ' • ' + esc(T('tekshirilmagan'))}</span></span>
            ${m.my_price !== null && m.my_price !== undefined ? `<span class="text-xs font-semibold text-brand-green shrink-0">${esc(T('omborda'))}: ${price(m.my_price)}</span>` : ''}
          </button>`).join('') : `<div class="p-3 text-sm text-slate-500">${esc(T('Topilmadi. “Yangi dori qo‘shish” tugmasidan foydalaning.'))}</div>`;
        catList.classList.remove('hidden');
      } catch (err) { onError(err); }
    }, 220));
    if (!cab.catCloseBound) {
      cab.catCloseBound = true;
      document.addEventListener('click', (e) => { const l = $('catList'); if (l && !e.target.closest('#catSearch') && !e.target.closest('#catList')) l.classList.add('hidden'); });
    }

    $('addInvForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api(`/api/pharmacies/${cab.activeId}/inventory`, { method: 'POST', body: { medicine_id: Number(f.elements.medicine_id.value), price: parseInt(f.elements.price.value, 10), status: f.elements.status.value } });
        showToast(T('Saqlandi!'));
        f.classList.add('hidden');
        catSearch.value = '';
        catSearch.focus();
        loadInventory();
      } catch (err) { onError(err); }
    });

    $('invSearch').addEventListener('input', debounce((e) => { cab.inv.q = e.target.value; cab.inv.offset = 0; loadInventory(); }, 300));
    $('invCategory').addEventListener('change', (e) => { cab.inv.category = e.target.value; cab.inv.offset = 0; loadInventory(); });
    $('invSort').addEventListener('change', (e) => { cab.inv.sort = e.target.value; cab.inv.offset = 0; loadInventory(); });
    await loadInventory();
  }

  async function loadInventory() {
    const tbl = $('invTable');
    if (!tbl) return;
    const i = cab.inv;
    const p = new URLSearchParams({ limit: i.limit, offset: i.offset });
    if (i.q) p.set('q', i.q);
    if (i.status) p.set('status', i.status);
    if (i.stale) p.set('stale', '1');
    if (i.category) p.set('category', i.category);
    if (i.sort) p.set('sort', i.sort);
    const r = await api(`/api/pharmacies/${cab.activeId}/inventory?${p}`);
    i.data = r;
    const c = r.counts;
    const all = c.available + c.low + c.out;
    const fbtn = (status, stale, label, n, cls = '') => {
      const on = i.status === status && i.stale === stale;
      return `<button type="button" data-action="inv-filter" data-status="${status}" data-stale="${stale ? 1 : 0}" class="px-3 py-1.5 rounded-xl text-xs font-semibold border ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white/80 border-slate-200 text-slate-700 ' + cls}">${esc(label)} <span class="opacity-70">${n}</span></button>`;
    };
    $('invFilters').innerHTML = fbtn('', false, T('Hammasi'), all) + fbtn('attention', false, T('Tugayotgan va tugagan'), c.low + c.out, 'text-amber-700')
      + fbtn('low', false, T('Kam qoldi'), c.low) + fbtn('out', false, T('Tugagan'), c.out) + fbtn('', true, T('Eskirgan narxlar'), c.stale, 'text-amber-700');
    const catSel = $('invCategory');
    if (catSel.options.length <= 1) catSel.innerHTML = `<option value="">${esc(T('Barcha kategoriyalar'))}</option>` + r.categories.map(x => `<option ${x === i.category ? 'selected' : ''} value="${esc(x)}">${esc(x)}</option>`).join('');

    tbl.innerHTML = r.inventory.length ? `
      <div class="px-4 py-2 bg-slate-50/60 text-xs text-slate-500 flex items-center gap-2"><input type="checkbox" id="invAll" aria-label="${esc(T('Hammasini tanlash'))}" class="w-4 h-4"/> ${esc(T('Sahifadagilarni tanlash'))}</div>` +
      r.inventory.map(item => {
        const st = statusMeta(item.status);
        const stale = item.updated_days >= cab.staleDays;
        return `
        <div class="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3" data-inv-row="${item.id}">
          <div class="flex items-start gap-3 min-w-0">
            <input type="checkbox" data-inv-select="${item.id}" ${i.selected.has(item.id) ? 'checked' : ''} class="mt-1 w-4 h-4 shrink-0" aria-label="${esc(T('Tanlash'))}"/>
            <div class="min-w-0">
              <div class="font-bold text-slate-900">${esc(item.name)} <span class="font-normal text-slate-500 text-sm">${esc(item.dosage)}</span> ${rxBadge(item.prescription)}</div>
              <div class="text-xs text-slate-500">${esc(item.active_ingredient)}${item.manufacturer ? ' • ' + esc(item.manufacturer) : ''} • ${esc(item.category)}</div>
              <div class="text-xs mt-0.5 ${stale ? 'text-amber-600 font-semibold' : 'text-slate-400'}">${esc(T('Yangilangan: {d}', { d: daysAgo(item.updated_days) }))}
                ${item.open_reports ? ` • <span class="text-rose-600 font-semibold">${esc(T('{n} ta shikoyat', { n: item.open_reports }))}</span>` : ''}</div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 pl-7 md:pl-0">
            <span class="chip border ${st.cls} md:hidden">${st.label}</span>
            <input type="number" min="0" step="100" value="${item.price}" data-field="price" aria-label="${esc(T('Narx'))}" class="w-28 px-3 py-2 rounded-xl glass-input text-sm font-bold"/>
            <select data-field="status" aria-label="${esc(T('Holati'))}" class="px-3 py-2 rounded-xl glass-input text-sm font-semibold">
              <option value="available" ${item.status === 'available' ? 'selected' : ''}>${esc(T('Mavjud'))}</option>
              <option value="low" ${item.status === 'low' ? 'selected' : ''}>${esc(T('Kam qoldi'))}</option>
              <option value="out" ${item.status === 'out' ? 'selected' : ''}>${esc(T('Tugagan'))}</option>
            </select>
            <button type="button" data-action="inv-save" data-inv-id="${item.id}" class="btn btn-sm btn-green">${esc(T('Saqlash'))}</button>
            <button type="button" data-action="inv-delete" data-inv-id="${item.id}" class="btn btn-sm btn-danger" aria-label="${esc(T('O‘chirish'))}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </div>
        </div>`;
      }).join('') : `<div class="p-6 text-center text-sm text-slate-500">${esc(all ? T('Filtrga mos dori topilmadi.') : T('Omborda hali dori yo‘q.'))}</div>`;

    const pages = Math.ceil(r.total / i.limit);
    const cur = Math.floor(i.offset / i.limit) + 1;
    $('invPager').innerHTML = r.total > i.limit ? `
      <button type="button" data-action="inv-page" data-dir="-1" class="btn btn-sm btn-ghost" ${cur <= 1 ? 'disabled' : ''}>←</button>
      <span>${esc(T('{a}–{b} / jami {t}', { a: i.offset + 1, b: Math.min(i.offset + i.limit, r.total), t: r.total }))}</span>
      <button type="button" data-action="inv-page" data-dir="1" class="btn btn-sm btn-ghost" ${cur >= pages ? 'disabled' : ''}>→</button>`
      : `<span>${esc(T('Jami: {t}', { t: r.total }))}</span><span></span>`;

    const all2 = $('invAll');
    if (all2) all2.addEventListener('change', () => {
      r.inventory.forEach(it => all2.checked ? i.selected.add(it.id) : i.selected.delete(it.id));
      document.querySelectorAll('[data-inv-select]').forEach(cb => { cb.checked = all2.checked; });
      renderBulkBar();
    });
    document.querySelectorAll('[data-inv-select]').forEach(cb => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.invSelect);
      if (cb.checked) i.selected.add(id); else i.selected.delete(id);
      renderBulkBar();
    }));
    // Enter bosilganda shu qatorni saqlash
    tbl.querySelectorAll('[data-field="price"]').forEach(inp => inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.closest('[data-inv-row]').querySelector('[data-action="inv-save"]').click(); }
    }));
    renderBulkBar();
    icons();
  }

  function renderBulkBar() {
    const bar = $('invBulkBar');
    if (!bar) return;
    const n = cab.inv.selected.size;
    bar.classList.toggle('hidden', !n);
    bar.innerHTML = n ? `
      <span class="font-semibold">${esc(T('{n} ta tanlandi', { n }))}</span>
      <button type="button" data-action="inv-confirm-selected" class="btn btn-sm btn-green"><i data-lucide="check" class="w-3.5 h-3.5"></i>${esc(T('Narxni tasdiqlash'))}</button>
      <button type="button" data-action="bulk-price" data-scope="ids" class="btn btn-sm btn-warn"><i data-lucide="percent" class="w-3.5 h-3.5"></i>${esc(T('Narxni % o‘zgartirish'))}</button>
      <button type="button" data-action="inv-clear-selected" class="btn btn-sm btn-ghost">${esc(T('Tanlovni bekor qilish'))}</button>` : '';
    icons();
  }

  async function newMedicine(force = false, prefill = {}) {
    const v = force ? prefill : await openModal({
      title: T('Yangi dori qo‘shish'),
      intro: esc(T('Avval katalogdan qidiring — dublikatlar qidiruvni chalkashtiradi. Yangi dori administrator tomonidan tekshiriladi.')),
      fields: [
        { name: 'name', label: T('Dori nomi'), required: true, value: prefill.name },
        { name: 'active_ingredient', label: T('Ta’sir etuvchi modda'), required: true, value: prefill.active_ingredient },
        { name: 'dosage', label: T('Doza va shakli'), placeholder: T('500 mg tabletka'), value: prefill.dosage },
        { name: 'manufacturer', label: T('Ishlab chiqaruvchi'), value: prefill.manufacturer },
        { name: 'category', label: T('Kategoriya'), value: prefill.category },
        { name: 'prescription', type: 'checkbox', label: T('Retsept bilan beriladi'), value: prefill.prescription },
        { name: 'price', label: T('Narxi (so‘m)'), type: 'number', min: 0, step: 100, required: true, value: prefill.price },
        { name: 'status', label: T('Holati'), type: 'select', value: prefill.status, options: [{ value: 'available', label: T('Mavjud') }, { value: 'low', label: T('Kam qoldi') }, { value: 'out', label: T('Tugagan') }] }
      ],
      submitLabel: T('Qo‘shish')
    });
    if (!v) return;
    try {
      const r = await api('/api/medicines', { method: 'POST', body: { ...v, force } });
      await api(`/api/pharmacies/${cab.activeId}/inventory`, { method: 'POST', body: { medicine_id: r.medicine.id, price: parseInt(v.price, 10), status: v.status } });
      showToast(r.existed ? T('Bu dori katalogda bor edi — narx unga qo‘shildi.') : T('Dori qo‘shildi!'));
      loadInventory();
    } catch (err) {
      if (err.code === 'medicine.similar_exists') {
        const sim = err.data.similar || [];
        const choice = await openModal({
          title: T('O‘xshash dori topildi'),
          intro: esc(T('Quyidagilardan biri sizning doringizmi?')),
          fields: [{ name: 'pick', type: 'radio', options: [
            ...sim.map(s => ({ value: String(s.id), label: `${s.name} ${s.dosage || ''}`.trim(), help: [s.active_ingredient, s.manufacturer].filter(Boolean).join(' • ') })),
            { value: 'new', label: T('Yo‘q, yangi dori sifatida qo‘shish') }
          ] }],
          submitLabel: T('Davom etish')
        });
        if (!choice) return;
        if (choice.pick === 'new') return newMedicine(true, v);
        try {
          await api(`/api/pharmacies/${cab.activeId}/inventory`, { method: 'POST', body: { medicine_id: Number(choice.pick), price: parseInt(v.price, 10), status: v.status } });
          showToast(T('Saqlandi!'));
          loadInventory();
        } catch (e2) { onError(e2); }
        return;
      }
      onError(err);
    }
  }

  async function csvImport() {
    const v = await openModal({
      title: T('CSV import'),
      wide: true,
      intro: `${esc(T('Faylni tanlang yoki matnni joylashtiring. Ustunlar:'))} <code class="text-xs">name, active_ingredient, manufacturer, dosage, category, price, status, prescription</code>`,
      fields: [
        { type: 'html', html: `<input type="file" id="csvFile" accept=".csv,text/csv,text/plain" class="block w-full text-sm"/>` },
        { name: 'csv', type: 'textarea', rows: 7, label: T('CSV matni'), placeholder: 'name,active_ingredient,manufacturer,dosage,category,price,status' },
        { name: 'missing_as_out', type: 'checkbox', label: T('Faylda yo‘q dorilarni “Tugagan” deb belgilash (to‘liq ro‘yxat yuklaganda)') }
      ],
      submitLabel: T('Yuklash'),
      onOpen: (card) => {
        card.querySelector('#csvFile').addEventListener('change', (e) => {
          const f = e.target.files[0];
          if (!f) return;
          if (f.size > 2.5 * 1024 * 1024) { showToast(T('Fayl juda katta (2.5 MB dan oshmasin).'), 'error'); return; }
          const rd = new FileReader();
          rd.onload = () => { card.querySelector('textarea[name="csv"]').value = rd.result; };
          rd.readAsText(f, 'utf-8');
        });
      }
    });
    if (!v || !v.csv.trim()) return;
    try {
      const r = await api(`/api/pharmacies/${cab.activeId}/inventory/import-csv`, { method: 'POST', body: v });
      const errName = { name: T('nomi yo‘q'), price: T('narx noto‘g‘ri'), status: T('holat noto‘g‘ri') };
      await infoModal(T('Import natijasi'), `
        <ul class="space-y-1">
          <li>✅ ${esc(T('Yuklandi: {n}', { n: r.imported }))} ${r.unchanged ? `<span class="muted">(${esc(T('o‘zgarmagan: {n}', { n: r.unchanged }))})</span>` : ''}</li>
          ${r.created_medicines ? `<li>🆕 ${esc(T('Katalogga yangi dori: {n}', { n: r.created_medicines }))}</li>` : ''}
          ${r.marked_out ? `<li>📦 ${esc(T('“Tugagan” deb belgilandi: {n}', { n: r.marked_out }))}</li>` : ''}
          ${r.skipped ? `<li class="text-rose-600">⚠️ ${esc(T('O‘tkazib yuborildi: {n}', { n: r.skipped }))}</li>` : ''}
        </ul>
        ${r.errors.length ? `<div class="mt-3 max-h-48 overflow-y-auto text-xs bg-rose-50 rounded-xl p-3">${r.errors.map(e => `<div>${esc(T('{n}-qator', { n: e.line }))}: ${esc(errName[e.error] || e.error)}${e.value ? ` (“${esc(e.value)}”)` : ''}</div>`).join('')}</div>` : ''}`);
      D.switchPage('pharmacy', { replace: true });
    } catch (err) { onError(err); }
  }

  async function bulkPrice(scope) {
    const i = cab.inv;
    const cats = (i.data && i.data.categories) || [];
    const opts = [{ value: 'all', label: T('Barcha dorilar') }, { value: 'available', label: T('Faqat mavjudlar') }];
    if (cats.length) opts.push({ value: 'category', label: T('Kategoriya bo‘yicha') });
    if (i.selected.size) opts.unshift({ value: 'ids', label: T('Tanlangan {n} ta dori', { n: i.selected.size }) });
    const v = await openModal({
      title: T('Narxlarni ommaviy o‘zgartirish'),
      intro: esc(T('Masalan, +5 — hamma narxni 5% oshiradi, -10 — 10% kamaytiradi.')),
      fields: [
        { name: 'percent', label: T('Foiz (%)'), type: 'number', step: '0.1', required: true, placeholder: '+5' },
        { name: 'scope', label: T('Qaysi dorilarga'), type: 'select', value: scope || (i.selected.size ? 'ids' : 'all'), options: opts },
        ...(cats.length ? [{ name: 'category', label: T('Kategoriya'), type: 'select', options: cats.map(c => ({ value: c, label: c })) }] : []),
        { name: 'round_to', label: T('Yaxlitlash'), type: 'select', value: '100', options: [1, 10, 50, 100, 500, 1000].map(n => ({ value: String(n), label: n === 1 ? T('yaxlitlamaslik') : T('{n} so‘mgacha', { n }) })) }
      ],
      submitLabel: T('Oldindan ko‘rish')
    });
    if (!v) return;
    const body = { percent: Number(v.percent), scope: v.scope, category: v.category, round_to: Number(v.round_to), ids: v.scope === 'ids' ? [...i.selected] : undefined };
    try {
      const pre = await api(`/api/pharmacies/${cab.activeId}/inventory/bulk-price`, { method: 'POST', body: { ...body, dry_run: true } });
      if (!pre.affected) { showToast(T('O‘zgaradigan narx yo‘q.'), 'info'); return; }
      const ok = await openModal({
        title: T('Tasdiqlang'),
        intro: `<p>${esc(T('{n} ta narx o‘zgaradi ({p}%). Namunalar:', { n: pre.affected, p: body.percent > 0 ? '+' + body.percent : body.percent }))}</p>
          <ul class="mt-2 text-xs space-y-0.5">${pre.sample.map(s => `<li>${esc(s.name)}: ${price(s.from)} → <b>${price(s.to)}</b></li>`).join('')}</ul>`,
        submitLabel: T('Qo‘llash'), danger: body.percent < 0
      });
      if (!ok) return;
      const r = await api(`/api/pharmacies/${cab.activeId}/inventory/bulk-price`, { method: 'POST', body });
      showToast(T('{n} ta narx yangilandi.', { n: r.updated }));
      i.selected.clear();
      loadInventory();
    } catch (err) { onError(err); }
  }

  // =========================================================================
  // BRONLAR
  // =========================================================================
  async function renderReservations(body) {
    body.innerHTML = `
      <div class="flex flex-wrap gap-1.5 mb-3">
        ${[['', T('Faol')], ['completed', T('Yakunlangan')], ['rejected', T('Rad etilgan')], ['cancelled', T('Bekor qilingan')], ['expired', T('Muddati o‘tgan')]].map(([k, l]) => `<button type="button" data-action="res-filter" data-status="${k}" class="px-3 py-1.5 rounded-xl text-xs font-semibold border ${cab.resStatus === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white/80 border-slate-200'}">${esc(l)}</button>`).join('')}
      </div>
      <div id="resOwnerList" class="space-y-3"></div>`;
    loading($('resOwnerList'));
    const r = await api(`/api/pharmacies/${cab.activeId}/reservations${cab.resStatus ? '?status=' + cab.resStatus : ''}`);
    $('resOwnerList').innerHTML = r.reservations.length ? r.reservations.map(x => {
      const st = resStatusMeta(x.status);
      return `
        <div class="glass rounded-2xl p-4">
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2"><span class="font-extrabold">#${esc(x.code)}</span><span class="chip ${st.cls}">${esc(st.label)}</span><span class="muted">${fmtDate(x.created_at)}</span></div>
              <div class="mt-1 text-sm font-semibold">${esc(x.customer_name)} • <a class="text-brand-blue" href="tel:${esc(x.customer_phone.replace(/[^\d+]/g, ''))}">${esc(x.customer_phone)}</a></div>
              <ul class="mt-1 text-sm text-slate-700">${x.items.map(it => `<li>${esc(it.name)} × ${it.qty} — ${price(it.price * it.qty)}</li>`).join('')}</ul>
              ${x.note ? `<div class="mt-1 text-xs text-slate-600">📝 ${esc(x.note)}</div>` : ''}
              ${x.status === 'confirmed' && x.hold_until ? `<div class="mt-1 text-xs font-semibold text-brand-green">${esc(T('{t} gacha ushlab turiladi', { t: fmtDate(x.hold_until) }))}</div>` : ''}
            </div>
            <div class="text-right">
              <div class="text-lg font-extrabold">${price(x.total)}</div>
              <div class="flex flex-wrap gap-1.5 justify-end mt-2">
                ${x.status === 'pending' ? `
                  <button type="button" data-action="res-set" data-id="${x.id}" data-status="confirmed" class="btn btn-sm btn-green">${esc(T('Tasdiqlash'))}</button>
                  <button type="button" data-action="res-set" data-id="${x.id}" data-status="rejected" class="btn btn-sm btn-danger">${esc(T('Rad etish'))}</button>` : ''}
                ${x.status === 'confirmed' ? `
                  <button type="button" data-action="res-set" data-id="${x.id}" data-status="completed" class="btn btn-sm btn-blue">${esc(T('Olib ketildi'))}</button>
                  <button type="button" data-action="res-set" data-id="${x.id}" data-status="expired" class="btn btn-sm btn-ghost">${esc(T('Kelmadi'))}</button>` : ''}
              </div>
            </div>
          </div>
        </div>`;
    }).join('') : `<div class="glass rounded-3xl p-8 text-center text-sm text-slate-600">${esc(T('Bronlar yo‘q.'))}</div>`;
  }

  async function setResStatus(id, status) {
    let extra = {};
    if (status === 'confirmed') {
      const v = await openModal({
        title: T('Bronni tasdiqlash'),
        fields: [
          { name: 'hold_hours', label: T('Necha soat ushlab turasiz?'), type: 'select', value: '3', options: [1, 2, 3, 6, 12, 24, 48].map(h => ({ value: String(h), label: T('{n} soat', { n: h }) })) },
          { name: 'owner_note', label: T('Mijozga izoh (ixtiyoriy)'), type: 'textarea', rows: 2 }
        ],
        submitLabel: T('Tasdiqlash')
      });
      if (!v) return;
      extra = { hold_hours: Number(v.hold_hours), owner_note: v.owner_note };
    } else if (status === 'rejected') {
      const v = await openModal({ title: T('Bronni rad etish'), fields: [{ name: 'owner_note', label: T('Sabab'), type: 'textarea', rows: 2, placeholder: T('Masalan: dori tugab qoldi') }], submitLabel: T('Rad etish'), danger: true });
      if (!v) return;
      extra = { owner_note: v.owner_note };
    }
    try {
      await api(`/api/reservations/${id}/status`, { method: 'POST', body: { status, ...extra } });
      showToast(T('Bron holati yangilandi'));
      D.switchPage('pharmacy', { replace: true });
    } catch (err) { onError(err); }
  }

  // =========================================================================
  // STATISTIKA
  // =========================================================================
  async function renderStats(body) {
    loading(body);
    const r = await api(`/api/pharmacies/${cab.activeId}/stats?days=30`);
    const byDay = new Map(r.series.map(s => [s.day, s]));
    const pts = [];
    for (let d = new Date(r.since + 'T00:00:00Z'); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      pts.push({ x: k.slice(5).split('-').reverse().join('.'), y: (byDay.get(k) || {}).views || 0 });
    }
    const tile = (label, val, icon, cls = 'text-slate-900') => `<div class="glass rounded-2xl p-4"><div class="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i>${esc(label)}</div><div class="text-2xl font-extrabold mt-1 ${cls}">${Number(val).toLocaleString('ru-RU')}</div></div>`;
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">${esc(T('Oxirgi 30 kun. Narxlarni yangilab turish ko‘rishlar va qo‘ng‘iroqlarni oshiradi.'))}</p>
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        ${tile(T('Ko‘rishlar'), r.totals.views, 'eye', 'text-brand-blue')}
        ${tile(T('Qo‘ng‘iroqlar'), r.totals.calls, 'phone', 'text-brand-green')}
        ${tile(T('Yo‘nalishlar'), r.totals.routes, 'navigation')}
        ${tile(T('Bronlar'), r.totals.reservations, 'calendar-check')}
        ${tile(T('Eng arzon narxli dorilar'), r.cheapest_count, 'trophy', 'text-amber-600')}
      </div>
      <section class="card mb-4">
        <h3 class="font-bold text-slate-900 mb-3">${esc(T('Kunlik ko‘rishlar'))}</h3>
        ${D.barChart(pts)}
      </section>
      <section class="card">
        <h3 class="font-bold text-slate-900 mb-3">${esc(T('Eng ko‘p ko‘rilgan dorilaringiz'))}</h3>
        ${r.top.length ? `<table class="w-full text-sm"><thead><tr class="text-xs text-slate-500 text-left"><th class="pb-2">${esc(T('Dori'))}</th><th class="pb-2 text-right">${esc(T('Ko‘rishlar'))}</th><th class="pb-2 text-right">${esc(T('Qo‘ng‘iroqlar'))}</th><th class="pb-2 text-right">${esc(T('Bronlar'))}</th></tr></thead>
          <tbody>${r.top.map(t => `<tr class="border-t border-slate-200/70"><td class="py-2">${esc(t.name)} <span class="text-slate-500">${esc(t.dosage)}</span></td><td class="py-2 text-right font-semibold">${t.views}</td><td class="py-2 text-right">${t.calls}</td><td class="py-2 text-right">${t.reservations}</td></tr>`).join('')}</tbody></table>`
          : `<div class="muted">${esc(T('Hozircha ma’lumot yo‘q.'))}</div>`}
      </section>`;
  }

  // =========================================================================
  // XABARLAR ("noto'g'ri narx")
  // =========================================================================
  const REASONS = () => ({ wrong_price: T('Narx boshqacha'), out_of_stock: T('Dori yo‘q ekan'), closed: T('Dorixona yopiq / ish vaqti noto‘g‘ri'), wrong_info: T('Manzil yoki telefon noto‘g‘ri'), other: T('Boshqa') });
  D.REASONS = REASONS;

  async function renderReports(body) {
    loading(body);
    const r = await api(`/api/pharmacies/${cab.activeId}/reports`);
    body.innerHTML = r.reports.length ? `<div class="space-y-3">${r.reports.map(x => `
      <div class="glass rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div class="font-bold text-slate-900">${esc(x.name)} <span class="font-normal text-slate-500">${esc(x.dosage)}</span></div>
          <div class="text-sm"><span class="chip bg-amber-50 text-amber-700">${esc(REASONS()[x.reason] || x.reason)}</span>
            ${x.current_price !== null ? `<span class="ml-1 text-slate-600">${esc(T('Sizda'))}: <b>${price(x.current_price)}</b></span>` : ''}
            ${x.reported_price ? `<span class="ml-1 text-slate-600">${esc(T('Foydalanuvchi'))}: <b>${price(x.reported_price)}</b></span>` : ''}</div>
          ${x.comment ? `<div class="text-xs text-slate-600 mt-1">“${esc(x.comment)}”</div>` : ''}
          <div class="muted mt-1">${fmtDate(x.created_at)}</div>
        </div>
        <div class="flex gap-1.5">
          <button type="button" data-action="report-resolve" data-id="${x.id}" data-status="resolved" class="btn btn-sm btn-green">${esc(T('Tuzatildi'))}</button>
          <button type="button" data-action="report-resolve" data-id="${x.id}" data-status="dismissed" class="btn btn-sm btn-ghost">${esc(T('Noto‘g‘ri xabar'))}</button>
        </div>
      </div>`).join('')}</div>`
      : `<div class="glass rounded-3xl p-8 text-center text-sm text-slate-600">${esc(T('Ochiq xabarlar yo‘q. Narx yangilanganda tegishli xabarlar avtomatik yopiladi.'))}</div>`;
  }

  // =========================================================================
  // PROFIL (telefonlar, jadval, logotip, xarita)
  // =========================================================================
  async function renderProfile(body) {
    const ph = active();
    const names = D.DAY_NAMES();
    const sched = ph.schedule || null;
    const isAdmin = D.state.user.role === 'admin';
    const dayRow = (d) => {
      const s = sched ? sched[d] : { open: ph.open_time, close: ph.close_time };
      return `<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-day="${d}">
        <span class="w-28 text-sm font-semibold text-slate-700">${esc(names[d])}</span>
        <input type="time" data-open value="${esc(s.open || ph.open_time)}" aria-label="${esc(T('Ochilish'))}" class="input py-1.5 px-2 w-36"/>
        <span class="text-slate-400">–</span>
        <input type="time" data-close value="${esc(s.close || ph.close_time)}" aria-label="${esc(T('Yopilish'))}" class="input py-1.5 px-2 w-36"/>
        <label class="inline-flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" data-closed ${s.closed ? 'checked' : ''} class="w-4 h-4"/> ${esc(T('Dam olish'))}</label>
      </div>`;
    };
    body.innerHTML = `
      <form id="phProfileForm" class="space-y-4">
        <section class="card">
          <h3 class="font-bold text-slate-900 mb-3">${esc(T('Asosiy ma’lumotlar'))}</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="field-label">${esc(T('Dorixona nomi'))}</label><input name="name" class="input ${isAdmin ? '' : 'bg-slate-100'}" value="${esc(ph.name)}" ${isAdmin ? '' : 'disabled'}/></div>
            <div><label class="field-label">${esc(T('Litsenziya raqami'))}</label><input name="license_number" class="input ${isAdmin ? '' : 'bg-slate-100'}" value="${esc(ph.license_number)}" ${isAdmin ? '' : 'disabled'}/></div>
            <div><label class="field-label">${esc(T('Shahar'))}</label><input name="city" class="input" value="${esc(ph.city)}" required/></div>
            <div><label class="field-label">${esc(T('Manzil'))}</label><input name="address" class="input" value="${esc(ph.address)}" required/></div>
            <div><label class="field-label">${esc(T('Asosiy telefon'))}</label><input name="phone" type="tel" class="input" value="${esc(ph.phone)}" required/></div>
            <div><label class="field-label">${esc(T('Qo‘shimcha telefonlar (vergul bilan, 3 tagacha)'))}</label><input name="phones" class="input" value="${esc((ph.phones || []).join(', '))}" placeholder="+998 90 000 00 00, +998 74 000 00 00"/></div>
          </div>
          ${isAdmin ? '' : `<p class="muted mt-2">${esc(T('Nom va litsenziyani faqat administrator o‘zgartiradi.'))}</p>`}
        </section>
        <section class="card">
          <h3 class="font-bold text-slate-900 mb-3">${esc(T('Ish vaqti'))}</h3>
          <label class="inline-flex items-center gap-2 text-sm font-semibold mb-3"><input type="checkbox" name="is_247" ${ph.is_247 ? 'checked' : ''} class="w-4 h-4"/> ${esc(T('24/7 (kecha-kunduz)'))}</label>
          <div class="space-y-2 ${ph.is_247 ? 'hidden' : ''}" id="schedRows">${[1, 2, 3, 4, 5, 6, 0].map(dayRow).join('')}</div>
          <p class="muted mt-2">${esc(T('Tungi smena: yopilish vaqti ochilishdan oldin bo‘lsa (masalan 20:00–06:00), ertasi kuni ertalabgacha ochiq hisoblanadi.'))}</p>
        </section>
        <section class="card">
          <h3 class="font-bold text-slate-900 mb-3">${esc(T('Xaritadagi joylashuv'))}</h3>
          <div class="grid grid-cols-2 gap-3 mb-2">
            <input name="lat" id="ppLat" type="number" step="any" class="input" value="${ph.lat}"/>
            <input name="lng" id="ppLng" type="number" step="any" class="input" value="${ph.lng}"/>
          </div>
          <div id="ppMap" class="w-full h-56 rounded-2xl border border-slate-200 z-10"></div>
        </section>
        <button class="btn btn-md btn-green">${esc(T('Saqlash'))}</button>
      </form>
      <section class="card mt-4">
        <h3 class="font-bold text-slate-900 mb-3">${esc(T('Logotip yoki rasm'))}</h3>
        <div class="flex items-center gap-4">
          ${ph.logo_url ? `<img src="${esc(ph.logo_url)}" alt="" class="w-20 h-20 rounded-2xl object-cover border"/>` : `<div class="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400"><i data-lucide="image" class="w-6 h-6"></i></div>`}
          <div class="space-y-2">
            <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" class="block text-sm"/>
            <div class="muted">${esc(T('PNG, JPEG yoki WEBP, 400 KB gacha. Katta rasm avtomatik kichraytiriladi.'))}</div>
            ${ph.logo_url ? `<button type="button" data-action="logo-delete" class="btn btn-sm btn-danger">${esc(T('O‘chirish'))}</button>` : ''}
          </div>
        </div>
      </section>`;
    D.mountPicker($('ppMap'), $('ppLat'), $('ppLng'));
    const f247 = $('phProfileForm').elements.is_247;
    f247.addEventListener('change', () => $('schedRows').classList.toggle('hidden', f247.checked));
    $('schedRows').querySelectorAll('[data-day]').forEach(row => {
      const cb = row.querySelector('[data-closed]');
      const sync = () => row.querySelectorAll('input[type=time]').forEach(i => { i.disabled = cb.checked; i.classList.toggle('opacity-40', cb.checked); });
      cb.addEventListener('change', sync); sync();
    });

    $('phProfileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const schedule = {};
      f.querySelectorAll('[data-day]').forEach(row => {
        const d = row.dataset.day;
        schedule[d] = row.querySelector('[data-closed]').checked ? { closed: true } : { open: row.querySelector('[data-open]').value, close: row.querySelector('[data-close]').value };
      });
      const days = Object.values(schedule);
      const allSame = days.every(x => !x.closed && x.open === days[0].open && x.close === days[0].close);
      const bodyData = {
        city: f.elements.city.value, address: f.elements.address.value, phone: f.elements.phone.value,
        phones: f.elements.phones.value.split(',').map(s => s.trim()).filter(Boolean),
        is_247: f.elements.is_247.checked, lat: parseFloat(f.elements.lat.value), lng: parseFloat(f.elements.lng.value),
        open_time: allSame ? days[0].open : (days.find(x => !x.closed) || { open: ph.open_time }).open,
        close_time: allSame ? days[0].close : (days.find(x => !x.closed) || { close: ph.close_time }).close,
        schedule: allSame ? '' : schedule
      };
      if (isAdmin) { bodyData.name = f.elements.name.value; bodyData.license_number = f.elements.license_number.value; }
      try {
        await api(`/api/pharmacies/${cab.activeId}`, { method: 'PUT', body: bodyData });
        showToast(T('Dorixona ma’lumotlari yangilandi!'));
        D.switchPage('pharmacy', { replace: true });
      } catch (err) { onError(err); }
    });

    $('logoFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImage(file, 512);
        await api(`/api/pharmacies/${cab.activeId}/logo`, { method: 'POST', body: { data_url: dataUrl } });
        showToast(T('Logotip yuklandi'));
        D.switchPage('pharmacy', { replace: true });
      } catch (err) { onError(err); }
    });
  }

  // Rasmni brauzerda kichraytirib, WEBP/JPEG ko'rinishida yuborish
  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error(T('Faqat PNG, JPEG yoki WEBP rasm yuklang.')));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let out = c.toDataURL('image/webp', 0.85);
        if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.85);
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(T('Rasmni o‘qib bo‘lmadi.'))); };
      img.src = url;
    });
  }

  // =========================================================================
  // HODISALAR
  // =========================================================================
  Object.assign(actions, {
    'cab-tab': (b) => { cab.tab = b.dataset.tab; D.switchPage('pharmacy', { replace: true }); },
    'inv-filter': (b) => { cab.inv.status = b.dataset.status; cab.inv.stale = b.dataset.stale === '1'; cab.inv.offset = 0; loadInventory().catch(onError); },
    'inv-page': (b) => { cab.inv.offset = Math.max(0, cab.inv.offset + Number(b.dataset.dir) * cab.inv.limit); loadInventory().catch(onError); },
    'inv-pick': (b) => {
      const m = JSON.parse(b.dataset.med);
      const f = $('addInvForm');
      f.elements.medicine_id.value = m.id;
      $('pickedMed').innerHTML = `${esc(m.name)} <span class="font-normal text-slate-500">${esc(m.dosage || '')}${m.manufacturer ? ' • ' + esc(m.manufacturer) : ''}</span>`;
      if (m.my_price !== null && m.my_price !== undefined) f.elements.price.value = m.my_price;
      f.classList.remove('hidden');
      $('catList').classList.add('hidden');
      f.elements.price.focus();
    },
    'inv-pick-cancel': () => $('addInvForm').classList.add('hidden'),
    'inv-new-med': () => newMedicine(false, { name: ($('catSearch') || {}).value || '' }),
    'inv-save': async (b) => {
      const row = b.closest('[data-inv-row]');
      try {
        await api(`/api/inventory/${b.dataset.invId}`, { method: 'PATCH', body: { price: parseInt(row.querySelector('[data-field="price"]').value, 10), status: row.querySelector('[data-field="status"]').value } });
        showToast(T('Yangilandi!'));
        loadInventory().catch(onError);
      } catch (err) { onError(err); }
    },
    'inv-delete': async (b) => {
      if (!(await confirmModal(T('O‘chirish'), T('Bu dorini ombordan o‘chirasizmi?')))) return;
      try { await api(`/api/inventory/${b.dataset.invId}`, { method: 'DELETE' }); showToast(T('O‘chirildi'), 'info'); loadInventory().catch(onError); } catch (err) { onError(err); }
    },
    'inv-confirm-all': async () => {
      if (!(await confirmModal(T('Narxlarni tasdiqlash'), T('Barcha narxlar va holatlar to‘g‘ri ekanini tasdiqlaysizmi? Yangilangan sana bugungi kunga o‘zgaradi.'), { danger: false }))) return;
      try { const r = await api(`/api/pharmacies/${cab.activeId}/inventory/confirm`, { method: 'POST', body: {} }); showToast(T('{n} ta narx tasdiqlandi', { n: r.confirmed })); D.switchPage('pharmacy', { replace: true }); } catch (err) { onError(err); }
    },
    'inv-confirm-selected': async () => {
      try { const r = await api(`/api/pharmacies/${cab.activeId}/inventory/confirm`, { method: 'POST', body: { ids: [...cab.inv.selected] } }); showToast(T('{n} ta narx tasdiqlandi', { n: r.confirmed })); cab.inv.selected.clear(); loadInventory().catch(onError); } catch (err) { onError(err); }
    },
    'inv-clear-selected': () => { cab.inv.selected.clear(); loadInventory().catch(onError); },
    'csv-import-open': csvImport,
    'csv-export': () => D.downloadFile(`/api/pharmacies/${cab.activeId}/inventory/export`, `ombor-${cab.activeId}.csv`),
    'bulk-price': (b) => bulkPrice(b.dataset.scope),
    'res-filter': (b) => { cab.resStatus = b.dataset.status; renderReservations($('cabBody')).catch(onError).finally(icons); },
    'res-set': (b) => setResStatus(b.dataset.id, b.dataset.status),
    'report-resolve': async (b) => {
      try { await api(`/api/reports/${b.dataset.id}/resolve`, { method: 'POST', body: { status: b.dataset.status } }); showToast(T('Belgilandi')); D.switchPage(D.state.page, { replace: true }); } catch (err) { onError(err); }
    },
    'logo-delete': async () => {
      try { await api(`/api/pharmacies/${cab.activeId}/logo`, { method: 'DELETE' }); D.switchPage('pharmacy', { replace: true }); } catch (err) { onError(err); }
    }
  });
})();
