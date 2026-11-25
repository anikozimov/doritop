/* DORI TOP — admin panel: arizalar, foydalanuvchilar, dorixonalar, dorilar, eskirgan narxlar, xabarlar, qidiruv statistikasi, audit */
(function () {
  'use strict';
  const T = window.T;
  const D = window.DT;
  const { api, esc, price, fmtDate, rxBadge, verifiedBadge, icons, debounce, showToast, onError, loading, openModal, confirmModal, infoModal, actions } = D;
  const $ = (id) => document.getElementById(id);

  const adm = {
    tab: 'overview',
    users: { q: '', role: '', blocked: false, offset: 0 },
    ph: { q: '', unverified: false, offset: 0 },
    meds: { q: '', unverified: false, offset: 0, rows: [] },
    staleDays: 7,
    reportStatus: 'open',
    audit: { entity: '', offset: 0 },
    stats: null
  };
  const LIMIT = 50;

  function pager(total, offset, action) {
    if (total <= LIMIT) return `<div class="pt-3 muted">${esc(T('Jami: {t}', { t: total }))}</div>`;
    return `<div class="pt-3 flex items-center justify-between text-xs text-slate-600">
      <button type="button" data-action="${action}" data-dir="-1" class="btn btn-sm btn-ghost" ${offset <= 0 ? 'disabled' : ''}>←</button>
      <span>${esc(T('{a}–{b} / jami {t}', { a: offset + 1, b: Math.min(offset + LIMIT, total), t: total }))}</span>
      <button type="button" data-action="${action}" data-dir="1" class="btn btn-sm btn-ghost" ${offset + LIMIT >= total ? 'disabled' : ''}>→</button></div>`;
  }

  D.registerPage('admin', async (main) => {
    const tabs = [
      ['overview', 'layout-dashboard', T('Umumiy')],
      ['users', 'users', T('Foydalanuvchilar')],
      ['pharmacies', 'building-2', T('Dorixonalar')],
      ['medicines', 'pill', T('Dorilar')],
      ['stale', 'clock-alert', T('Eskirgan narxlar')],
      ['reports', 'flag', T('Xabarlar')],
      ['search', 'search', T('Qidiruv statistikasi')],
      ['audit', 'scroll-text', T('Audit')]
    ];
    main.innerHTML = `
      <div class="mb-4">
        <div class="text-xs font-bold uppercase tracking-wider text-brand-blue">${esc(T('Tizim boshqaruvi'))}</div>
        <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900">${esc(T('Admin panel'))}</h1>
      </div>
      <nav class="flex items-center gap-1 overflow-x-auto bg-slate-200/50 p-1 rounded-2xl mb-5">
        ${tabs.map(([k, ic, l]) => `<button type="button" data-action="adm-tab" data-tab="${k}" class="tab inline-flex items-center gap-1.5 ${adm.tab === k ? 'tab-active' : ''}"><i data-lucide="${ic}" class="w-4 h-4"></i>${esc(l)}</button>`).join('')}
      </nav>
      <div id="admBody"></div>`;
    icons();
    const body = $('admBody');
    loading(body);
    await ({ overview, users, pharmacies, medicines, stale, reports, search: searchStats, audit })[adm.tab](body);
  });

  // =========================================================================
  // UMUMIY + ARIZALAR
  // =========================================================================
  async function overview(body) {
    const d = await api('/api/admin/overview');
    adm.staleDays = d.stale_days;
    adm.stats = d.stats;
    const s = d.stats;
    const tile = (label, val, cls, tab) => `<button type="button" ${tab ? `data-action="adm-tab" data-tab="${tab}"` : ''} class="glass rounded-2xl p-4 text-left ${tab ? 'hover:ring-2 hover:ring-brand-blue/30' : ''}"><div class="text-xs font-semibold text-slate-500">${esc(label)}</div><div class="text-2xl font-extrabold mt-1 ${cls}">${val}</div></button>`;
    body.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        ${tile(T('Kutilayotgan arizalar'), s.pending_requests, 'text-amber-600')}
        ${tile(T('Foydalanuvchilar'), s.users, 'text-slate-900', 'users')}
        ${tile(T('Dorixonalar (tasdiqlangan)'), `${s.pharmacies} <span class="text-sm text-brand-green">(${s.verified_pharmacies})</span>`, 'text-slate-900', 'pharmacies')}
        ${tile(T('Dorilar'), s.medicines, 'text-brand-blue', 'medicines')}
        ${tile(T('Tekshirilmagan dorilar'), s.unverified_medicines, s.unverified_medicines ? 'text-amber-600' : 'text-slate-900', 'medicines')}
        ${tile(T('Narx yozuvlari'), s.inventory, 'text-slate-900')}
        ${tile(T('Eskirgan narxli dorixonalar'), s.stale_pharmacies, s.stale_pharmacies ? 'text-amber-600' : 'text-slate-900', 'stale')}
        ${tile(T('Ochiq shikoyatlar'), s.open_reports, s.open_reports ? 'text-rose-600' : 'text-slate-900', 'reports')}
        ${tile(T('Faol bronlar'), s.active_reservations, 'text-slate-900')}
        ${tile(T('Bloklanganlar'), s.blocked_users, 'text-slate-900', 'users')}
      </div>
      ${d.telegram_enabled ? '' : `<div class="mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-sm text-amber-900">${esc(T('Telegram bot sozlanmagan: eslatmalar, “kelganda xabar ber” va parolni tiklash ishlamaydi. .env ga TELEGRAM_BOT_TOKEN kiriting.'))}</div>`}
      <section class="card">
        <h2 class="text-lg font-extrabold text-slate-900 mb-4 flex items-center gap-2"><i data-lucide="inbox" class="w-5 h-5 text-brand-blue"></i>${esc(T('Dorixona ochish arizalari'))}</h2>
        <div class="space-y-3">
          ${d.requests.length ? d.requests.map(r => `
            <div class="bg-white/80 rounded-2xl border border-slate-200/80 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div class="font-bold text-slate-900">${esc(r.name)} <span class="text-xs font-semibold text-brand-blue">• ${esc(T('Litsenziya'))}: ${esc(r.license_number)}</span></div>
                <div class="text-xs text-slate-600 mt-0.5">${esc(r.city)}, ${esc(r.address)} • ${esc(r.phone)} • <a class="text-brand-blue underline" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${Number(r.lat)},${Number(r.lng)}">${esc(T('xaritada'))}</a></div>
                <div class="text-xs text-slate-500 mt-0.5">${esc(T('Ariza beruvchi'))}: ${esc(r.owner_name)} (${esc(r.owner_phone)}) • ${fmtDate(r.created_at)}</div>
                ${r.admin_note && r.status !== 'pending' ? `<div class="text-xs text-slate-500">${esc(T('Izoh'))}: ${esc(r.admin_note)}</div>` : ''}
              </div>
              <div class="flex items-center gap-2 shrink-0">
                ${r.status === 'pending' ? `
                  <button type="button" data-action="adm-approve" data-id="${r.id}" class="btn btn-sm btn-green">${esc(T('Tasdiqlash'))}</button>
                  <button type="button" data-action="adm-reject" data-id="${r.id}" class="btn btn-sm btn-danger">${esc(T('Rad etish'))}</button>`
                  : `<span class="chip ${r.status === 'approved' ? 'bg-emerald-50 text-brand-green' : 'bg-rose-50 text-rose-600'}">${esc(r.status === 'approved' ? T('Tasdiqlangan') : T('Rad etilgan'))}</span>`}
              </div>
            </div>`).join('') : `<div class="text-sm text-slate-500">${esc(T('Hozircha arizalar yo‘q.'))}</div>`}
        </div>
      </section>`;
    icons();
  }

  // =========================================================================
  // FOYDALANUVCHILAR
  // =========================================================================
  async function users(body) {
    const u = adm.users;
    body.innerHTML = `
      <section class="card">
        <div class="flex flex-wrap gap-2 mb-3">
          <input id="uSearch" type="search" value="${esc(u.q)}" placeholder="${esc(T('Ism yoki telefon...'))}" class="input max-w-xs py-2"/>
          <select id="uRole" class="input max-w-[180px] py-2 font-semibold">
            <option value="">${esc(T('Barcha rollar'))}</option>
            ${['user', 'pharmacy_owner', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(D.roleLabel(r))}</option>`).join('')}
          </select>
          <label class="inline-flex items-center gap-2 text-sm font-semibold"><input type="checkbox" id="uBlocked" ${u.blocked ? 'checked' : ''} class="w-4 h-4"/> ${esc(T('Faqat bloklanganlar'))}</label>
        </div>
        <div id="uList" class="divide-y divide-slate-200/70"></div>
      </section>`;
    $('uSearch').addEventListener('input', debounce((e) => { u.q = e.target.value; u.offset = 0; loadUsers(); }, 300));
    $('uRole').addEventListener('change', (e) => { u.role = e.target.value; u.offset = 0; loadUsers(); });
    $('uBlocked').addEventListener('change', (e) => { u.blocked = e.target.checked; u.offset = 0; loadUsers(); });
    await loadUsers();
  }

  async function loadUsers() {
    const u = adm.users;
    const p = new URLSearchParams({ limit: LIMIT, offset: u.offset });
    if (u.q) p.set('q', u.q);
    if (u.role) p.set('role', u.role);
    if (u.blocked) p.set('blocked', '1');
    const r = await api(`/api/admin/users?${p}`);
    const me = D.state.user.id;
    $('uList').innerHTML = (r.users.length ? r.users.map(x => `
      <div class="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="font-bold text-slate-900 text-sm flex flex-wrap items-center gap-1.5">${esc(x.full_name)}
            ${x.blocked_at ? `<span class="chip bg-rose-50 text-rose-600">${esc(T('Bloklangan'))}</span>` : ''}
            ${x.totp_enabled ? `<span class="chip bg-emerald-50 text-brand-green">2FA</span>` : ''}
            ${x.telegram_linked ? `<span class="chip bg-sky-50 text-brand-blue">Telegram</span>` : ''}
          </div>
          <div class="text-xs text-slate-500">${esc(x.phone)} • ${esc(T('Ro‘yxatdan o‘tgan'))}: ${fmtDate(x.created_at, false)}${x.last_login_at ? ' • ' + esc(T('Oxirgi kirish')) + ': ' + fmtDate(x.last_login_at) : ''}
            ${Number(x.pharmacy_count) > 0 ? ` • ${esc(T('Dorixonalar'))}: ${Number(x.pharmacy_count)}` : (x.role === 'pharmacy_owner' ? ` • <span class="text-amber-600 font-semibold">${esc(T('dorixona biriktirilmagan'))}</span>` : '')}</div>
          ${x.blocked_reason ? `<div class="text-xs text-rose-600">${esc(T('Sabab'))}: ${esc(x.blocked_reason)}</div>` : ''}
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <select data-role-user-id="${x.id}" class="px-3 py-1.5 rounded-xl glass-input text-xs font-bold">
            ${['user', 'pharmacy_owner', 'admin'].map(r => `<option value="${r}" ${x.role === r ? 'selected' : ''}>${esc(D.roleLabel(r))}</option>`).join('')}
          </select>
          <button type="button" data-action="adm-role" data-id="${x.id}" class="btn btn-sm btn-blue">${esc(T('Saqlash'))}</button>
          ${x.id !== me ? `
            ${x.blocked_at ? `<button type="button" data-action="adm-unblock" data-id="${x.id}" class="btn btn-sm btn-soft">${esc(T('Blokdan chiqarish'))}</button>`
              : `<button type="button" data-action="adm-block" data-id="${x.id}" class="btn btn-sm btn-warn">${esc(T('Bloklash'))}</button>`}
            <button type="button" data-action="adm-reset-pw" data-id="${x.id}" class="btn btn-sm btn-ghost" title="${esc(T('Vaqtinchalik parol berish'))}"><i data-lucide="key-round" class="w-3.5 h-3.5"></i></button>
            ${x.totp_enabled ? `<button type="button" data-action="adm-reset-2fa" data-id="${x.id}" class="btn btn-sm btn-ghost" title="${esc(T('2FA ni o‘chirish'))}"><i data-lucide="shield-off" class="w-3.5 h-3.5"></i></button>` : ''}
            <button type="button" data-action="adm-delete-user" data-id="${x.id}" class="btn btn-sm btn-danger" title="${esc(T('O‘chirish'))}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : `<span class="muted">${esc(T('(siz)'))}</span>`}
        </div>
      </div>`).join('') : `<div class="py-3 text-sm text-slate-500">${esc(T('Topilmadi.'))}</div>`) + pager(r.total, adm.users.offset, 'adm-users-page');
    icons();
  }

  // Dorixonalari bor foydalanuvchini tushirish/o'chirishda qaror so'rash
  async function pharmacyDecision(err, forDelete) {
    const opts = [
      ...(forDelete ? [] : [{ value: 'keep', label: T('Dorixonalar qolsin'), help: T('Egasi o‘zgarmaydi, admin boshqaradi') }]),
      { value: 'transfer', label: T('Boshqa foydalanuvchiga o‘tkazish') },
      { value: 'delete', label: T('Dorixonalarni o‘chirish'), help: T('Barcha narxlari ham o‘chadi') }
    ];
    const v = await openModal({
      title: T('Dorixonalar bilan nima qilamiz?'),
      intro: esc(err.message),
      fields: [
        { name: 'pharmacy_action', type: 'radio', options: opts },
        { name: 'transfer_to_phone', label: T('Yangi ega telefoni (o‘tkazish tanlansa)'), type: 'tel', placeholder: '+998...' }
      ],
      submitLabel: T('Davom etish'), danger: true
    });
    if (!v) return null;
    if (v.pharmacy_action === 'transfer' && !v.transfer_to_phone) { showToast(T('Yangi ega telefonini kiriting.'), 'error'); return null; }
    if (v.pharmacy_action === 'delete' && !(await confirmModal(T('Ishonchingiz komilmi?'), T('Dorixonalar va ularning barcha narxlari qaytarib bo‘lmaydigan tarzda o‘chiriladi.')))) return null;
    return v;
  }

  async function changeRole(id, role, extra = {}) {
    try {
      const r = await api(`/api/admin/users/${id}/role`, { method: 'PATCH', body: { role, ...extra } });
      showToast(r.warning === 'no_pharmacy' ? T('Rol berildi, lekin dorixona biriktirilmagan. “Dorixonalar” bo‘limida “Egasini o‘zgartirish” orqali biriktiring.') : T('Foydalanuvchi roli yangilandi!'), r.warning ? 'info' : 'success', r.warning ? 7000 : 3200);
      loadUsers().catch(onError);
    } catch (err) {
      if (err.status === 409 && err.data && err.data.needs_decision) {
        const v = await pharmacyDecision(err, false);
        if (v) return changeRole(id, role, v);
        return;
      }
      onError(err);
    }
  }

  async function deleteUser(id, extra = {}) {
    if (!extra.pharmacy_action && !(await confirmModal(T('Foydalanuvchini o‘chirish'), T('Foydalanuvchi, uning bronlari va sevimlilari o‘chiriladi. Bu amalni qaytarib bo‘lmaydi.')))) return;
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE', body: extra });
      showToast(T('Foydalanuvchi o‘chirildi'), 'info');
      loadUsers().catch(onError);
    } catch (err) {
      if (err.status === 409 && err.data && err.data.needs_decision) {
        const v = await pharmacyDecision(err, true);
        if (v) return deleteUser(id, v);
        return;
      }
      onError(err);
    }
  }

  // =========================================================================
  // DORIXONALAR
  // =========================================================================
  async function pharmacies(body) {
    const f = adm.ph;
    body.innerHTML = `
      <section class="card mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div class="flex flex-wrap gap-2">
            <input id="phSearch" type="search" value="${esc(f.q)}" placeholder="${esc(T('Nomi, shahar yoki litsenziya...'))}" class="input max-w-xs py-2"/>
            <label class="inline-flex items-center gap-2 text-sm font-semibold"><input type="checkbox" id="phUnver" ${f.unverified ? 'checked' : ''} class="w-4 h-4"/> ${esc(T('Faqat tekshirilmaganlar'))}</label>
          </div>
          <button type="button" data-action="adm-add-ph" class="btn btn-md btn-green"><i data-lucide="plus" class="w-4 h-4"></i>${esc(T('Dorixona qo‘shish'))}</button>
        </div>
        <div id="phList" class="divide-y divide-slate-200/70"></div>
      </section>`;
    $('phSearch').addEventListener('input', debounce((e) => { f.q = e.target.value; f.offset = 0; loadPharmacies(); }, 300));
    $('phUnver').addEventListener('change', (e) => { f.unverified = e.target.checked; f.offset = 0; loadPharmacies(); });
    await loadPharmacies();
  }

  async function loadPharmacies() {
    const f = adm.ph;
    const p = new URLSearchParams({ limit: LIMIT, offset: f.offset });
    if (f.q) p.set('q', f.q);
    if (f.unverified) p.set('verified', '0');
    const r = await api(`/api/admin/pharmacies?${p}`);
    $('phList').innerHTML = (r.pharmacies.length ? r.pharmacies.map(x => `
      <div class="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="font-bold text-slate-900 text-sm flex flex-wrap items-center gap-1.5">${esc(x.name)} <span class="text-xs font-normal text-slate-500">(${esc(x.city)})</span> ${verifiedBadge(x.verified)}</div>
          <div class="text-xs text-slate-500">${esc(x.address)} • ${esc(T('Litsenziya'))}: ${esc(x.license_number || '—')} • ${esc(T('Ega'))}: ${esc(x.owner_name)} (${esc(x.owner_phone)})</div>
          <div class="text-xs text-slate-500">${esc(T('Narxlar'))}: ${x.inventory_count} • ${esc(T('Oxirgi yangilanish'))}: ${x.last_update ? fmtDate(x.last_update) : '—'}</div>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button type="button" data-action="adm-verify-ph" data-id="${x.id}" data-v="${x.verified ? 0 : 1}" class="btn btn-sm ${x.verified ? 'btn-ghost' : 'btn-green'}">${esc(x.verified ? T('Belgini olish') : T('Litsenziya tekshirildi'))}</button>
          <button type="button" data-action="adm-open-ph" data-id="${x.id}" class="btn btn-sm btn-soft">${esc(T('Kabinet'))}</button>
          <button type="button" data-action="adm-transfer-ph" data-id="${x.id}" class="btn btn-sm btn-soft">${esc(T('Egasini o‘zgartirish'))}</button>
          <button type="button" data-action="adm-audit-ph" data-id="${x.id}" class="btn btn-sm btn-ghost" title="${esc(T('O‘zgarishlar tarixi'))}"><i data-lucide="history" class="w-3.5 h-3.5"></i></button>
          <button type="button" data-action="adm-delete-ph" data-id="${x.id}" class="btn btn-sm btn-danger"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
      </div>`).join('') : `<div class="py-3 text-sm text-slate-500">${esc(T('Topilmadi.'))}</div>`) + pager(r.total, f.offset, 'adm-ph-page');
    icons();
  }

  async function addPharmacy() {
    const v = await openModal({
      title: T('Dorixona qo‘shish'),
      wide: true,
      fields: [
        { name: 'name', label: T('Dorixona nomi'), required: true },
        { name: 'license_number', label: T('Litsenziya raqami') },
        { name: 'verified', type: 'checkbox', label: T('Litsenziya tekshirildi (tasdiqlangan belgisi)') },
        { name: 'city', label: T('Shahar'), required: true },
        { name: 'address', label: T('Manzil'), required: true },
        { name: 'phone', label: T('Telefon'), required: true, type: 'tel' },
        { name: 'owner_phone', label: T('Egasi telefoni (bo‘sh bo‘lsa — siz)'), type: 'tel' },
        { type: 'html', html: `<div class="grid grid-cols-2 gap-2"><input id="mfLat" name="lat" type="number" step="any" value="${D.DEFAULT_CENTER.lat}" class="input"/><input id="mfLng" name="lng" type="number" step="any" value="${D.DEFAULT_CENTER.lng}" class="input"/></div><div id="mfMap" class="mt-2 h-48 rounded-2xl border border-slate-200 z-10"></div>` },
        { name: 'is_247', type: 'checkbox', label: '24/7' },
        { name: 'open_time', label: T('Ochilish'), type: 'time', value: '08:00' },
        { name: 'close_time', label: T('Yopilish'), type: 'time', value: '22:00' }
      ],
      onOpen: () => D.mountPicker($('mfMap'), $('mfLat'), $('mfLng'))
    });
    if (!v) return;
    v.lat = parseFloat(v.lat); v.lng = parseFloat(v.lng);
    try {
      await api('/api/admin/pharmacies', { method: 'POST', body: v });
      showToast(T('Dorixona qo‘shildi!'));
      loadPharmacies().catch(onError);
    } catch (err) { onError(err); }
  }

  // =========================================================================
  // DORILAR
  // =========================================================================
  async function medicines(body) {
    const f = adm.meds;
    body.innerHTML = `
      <section class="card mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div class="flex flex-wrap gap-2">
            <input id="medSearch" type="search" value="${esc(f.q)}" placeholder="${esc(T('Dori nomi yoki ta’sir etuvchi modda...'))}" class="input max-w-xs py-2"/>
            <label class="inline-flex items-center gap-2 text-sm font-semibold"><input type="checkbox" id="medUnver" ${f.unverified ? 'checked' : ''} class="w-4 h-4"/> ${esc(T('Faqat tekshirilmaganlar (egalar qo‘shgan)'))}</label>
          </div>
          <div class="flex gap-2">
            <button type="button" data-action="adm-med-new" class="btn btn-md btn-green"><i data-lucide="plus" class="w-4 h-4"></i>${esc(T('Dori qo‘shish'))}</button>
            <button type="button" data-action="adm-catalog-import" class="btn btn-md btn-soft"><i data-lucide="upload" class="w-4 h-4"></i>${esc(T('Katalog import'))}</button>
          </div>
        </div>
        <div id="medList" class="divide-y divide-slate-200/70"></div>
      </section>`;
    $('medSearch').addEventListener('input', debounce((e) => { f.q = e.target.value; f.offset = 0; loadMeds(); }, 300));
    $('medUnver').addEventListener('change', (e) => { f.unverified = e.target.checked; f.offset = 0; loadMeds(); });
    await loadMeds();
  }

  async function loadMeds() {
    const f = adm.meds;
    const p = new URLSearchParams({ limit: LIMIT, offset: f.offset, q: f.q });
    if (f.unverified) p.set('unverified', '1');
    const r = await api(`/api/medicines?${p}`);
    f.rows = r.medicines;
    $('medList').innerHTML = (r.medicines.length ? r.medicines.map(m => `
      <div class="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="font-bold text-slate-900 text-sm flex flex-wrap items-center gap-1.5"><span class="text-xs font-semibold text-slate-400">#${m.id}</span> ${esc(m.name)} <span class="font-normal text-slate-500">${esc(m.dosage)}</span> ${rxBadge(m.prescription)}
            ${m.verified ? '' : `<span class="chip bg-amber-50 text-amber-700">${esc(T('Tekshirilmagan'))}</span>`}</div>
          <div class="text-xs text-slate-500">${esc(m.active_ingredient)}${m.manufacturer ? ' • ' + esc(m.manufacturer) : ''} • ${esc(m.category)} • ${esc(T('Narx yozuvlari'))}: ${Number(m.offers_count)} • <a class="text-brand-blue" href="/dori/${esc(m.slug)}" target="_blank" rel="noopener">/dori/${esc(m.slug)}</a></div>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          ${m.verified ? '' : `<button type="button" data-action="adm-med-verify" data-id="${m.id}" class="btn btn-sm btn-green">${esc(T('Tasdiqlash'))}</button>`}
          <button type="button" data-action="adm-med-edit" data-id="${m.id}" class="btn btn-sm btn-soft">${esc(T('Tahrirlash'))}</button>
          <button type="button" data-action="adm-med-merge" data-id="${m.id}" class="btn btn-sm btn-warn">${esc(T('Birlashtirish'))}</button>
          <button type="button" data-action="adm-med-delete" data-id="${m.id}" class="btn btn-sm btn-danger"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
      </div>`).join('') : `<div class="py-3 text-sm text-slate-500">${esc(T('Dori topilmadi.'))}</div>`) + pager(r.total, f.offset, 'adm-med-page');
    icons();
  }

  function medFields(m = {}) {
    return [
      { name: 'name', label: T('Dori nomi'), value: m.name, required: true },
      { name: 'active_ingredient', label: T('Ta’sir etuvchi modda'), value: m.active_ingredient, required: true },
      { name: 'dosage', label: T('Doza va shakli'), value: m.dosage },
      { name: 'manufacturer', label: T('Ishlab chiqaruvchi'), value: m.manufacturer },
      { name: 'category', label: T('Kategoriya'), value: m.category },
      { name: 'prescription', type: 'checkbox', label: T('Retsept bilan beriladi'), value: m.prescription }
    ];
  }

  async function editMed(id) {
    const m = adm.meds.rows.find(x => x.id === Number(id));
    if (!m) return;
    const v = await openModal({ title: T('Dorini tahrirlash') + ` #${m.id}`, fields: [...medFields(m), { name: 'verified', type: 'checkbox', label: T('Tekshirilgan (katalogda tasdiqlangan)'), value: m.verified }] });
    if (!v) return;
    try {
      await api(`/api/admin/medicines/${m.id}`, { method: 'PUT', body: v });
      showToast(T('Dori yangilandi!'));
      loadMeds().catch(onError);
    } catch (err) {
      if (err.data && err.data.existing_id) {
        if (await confirmModal(T('Dublikat'), T('Bunday dori allaqachon bor (#{id}). Shu dorini unga birlashtiramizmi?', { id: err.data.existing_id }), { danger: false, confirmLabel: T('Birlashtirish') })) {
          return merge(m.id, err.data.existing_id);
        }
        return;
      }
      onError(err);
    }
  }

  async function merge(fromId, toId) {
    if (!toId) {
      const v = await openModal({
        title: T('Dublikatni birlashtirish'),
        intro: esc(T('#{id} dorining barcha narxlari tanlangan doriga ko‘chiriladi, #{id} esa o‘chiriladi.', { id: fromId })),
        fields: [
          { name: 'q', label: T('Asosiy dorini qidiring'), placeholder: T('nomi...') },
          { type: 'html', html: '<div id="mergeList" class="max-h-56 overflow-y-auto space-y-1"></div>' },
          { name: 'to_id', label: T('yoki asosiy dori ID raqami'), type: 'number', required: true }
        ],
        submitLabel: T('Birlashtirish'), danger: true,
        onOpen: (card) => {
          const inp = card.querySelector('[name="q"]');
          inp.addEventListener('input', debounce(async () => {
            const r = await api(`/api/medicines?limit=10&q=${encodeURIComponent(inp.value)}`).catch(() => ({ medicines: [] }));
            card.querySelector('#mergeList').innerHTML = r.medicines.filter(x => x.id !== Number(fromId)).map(x => `<button type="button" data-merge-pick="${x.id}" class="w-full text-left text-sm px-3 py-2 rounded-xl bg-white/80 hover:bg-white border border-slate-200"><b>#${x.id}</b> ${esc(x.name)} ${esc(x.dosage)} <span class="muted">${esc(x.manufacturer)}</span></button>`).join('');
            card.querySelectorAll('[data-merge-pick]').forEach(b => b.addEventListener('click', () => { card.querySelector('[name="to_id"]').value = b.dataset.mergePick; }));
          }, 250));
        }
      });
      if (!v) return;
      toId = v.to_id;
    }
    try {
      const r = await api('/api/admin/medicines/merge', { method: 'POST', body: { from_id: Number(fromId), to_id: Number(toId) } });
      showToast(T('Birlashtirildi ({n} ta narx ko‘chirildi)', { n: r.moved_offers }));
      loadMeds().catch(onError);
    } catch (err) { onError(err); }
  }

  // =========================================================================
  // ESKIRGAN NARXLAR
  // =========================================================================
  async function stale(body) {
    const r = await api(`/api/admin/stale?days=${adm.staleDays}`);
    body.innerHTML = `
      <section class="card">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-2 text-sm">${esc(T('Narxi'))} <input id="staleDays" type="number" min="1" max="365" value="${r.days}" class="input w-20 py-1.5"/> ${esc(T('kundan beri yangilanmagan dorixonalar'))}: <b>${r.pharmacies.length}</b></div>
          <button type="button" data-action="adm-remind" class="btn btn-md btn-blue" ${r.pharmacies.length ? '' : 'disabled'}><i data-lucide="send" class="w-4 h-4"></i>${esc(T('Hammasiga Telegram eslatma'))}</button>
        </div>
        <p class="muted mb-3">${esc(T('Eslatmalar har kuni soat 10:00–19:00 oralig‘ida avtomatik ham yuboriladi (bir egaga {n} kunda bir marta).', { n: 3 }))}</p>
        <div class="divide-y divide-slate-200/70">
          ${r.pharmacies.length ? r.pharmacies.map(x => `
            <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div class="font-bold text-sm text-slate-900">${esc(x.name)} <span class="font-normal text-slate-500">(${esc(x.city)})</span></div>
                <div class="text-xs text-slate-500">${esc(x.owner_name)} • <a class="text-brand-blue" href="tel:${esc(String(x.owner_phone).replace(/[^\d+]/g, ''))}">${esc(x.owner_phone)}</a> • ${x.owner_telegram ? '<span class="text-brand-blue">Telegram ✓</span>' : `<span class="text-amber-600">${esc(T('Telegram ulanmagan'))}</span>`}</div>
                <div class="text-xs ${x.stale_days === null ? 'text-slate-500' : 'text-amber-600 font-semibold'}">${x.stale_days === null ? esc(T('Narxlar kiritilmagan')) : esc(T('{n} kun oldin yangilangan', { n: x.stale_days }))} • ${esc(T('Narxlar'))}: ${x.inventory_count}${x.last_reminded_at ? ' • ' + esc(T('Oxirgi eslatma')) + ': ' + fmtDate(x.last_reminded_at) : ''}</div>
              </div>
              <button type="button" data-action="adm-remind" data-id="${x.id}" class="btn btn-sm btn-soft" ${x.owner_telegram ? '' : 'disabled'}><i data-lucide="send" class="w-3.5 h-3.5"></i>${esc(T('Eslatma'))}</button>
            </div>`).join('') : `<div class="py-3 text-sm text-slate-500">${esc(T('Hamma dorixonalarning narxlari yangi. 👍'))}</div>`}
        </div>
      </section>`;
    $('staleDays').addEventListener('change', (e) => { adm.staleDays = Number(e.target.value) || 7; stale(body).catch(onError).finally(icons); });
    icons();
  }

  // =========================================================================
  // XABARLAR
  // =========================================================================
  async function reports(body) {
    const r = await api(`/api/admin/reports?status=${adm.reportStatus}`);
    const R = D.REASONS();
    body.innerHTML = `
      <div class="flex gap-1.5 mb-3">${[['open', T('Ochiq')], ['resolved', T('Tuzatilgan')], ['dismissed', T('Rad etilgan')]].map(([k, l]) => `<button type="button" data-action="adm-report-filter" data-status="${k}" class="px-3 py-1.5 rounded-xl text-xs font-semibold border ${adm.reportStatus === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white/80 border-slate-200'}">${esc(l)}</button>`).join('')}</div>
      <div class="space-y-3">
        ${r.reports.length ? r.reports.map(x => `
          <div class="glass rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div class="font-bold text-slate-900">${esc(x.name)} <span class="font-normal text-slate-500">${esc(x.dosage)}</span> — ${esc(x.pharmacy_name)} <span class="font-normal text-slate-500">(${esc(x.city)})</span></div>
              <div class="text-sm"><span class="chip bg-amber-50 text-amber-700">${esc(R[x.reason] || x.reason)}</span>
                ${x.current_price !== null ? ` ${esc(T('Hozirgi'))}: <b>${price(x.current_price)}</b>` : ''}${x.reported_price ? ` • ${esc(T('Foydalanuvchi'))}: <b>${price(x.reported_price)}</b>` : ''}</div>
              ${x.comment ? `<div class="text-xs text-slate-600 mt-1">“${esc(x.comment)}”</div>` : ''}
              <div class="muted mt-1">${fmtDate(x.created_at)}</div>
            </div>
            ${x.status === 'open' ? `<div class="flex gap-1.5">
              <button type="button" data-action="report-resolve" data-id="${x.id}" data-status="resolved" class="btn btn-sm btn-green">${esc(T('Tuzatildi'))}</button>
              <button type="button" data-action="report-resolve" data-id="${x.id}" data-status="dismissed" class="btn btn-sm btn-ghost">${esc(T('Noto‘g‘ri xabar'))}</button></div>` : ''}
          </div>`).join('') : `<div class="glass rounded-3xl p-8 text-center text-sm text-slate-600">${esc(T('Xabarlar yo‘q.'))}</div>`}
      </div>`;
  }

  // =========================================================================
  // QIDIRUV STATISTIKASI
  // =========================================================================
  async function searchStats(body) {
    const r = await api('/api/admin/search-stats?days=30');
    const table = (rows, col) => rows.length ? `<table class="w-full text-sm"><tbody>${rows.map(x => `<tr class="border-t border-slate-200/70"><td class="py-1.5">${esc(x.term)}</td><td class="py-1.5 text-right font-semibold">${x[col]}</td></tr>`).join('')}</tbody></table>` : `<div class="muted">${esc(T('Hozircha ma’lumot yo‘q.'))}</div>`;
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">${esc(T('Oxirgi 30 kun: {s} ta qidiruv, shundan {z} tasida mavjud dori topilmadi.', { s: r.totals.searches, z: r.totals.zero_results }))}</p>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section class="card"><h3 class="font-bold text-slate-900 mb-2">${esc(T('Eng ko‘p qidirilgan'))}</h3>${table(r.top, 'searches')}</section>
        <section class="card"><h3 class="font-bold text-slate-900 mb-1">${esc(T('Topilmaganlar'))}</h3><p class="muted mb-2">${esc(T('Bu so‘zlar katalogga nima qo‘shish yoki qaysi dorixonalarni jalb qilish kerakligini ko‘rsatadi.'))}</p>${table(r.not_found, 'zero_results')}</section>
      </div>`;
  }

  // =========================================================================
  // AUDIT
  // =========================================================================
  const ACTION_LABELS = () => ({
    price_create: T('Narx qo‘shildi'), price_update: T('Narx o‘zgardi'), price_delete: T('Narx o‘chirildi'), price_confirm: T('Narxlar tasdiqlandi'),
    bulk_price: T('Ommaviy narx o‘zgarishi'), csv_import: T('CSV import'), update: T('Tahrirlandi'), create: T('Yaratildi'), delete: T('O‘chirildi'),
    role_change: T('Rol o‘zgardi'), block: T('Bloklandi'), unblock: T('Blokdan chiqarildi'), approve: T('Tasdiqlandi'), reject: T('Rad etildi'),
    verify: T('Tasdiqlandi'), unverify: T('Tasdiq olindi'), owner_change: T('Ega o‘zgardi'), merge: T('Birlashtirildi'), register: T('Ro‘yxatdan o‘tdi'),
    password_change: T('Parol o‘zgardi'), password_reset: T('Parol tiklandi'), password_reset_admin: T('Admin parolni tikladi'), '2fa_enable': T('2FA yoqildi'),
    '2fa_disable': T('2FA o‘chirildi'), '2fa_reset_admin': T('Admin 2FA ni o‘chirdi'), stale_remind: T('Eslatma yuborildi'), logo: T('Logotip'),
    catalog_import: T('Katalog import'), report_resolved: T('Xabar yopildi'), report_dismissed: T('Xabar rad etildi')
  });

  function auditDetails(e) {
    const d = e.details || {};
    if (d.from && d.to && d.to.price !== undefined) {
      return `${d.from ? price(d.from.price) + ' → ' : ''}<b>${price(d.to.price)}</b>${d.from && d.from.status !== d.to.status ? ` (${esc(d.from.status)} → ${esc(d.to.status)})` : ''}${d.pharmacy_id ? ` • ${esc(T('dorixona'))} #${d.pharmacy_id}` : ''}${d.medicine_id ? ` • ${esc(T('dori'))} #${d.medicine_id}` : ''}`;
    }
    const s = JSON.stringify(d);
    return s === '{}' ? '' : `<code class="text-[11px] break-all">${esc(s.slice(0, 300))}</code>`;
  }

  async function audit(body) {
    const a = adm.audit;
    const p = new URLSearchParams({ limit: LIMIT, offset: a.offset });
    if (a.entity) p.set('entity', a.entity);
    if (a.pharmacy_id) p.set('pharmacy_id', a.pharmacy_id);
    const r = await api(`/api/admin/audit?${p}`);
    const L = ACTION_LABELS();
    body.innerHTML = `
      <section class="card">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <select id="auditEntity" class="input max-w-[220px] py-2 font-semibold">
            ${[['', T('Hammasi')], ['inventory', T('Narxlar')], ['pharmacy', T('Dorixonalar')], ['medicine', T('Dorilar')], ['user', T('Foydalanuvchilar')], ['pharmacy_request', T('Arizalar')], ['reservation', T('Bronlar')]].map(([k, l]) => `<option value="${k}" ${a.entity === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
          ${a.pharmacy_id ? `<span class="chip bg-sky-50 text-brand-blue">${esc(T('dorixona'))} #${a.pharmacy_id} <button type="button" data-action="adm-audit-clear" aria-label="x">✕</button></span>` : ''}
        </div>
        <div class="divide-y divide-slate-200/70 text-sm">
          ${r.entries.length ? r.entries.map(e => `
            <div class="py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-1">
              <div class="min-w-0">
                <span class="font-semibold">${esc(L[e.action] || e.action)}</span> <span class="muted">${esc(e.entity)}${e.entity_id ? ' #' + e.entity_id : ''}</span>
                <div class="text-xs text-slate-600">${auditDetails(e)}</div>
              </div>
              <div class="text-xs text-slate-500 sm:text-right shrink-0">${esc(e.user_name || T('tizim'))}${e.user_phone ? ' • ' + esc(e.user_phone) : ''}<br>${fmtDate(e.created_at)}</div>
            </div>`).join('') : `<div class="py-3 text-slate-500">${esc(T('Yozuvlar yo‘q.'))}</div>`}
        </div>
        ${pager(r.total, a.offset, 'adm-audit-page')}
      </section>`;
    $('auditEntity').addEventListener('change', (e) => { a.entity = e.target.value; a.offset = 0; audit(body).catch(onError).finally(icons); });
    icons();
  }

  // =========================================================================
  // HODISALAR
  // =========================================================================
  const reload = () => D.switchPage('admin', { replace: true });

  Object.assign(actions, {
    'adm-tab': (b) => { adm.tab = b.dataset.tab; reload(); },
    'adm-approve': async (b) => {
      const v = await openModal({ title: T('Arizani tasdiqlash'), fields: [{ name: 'verified', type: 'checkbox', value: true, label: T('Litsenziya tekshirildi — “Tasdiqlangan” belgisi qo‘yilsin') }], submitLabel: T('Tasdiqlash') });
      if (!v) return;
      try { await api(`/api/admin/requests/${b.dataset.id}/approve`, { method: 'POST', body: v }); showToast(T('Ariza tasdiqlandi va dorixona qo‘shildi!')); reload(); } catch (err) { onError(err); }
    },
    'adm-reject': async (b) => {
      const v = await openModal({ title: T('Arizani rad etish'), fields: [{ name: 'admin_note', label: T('Sabab (foydalanuvchiga ko‘rinadi)'), type: 'textarea', rows: 2 }], submitLabel: T('Rad etish'), danger: true });
      if (!v) return;
      try { await api(`/api/admin/requests/${b.dataset.id}/reject`, { method: 'POST', body: v }); showToast(T('Ariza rad etildi'), 'info'); reload(); } catch (err) { onError(err); }
    },
    'adm-users-page': (b) => { adm.users.offset = Math.max(0, adm.users.offset + Number(b.dataset.dir) * LIMIT); loadUsers().catch(onError); },
    'adm-role': (b) => changeRole(b.dataset.id, document.querySelector(`[data-role-user-id="${b.dataset.id}"]`).value),
    'adm-block': async (b) => {
      const v = await openModal({ title: T('Foydalanuvchini bloklash'), intro: esc(T('Foydalanuvchi tizimdan chiqariladi va kira olmaydi. Faol bronlari bekor qilinadi.')), fields: [{ name: 'reason', label: T('Sabab'), type: 'textarea', rows: 2 }], submitLabel: T('Bloklash'), danger: true });
      if (!v) return;
      try { await api(`/api/admin/users/${b.dataset.id}/block`, { method: 'POST', body: v }); showToast(T('Bloklandi'), 'info'); loadUsers().catch(onError); } catch (err) { onError(err); }
    },
    'adm-unblock': async (b) => { try { await api(`/api/admin/users/${b.dataset.id}/unblock`, { method: 'POST' }); showToast(T('Blokdan chiqarildi')); loadUsers().catch(onError); } catch (err) { onError(err); } },
    'adm-delete-user': (b) => deleteUser(b.dataset.id),
    'adm-reset-pw': async (b) => {
      if (!(await confirmModal(T('Vaqtinchalik parol'), T('Foydalanuvchining joriy paroli bekor qilinadi va yangi vaqtinchalik parol yaratiladi. Uni foydalanuvchiga xavfsiz yo‘l bilan yetkazing.'), { danger: false }))) return;
      try {
        const r = await api(`/api/admin/users/${b.dataset.id}/reset-password`, { method: 'POST' });
        await infoModal(T('Vaqtinchalik parol'), `<div class="text-center text-xl font-mono font-bold bg-slate-100 rounded-xl p-3 select-all">${esc(r.temp_password)}</div><p class="mt-2 text-xs text-slate-500">${esc(T('Bu parol faqat hozir ko‘rsatiladi. Foydalanuvchi kirgach, uni o‘zgartirish so‘raladi.'))}</p>`);
      } catch (err) { onError(err); }
    },
    'adm-reset-2fa': async (b) => {
      if (!(await confirmModal(T('2FA ni o‘chirish'), T('Foydalanuvchi telefonini yo‘qotgan bo‘lsa ishlating. U keyingi kirishda 2FA ni qayta yoqishi kerak bo‘ladi.')))) return;
      try { await api(`/api/admin/users/${b.dataset.id}/reset-2fa`, { method: 'POST' }); showToast(T('2FA o‘chirildi.')); loadUsers().catch(onError); } catch (err) { onError(err); }
    },
    'adm-ph-page': (b) => { adm.ph.offset = Math.max(0, adm.ph.offset + Number(b.dataset.dir) * LIMIT); loadPharmacies().catch(onError); },
    'adm-add-ph': addPharmacy,
    'adm-verify-ph': async (b) => { try { await api(`/api/admin/pharmacies/${b.dataset.id}/verify`, { method: 'POST', body: { verified: b.dataset.v === '1' } }); loadPharmacies().catch(onError); } catch (err) { onError(err); } },
    'adm-open-ph': (b) => D.openPharmacyCabinet(b.dataset.id),
    'adm-transfer-ph': async (b) => {
      const v = await openModal({ title: T('Egasini o‘zgartirish'), intro: esc(T('Yangi ega avtomatik “Dorixona egasi” roliga o‘tadi.')), fields: [{ name: 'owner_phone', label: T('Yangi ega telefoni'), type: 'tel', required: true, placeholder: '+998...' }] });
      if (!v) return;
      try { await api(`/api/admin/pharmacies/${b.dataset.id}/owner`, { method: 'POST', body: v }); showToast(T('Dorixona yangi egaga biriktirildi!')); loadPharmacies().catch(onError); } catch (err) { onError(err); }
    },
    'adm-audit-ph': (b) => { adm.audit = { entity: '', offset: 0, pharmacy_id: Number(b.dataset.id) }; adm.tab = 'audit'; reload(); },
    'adm-audit-clear': () => { adm.audit = { entity: '', offset: 0 }; reload(); },
    'adm-audit-page': (b) => { adm.audit.offset = Math.max(0, adm.audit.offset + Number(b.dataset.dir) * LIMIT); reload(); },
    'adm-delete-ph': async (b) => {
      if (!(await confirmModal(T('Dorixonani o‘chirish'), T('Dorixona va uning barcha narx yozuvlari, bronlari o‘chiriladi. Davom etasizmi?')))) return;
      try { await api(`/api/admin/pharmacies/${b.dataset.id}`, { method: 'DELETE' }); showToast(T('Dorixona o‘chirildi'), 'info'); loadPharmacies().catch(onError); } catch (err) { onError(err); }
    },
    'adm-med-page': (b) => { adm.meds.offset = Math.max(0, adm.meds.offset + Number(b.dataset.dir) * LIMIT); loadMeds().catch(onError); },
    'adm-med-new': async () => {
      const v = await openModal({ title: T('Dori qo‘shish'), fields: medFields({}) });
      if (!v) return;
      try { await api('/api/medicines', { method: 'POST', body: { ...v, force: true } }); showToast(T('Dori qo‘shildi!')); loadMeds().catch(onError); } catch (err) { onError(err); }
    },
    'adm-med-edit': (b) => editMed(b.dataset.id),
    'adm-med-verify': async (b) => { try { await api(`/api/admin/medicines/${b.dataset.id}/verify`, { method: 'POST' }); loadMeds().catch(onError); } catch (err) { onError(err); } },
    'adm-med-merge': (b) => merge(b.dataset.id),
    'adm-med-delete': async (b) => {
      if (!(await confirmModal(T('Dorini o‘chirish'), T('Dori va unga tegishli barcha narx yozuvlari o‘chiriladi. Davom etasizmi?')))) return;
      try { await api(`/api/admin/medicines/${b.dataset.id}`, { method: 'DELETE' }); showToast(T('Dori o‘chirildi'), 'info'); loadMeds().catch(onError); } catch (err) { onError(err); }
    },
    'adm-catalog-import': async () => {
      const v = await openModal({
        title: T('Katalog import'), wide: true,
        intro: `${esc(T('Narxsiz dorilar ro‘yxati. Ustunlar:'))} <code class="text-xs">name, active_ingredient, manufacturer, dosage, category, prescription</code>. ${esc(T('Mavjud dorilar takrorlanmaydi.'))}`,
        fields: [
          { type: 'html', html: '<input type="file" id="catFile" accept=".csv,text/csv,text/plain" class="block w-full text-sm"/>' },
          { name: 'csv', type: 'textarea', rows: 8, label: T('CSV matni') }
        ],
        submitLabel: T('Import'),
        onOpen: (card) => card.querySelector('#catFile').addEventListener('change', (e) => {
          const f = e.target.files[0]; if (!f) return;
          const rd = new FileReader(); rd.onload = () => { card.querySelector('textarea').value = rd.result; }; rd.readAsText(f, 'utf-8');
        })
      });
      if (!v || !v.csv.trim()) return;
      try { const r = await api('/api/admin/medicines/import-csv', { method: 'POST', body: v }); showToast(T('Qo‘shildi: {c}, mavjud edi: {e}, o‘tkazildi: {s}', { c: r.created, e: r.existed, s: r.skipped }), 'success', 6000); loadMeds().catch(onError); } catch (err) { onError(err); }
    },
    'adm-remind': async (b) => {
      try {
        const r = await api('/api/admin/stale/remind', { method: 'POST', body: { days: adm.staleDays, pharmacy_ids: b.dataset.id ? [Number(b.dataset.id)] : undefined } });
        if (r.telegram_disabled) showToast(T('Telegram bot sozlanmagan.'), 'error');
        else showToast(T('Yuborildi: {s} ta egaga. Telegram ulanmagan: {n} ta dorixona.', { s: r.sent, n: r.no_telegram }), 'success', 6000);
        reload();
      } catch (err) { onError(err); }
    },
    'adm-report-filter': (b) => { adm.reportStatus = b.dataset.status; reload(); }
  });
})();
