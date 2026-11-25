/* DORI TOP — asosiy ilova: yadro, kirish, qidiruv, savat, sevimlilar, bronlar, profil, ariza */
(function () {
  'use strict';

  const T = window.T;
  const TOKEN_KEY = 'dori_top_jwt_token';
  const CART_KEY = 'dori_top_cart';
  const DEFAULT_CENTER = { lat: 40.7821, lng: 72.3442 };

  const state = {
    page: 'search',
    user: null,
    token: null,
    config: { telegram: { enabled: false, bot: '' }, stale_days: 7 },
    // qidiruv
    selectedMedId: null,
    city: 'all',
    rx: 'all',
    userLocation: null, // faqat foydalanuvchi ruxsat bersa
    filters: { availableOnly: false, openNow: false, is247: false, verified: false },
    priceMin: '',
    priceMax: '',
    sortBy: 'price',
    viewMode: 'list',
    lastOffers: [],
    lastMedicine: null,
    cities: []
  };

  // =========================================================================
  // YORDAMCHILAR
  // =========================================================================
  const $ = (id) => document.getElementById(id);

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function price(num) {
    if (num === null || num === undefined || num === '' || Number.isNaN(Number(num))) return '—';
    return Math.round(Number(num)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + T('so‘m');
  }

  function distance(km) {
    if (km === null || km === undefined) return '';
    if (km < 1) return Math.max(50, Math.round(km * 100) * 10) + ' ' + T('m');
    return (km < 50 ? km.toFixed(1) : Math.round(km)) + ' ' + T('km');
  }

  function hoursText(p) {
    if (p.is_247) return '24/7';
    const td = p.today || {};
    if (td.closed) return T('Bugun dam olish kuni');
    if (td.open) return `${td.open}–${td.close}`;
    return `${p.open_time}–${p.close_time}`;
  }

  function fmtDate(ts, withTime = true) {
    if (!ts) return '—';
    const d = new Date(String(ts).replace(' ', 'T') + (String(ts).includes('Z') || String(ts).includes('+') ? '' : 'Z'));
    if (Number.isNaN(d.getTime())) return esc(ts);
    return d.toLocaleString(T.lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
      timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
    });
  }

  function daysAgo(n) {
    if (n === null || n === undefined) return '';
    if (n === 0) return T('bugun');
    if (n === 1) return T('kecha');
    return T('{n} kun oldin', { n });
  }

  function roleLabel(role) {
    return { admin: T('Administrator'), pharmacy_owner: T('Dorixona egasi'), user: T('Foydalanuvchi') }[role] || T('Mehmon');
  }

  function statusMeta(status) {
    if (status === 'available') return { label: T('Mavjud'), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
    if (status === 'low') return { label: T('Kam qoldi'), cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
    return { label: T('Tugagan'), cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' };
  }

  function resStatusMeta(s) {
    return {
      pending: { label: T('Kutilmoqda'), cls: 'bg-amber-50 text-amber-700' },
      confirmed: { label: T('Tasdiqlandi'), cls: 'bg-emerald-50 text-brand-green' },
      rejected: { label: T('Rad etildi'), cls: 'bg-rose-50 text-rose-600' },
      cancelled: { label: T('Bekor qilindi'), cls: 'bg-slate-100 text-slate-600' },
      completed: { label: T('Yakunlandi'), cls: 'bg-sky-50 text-brand-blue' },
      expired: { label: T('Muddati o‘tdi'), cls: 'bg-slate-100 text-slate-500' }
    }[s] || { label: s, cls: 'bg-slate-100' };
  }

  function rxBadge(rx) {
    return rx ? `<span class="chip bg-rose-50 text-rose-700" title="${esc(T('Dorixonada faqat shifokor retsepti bilan beriladi'))}"><i data-lucide="file-text" class="w-3 h-3"></i>${esc(T('Retsept bilan'))}</span>` : '';
  }

  function verifiedBadge(v) {
    return v ? `<span class="chip bg-emerald-50 text-brand-green" title="${esc(T('Litsenziyasi administrator tomonidan tekshirilgan'))}"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i>${esc(T('Tasdiqlangan'))}</span>` : '';
  }

  function icons() { if (window.lucide) window.lucide.createIcons(); }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function showToast(msg, type = 'success', ms = 3200) {
    const c = $('toastContainer');
    const el = document.createElement('div');
    const cls = type === 'error' ? 'bg-rose-600 text-white' : type === 'info' ? 'bg-brand-blue text-white' : 'bg-slate-900 text-white';
    el.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-lg text-sm font-medium animate-fade-up ${cls}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function loading(el) {
    if (el) el.innerHTML = `<div class="p-6 text-center text-sm text-slate-500">${esc(T('Yuklanmoqda...'))}</div>`;
  }

  // ---- Saqlash (brauzer xotirasi bo'lmasa ham ishlaydi)
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  };

  function saveToken(t) {
    state.token = t;
    store.set(TOKEN_KEY, t || null);
  }

  // =========================================================================
  // API
  // =========================================================================
  async function api(path, options = {}) {
    const headers = { 'X-Lang': T.lang, ...(options.headers || {}) };
    if (options.body !== undefined && typeof options.body !== 'string') {
      options = { ...options, body: JSON.stringify(options.body) };
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(path, { ...options, headers });
    } catch (e) {
      throw new Error(T('Internet aloqasini tekshiring.'));
    }
    if (options.raw) {
      if (!res.ok) throw new Error(T('Server xatoligi yuz berdi.'));
      return res;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/2fa')) {
      saveToken(null);
      state.user = null;
      renderShell();
      switchPage('search');
      showToast(data.error || T('Sessiya tugadi. Qayta kiring.'), 'info');
      const e = new Error(data.error || T('Sessiya tugadi. Qayta kiring.'));
      e.silent = true;
      throw e;
    }
    if (!res.ok) {
      const err = new Error(data.error || T('Server xatoligi yuz berdi.'));
      err.status = res.status;
      err.code = data.code;
      err.data = data;
      if (data.code === 'auth.2fa_setup_required') {
        showToast(data.error, 'info', 7000);
        switchPage('profile');
        err.silent = true;
      }
      throw err;
    }
    return data;
  }

  function onError(err) {
    if (err && err.silent) return;
    showToast((err && err.message) || T('Xatolik yuz berdi.'), 'error', 5000);
  }

  async function downloadFile(path, filename) {
    try {
      const res = await api(path, { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) { onError(err); }
  }

  // =========================================================================
  // MODAL
  // =========================================================================
  let modalResolve = null;

  function closeModal(value = null) {
    $('modal').classList.add('hidden');
    $('modalCard').innerHTML = '';
    document.body.classList.remove('overflow-hidden');
    const r = modalResolve;
    modalResolve = null;
    if (r) r(value);
  }

  function fieldHtml(f) {
    const id = 'mf_' + f.name;
    const label = f.label ? `<label for="${id}" class="field-label">${esc(f.label)}${f.required ? ' *' : ''}</label>` : '';
    const help = f.help ? `<div class="muted mt-1">${f.helpHtml ? f.help : esc(f.help)}</div>` : '';
    const common = `id="${id}" name="${esc(f.name)}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
    if (f.type === 'html') return `<div>${f.html}</div>`;
    if (f.type === 'select') {
      return `<div>${label}<select ${common} class="input font-semibold">${f.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${help}</div>`;
    }
    if (f.type === 'textarea') return `<div>${label}<textarea ${common} rows="${f.rows || 3}" class="input">${esc(f.value ?? '')}</textarea>${help}</div>`;
    if (f.type === 'checkbox') return `<label class="flex items-start gap-2 text-sm font-medium text-slate-700"><input type="checkbox" id="${id}" name="${esc(f.name)}" class="mt-0.5 w-4 h-4" ${f.value ? 'checked' : ''}/> <span>${f.labelHtml || esc(f.label)}</span></label>`;
    if (f.type === 'radio') {
      return `<fieldset class="space-y-2">${label ? `<legend class="field-label">${esc(f.label)}</legend>` : ''}${f.options.map((o, i) => `
        <label class="flex items-start gap-2 p-3 rounded-xl border border-slate-200 bg-white/70 text-sm cursor-pointer">
          <input type="radio" name="${esc(f.name)}" value="${esc(o.value)}" ${(f.value ?? f.options[0].value) === o.value || (i === 0 && f.value === undefined) ? 'checked' : ''} class="mt-0.5"/>
          <span><span class="font-semibold">${esc(o.label)}</span>${o.help ? `<span class="block muted">${esc(o.help)}</span>` : ''}</span>
        </label>`).join('')}</fieldset>`;
    }
    return `<div>${label}<input type="${f.type || 'text'}" ${common} value="${esc(f.value ?? '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step !== undefined ? `step="${f.step}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''} class="input"/>${help}</div>`;
  }

  // Oddiy forma modal: natija — maydonlar qiymati yoki null (bekor qilinsa)
  function openModal({ title, intro = '', fields = [], submitLabel = T('Saqlash'), danger = false, cancelLabel = T('Bekor qilish'), wide = false, onOpen }) {
    if (modalResolve) closeModal(null);
    const card = $('modalCard');
    card.className = `glass-strong w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 animate-fade-up`;
    card.innerHTML = `
      <form id="modalForm" class="space-y-4" novalidate>
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-lg font-bold text-slate-900">${esc(title)}</h3>
          <button type="button" data-action="modal-close" class="text-slate-400 hover:text-slate-600 p-1" aria-label="${esc(T('Yopish'))}"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
        ${intro ? `<div class="text-sm text-slate-600">${intro}</div>` : ''}
        ${fields.map(fieldHtml).join('')}
        <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          ${cancelLabel ? `<button type="button" data-action="modal-close" class="btn btn-md btn-ghost">${esc(cancelLabel)}</button>` : ''}
          ${submitLabel ? `<button type="submit" class="btn btn-md ${danger ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'btn-green'}">${esc(submitLabel)}</button>` : ''}
        </div>
      </form>`;
    $('modal').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    icons();
    const first = card.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea');
    if (first) setTimeout(() => first.focus(), 50);
    $('modalForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      for (const f of fields) {
        if (!f.required) continue;
        const el = form.elements[f.name];
        if (el && !String(el.value || '').trim()) { el.focus(); showToast(T('Majburiy maydonlarni to‘ldiring.'), 'error'); return; }
      }
      const values = {};
      for (const f of fields) {
        if (!f.name || f.type === 'html') continue;
        const el = form.elements[f.name];
        if (!el) continue;
        if (f.type === 'checkbox') values[f.name] = el.checked;
        else if (f.type === 'radio') values[f.name] = (form.querySelector(`input[name="${f.name}"]:checked`) || {}).value;
        else values[f.name] = el.value;
      }
      // type:'html' ichidagi nomlangan maydonlar ham olinadi
      form.querySelectorAll('[name]').forEach(el => {
        if (el.name in values || el.type === 'file') return;
        values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      });
      closeModal(values);
    });
    if (onOpen) onOpen(card);
    return new Promise((resolve) => { modalResolve = resolve; });
  }

  function confirmModal(title, text, { danger = true, confirmLabel = T('Tasdiqlash') } = {}) {
    return openModal({ title, intro: esc(text), submitLabel: confirmLabel, danger }).then(v => v !== null);
  }

  function infoModal(title, html) {
    return openModal({ title, intro: html, submitLabel: '', cancelLabel: T('Yopish') });
  }

  // =========================================================================
  // XARITA
  // =========================================================================
  const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  function makeMap(el, center = DEFAULT_CENTER, zoom = 12) {
    const map = L.map(el).setView([center.lat, center.lng], zoom);
    L.tileLayer(TILE_URL, { attribution: 'Tiles &copy; Esri', maxZoom: 18 }).addTo(map);
    return map;
  }

  // Xaritadan nuqta tanlash (ariza va dorixona profili uchun)
  function mountPicker(el, latInput, lngInput) {
    const lat = parseFloat(latInput.value) || DEFAULT_CENTER.lat;
    const lng = parseFloat(lngInput.value) || DEFAULT_CENTER.lng;
    const map = makeMap(el, { lat, lng }, 14);
    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    const set = (ll) => { latInput.value = ll.lat.toFixed(6); lngInput.value = ll.lng.toFixed(6); marker.setLatLng(ll); };
    map.on('click', (e) => set(e.latlng));
    marker.on('dragend', () => set(marker.getLatLng()));
    const sync = () => {
      const a = parseFloat(latInput.value); const b = parseFloat(lngInput.value);
      if (Number.isFinite(a) && Number.isFinite(b)) { marker.setLatLng([a, b]); map.setView([a, b]); }
    };
    latInput.addEventListener('change', sync);
    lngInput.addEventListener('change', sync);
    setTimeout(() => map.invalidateSize(), 120);
    return map;
  }

  // =========================================================================
  // GRAFIKLAR (SVG, tashqi kutubxonasiz)
  // =========================================================================
  // Bitta seriyali chiziqli grafik: points = [{x: label, y: number}]
  function lineChart(points, { height = 160, color = '#059669', format = price } = {}) {
    if (!points.length) return '';
    const W = 640, H = height, padL = 8, padR = 8, padT = 14, padB = 22;
    const ys = points.map(p => p.y);
    let min = Math.min(...ys), max = Math.max(...ys);
    if (min === max) { min = min * 0.9; max = max * 1.1 || 1; }
    const span = max - min;
    min = Math.max(0, min - span * 0.15); max = max + span * 0.15;
    const x = (i) => padL + (points.length === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (points.length - 1));
    const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / (max - min));
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    const grid = [0.25, 0.5, 0.75].map(f => `<line x1="${padL}" x2="${W - padR}" y1="${padT + (H - padT - padB) * f}" y2="${padT + (H - padT - padB) * f}" stroke="#E2E8F0" stroke-width="1"/>`).join('');
    const first = points[0], last = points[points.length - 1];
    return `
      <div class="relative" data-chart='${esc(JSON.stringify(points.map((p, i) => ({ x: x(i), y: y(p.y), lx: p.x, ly: format(p.y) }))))}'>
        <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto chart-svg" preserveAspectRatio="none" role="img" aria-label="${esc(T('Narx tarixi grafigi'))}">
          ${grid}
          <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          ${points.length === 1 ? `<circle cx="${x(0)}" cy="${y(first.y)}" r="4" fill="${color}"/>` : ''}
          <line class="chart-cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>
          <circle class="chart-dot" r="4" fill="${color}" stroke="#fff" stroke-width="2" visibility="hidden"/>
          <text x="${padL}" y="${H - 6}">${esc(first.x)}</text>
          <text x="${W - padR}" y="${H - 6}" text-anchor="end">${esc(last.x)}</text>
        </svg>
        <div class="chart-tip absolute hidden px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold whitespace-nowrap"></div>
      </div>`;
  }

  // Grafikka sichqoncha/barmoq bilan qarash (crosshair + tooltip)
  function bindCharts(root) {
    root.querySelectorAll('[data-chart]').forEach(wrap => {
      const pts = JSON.parse(wrap.dataset.chart);
      const svg = wrap.querySelector('svg');
      const cross = svg.querySelector('.chart-cross');
      const dot = svg.querySelector('.chart-dot');
      const tip = wrap.querySelector('.chart-tip');
      const W = svg.viewBox.baseVal.width;
      const move = (clientX) => {
        const r = svg.getBoundingClientRect();
        const vx = (clientX - r.left) / r.width * W;
        let best = pts[0];
        for (const p of pts) if (Math.abs(p.x - vx) < Math.abs(best.x - vx)) best = p;
        cross.setAttribute('x1', best.x); cross.setAttribute('x2', best.x); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y); dot.setAttribute('visibility', 'visible');
        tip.textContent = `${best.lx}: ${best.ly}`;
        tip.classList.remove('hidden');
        const px = best.x / W * r.width;
        tip.style.left = Math.min(Math.max(px - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
        tip.style.top = '-6px';
      };
      const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.classList.add('hidden'); };
      svg.addEventListener('mousemove', (e) => move(e.clientX));
      svg.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
      svg.addEventListener('mouseleave', hide);
      svg.addEventListener('touchend', hide);
    });
  }

  // Oddiy ustunli grafik (bitta seriya); har bir ustunga title (tooltip)
  function barChart(points, { height = 140, color = '#0284C7' } = {}) {
    if (!points.length) return `<div class="muted">${esc(T('Hozircha ma’lumot yo‘q.'))}</div>`;
    const W = 640, H = height, padB = 20, padT = 8;
    const max = Math.max(1, ...points.map(p => p.y));
    const bw = (W / points.length);
    const bars = points.map((p, i) => {
      const h = (H - padB - padT) * p.y / max;
      const x = i * bw + Math.min(2, bw * 0.15);
      const w = Math.max(1, bw - Math.min(4, bw * 0.3));
      return `<g><rect x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, p.y ? 1 : 0).toFixed(1)}" rx="${Math.min(4, w / 2).toFixed(1)}" fill="${color}"/><rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" fill="transparent"><title>${esc(p.x)}: ${esc(p.y)}</title></rect></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto chart-svg" role="img" aria-label="${esc(T('Kunlik ko‘rishlar'))}">
      <line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="#CBD5E1"/>
      ${bars}
      <text x="0" y="${H - 5}">${esc(points[0].x)}</text>
      <text x="${W}" y="${H - 5}" text-anchor="end">${esc(points[points.length - 1].x)}</text>
    </svg>`;
  }

  // =========================================================================
  // SAVAT (brauzerda saqlanadi)
  // =========================================================================
  const cart = {
    items() {
      try { const v = JSON.parse(store.get(CART_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 30) : []; } catch (e) { return []; }
    },
    save(items) { store.set(CART_KEY, JSON.stringify(items.slice(0, 30))); renderNav(); },
    add(m) {
      const items = cart.items();
      const ex = items.find(i => i.id === m.id);
      if (ex) ex.qty = Math.min(99, ex.qty + 1);
      else items.push({ id: m.id, name: m.name, dosage: m.dosage || '', qty: 1 });
      cart.save(items);
    },
    remove(id) { cart.save(cart.items().filter(i => i.id !== id)); },
    setQty(id, qty) { const items = cart.items(); const it = items.find(i => i.id === id); if (it) it.qty = Math.min(99, Math.max(1, qty)); cart.save(items); },
    count() { return cart.items().length; }
  };

  // =========================================================================
  // SHELL: navigatsiya, footer, sahifalar
  // =========================================================================
  const pages = {}; // sahifa nomi -> render funksiyasi
  function registerPage(name, fn) { pages[name] = fn; }

  function navItems() {
    const role = state.user ? state.user.role : 'guest';
    const items = [
      { page: 'search', icon: 'search', label: T('Qidiruv') },
      { page: 'cart', icon: 'shopping-basket', label: T('Savat'), badge: cart.count() || '' }
    ];
    if (state.user) {
      items.push({ page: 'favorites', icon: 'heart', label: T('Sevimlilar') });
      items.push({ page: 'reservations', icon: 'calendar-check', label: T('Bronlarim') });
    }
    if (role === 'user') items.push({ page: 'apply', icon: 'file-check-2', label: T('Dorixona ochish') });
    if (role === 'pharmacy_owner' || role === 'admin') items.push({ page: 'pharmacy', icon: 'building-2', label: T('Dorixonam') });
    if (role === 'admin') items.push({ page: 'admin', icon: 'shield', label: T('Admin') });
    return items;
  }

  function renderNav() {
    const nav = $('mainNav');
    if (!nav) return;
    const items = navItems().map(it => `
      <button type="button" data-action="switch-page" data-page="${it.page}" title="${esc(it.label)}"
        class="tab relative inline-flex items-center gap-1.5 ${state.page === it.page ? 'tab-active' : ''}">
        <i data-lucide="${it.icon}" class="w-4 h-4"></i><span class="hidden lg:inline">${esc(it.label)}</span>
        ${it.badge ? `<span class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-green text-white text-[10px] font-bold flex items-center justify-center">${it.badge}</span>` : ''}
      </button>`).join('');
    const langBtn = `<button type="button" data-action="toggle-lang" class="tab font-bold" title="${T.lang === 'ru' ? 'O‘zbekcha' : 'Русский'}">${T.lang === 'ru' ? 'UZ' : 'RU'}</button>`;
    const userBtn = state.user
      ? `<button type="button" data-action="switch-page" data-page="profile" title="${esc(T('Profil'))}" class="tab inline-flex items-center gap-1.5 ${state.page === 'profile' ? 'tab-active' : ''}"><i data-lucide="user-round" class="w-4 h-4"></i></button>
         <button type="button" data-action="logout" title="${esc(T('Chiqish'))}" class="tab hover:text-rose-600"><i data-lucide="log-out" class="w-4 h-4"></i></button>`
      : `<button type="button" data-action="show-auth" class="btn btn-md btn-green whitespace-nowrap"><i data-lucide="log-in" class="w-4 h-4"></i><span>${esc(T('Kirish'))}</span></button>`;
    nav.innerHTML = items + langBtn + userBtn;
    $('userRoleLabel').textContent = state.user ? `${state.user.full_name} • ${roleLabel(state.user.role)}` : T('Mehmon');
    icons();
  }

  function renderFooter() {
    const q = T.lang === 'ru' ? '?lang=ru' : '';
    $('footer').innerHTML = `
      <p class="max-w-xl"><i data-lucide="info" class="w-3.5 h-3.5 inline -mt-0.5"></i> ${esc(T('Sayt shifokor maslahati o‘rnini bosmaydi. Narx va mavjudlikni dorixonadan aniqlashtiring.'))}</p>
      <p class="flex gap-3 flex-wrap">
        <a class="hover:underline" href="/dori${q}">${esc(T('Dorilar katalogi'))}</a>
        <a class="hover:underline" href="/maxfiylik${q}" target="_blank" rel="noopener">${esc(T('Maxfiylik siyosati'))}</a>
        <a class="hover:underline" href="/shartlar${q}" target="_blank" rel="noopener">${esc(T('Foydalanish shartlari'))}</a>
        <a class="hover:underline" href="/ogohlantirish${q}" target="_blank" rel="noopener">${esc(T('Tibbiy ogohlantirish'))}</a>
      </p>`;
  }

  function renderShell() {
    $('authGate').classList.add('hidden');
    $('appShell').classList.remove('hidden');
    document.documentElement.lang = T.lang;
    renderNav();
    renderFooter();
  }

  const PAGE_WIDTH = { search: 'max-w-5xl', cart: 'max-w-5xl', favorites: 'max-w-4xl', reservations: 'max-w-4xl', profile: 'max-w-3xl', apply: 'max-w-4xl', pharmacy: 'max-w-6xl', admin: 'max-w-6xl' };

  function canSee(page) {
    const role = state.user ? state.user.role : 'guest';
    if (['search', 'cart'].includes(page)) return true;
    if (!state.user) return false;
    if (page === 'pharmacy') return role === 'pharmacy_owner' || role === 'admin';
    if (page === 'admin') return role === 'admin';
    if (page === 'apply') return role === 'user' || role === 'pharmacy_owner';
    return Boolean(pages[page]);
  }

  function switchPage(page, { replace = false } = {}) {
    if (!pages[page]) page = 'search';
    if (!canSee(page)) {
      if (!state.user && page !== 'search') { state.afterLogin = page; showAuth('login'); return; }
      page = 'search';
    }
    state.page = page;
    const main = $('page');
    main.className = `flex-1 w-full mx-auto px-3 sm:px-6 py-6 ${PAGE_WIDTH[page] || 'max-w-5xl'}`;
    main.innerHTML = '';
    renderNav();
    const url = new URL(location.href);
    url.searchParams.delete('page');
    if (page !== 'search') { url.searchParams.set('page', page); url.searchParams.delete('dori'); }
    history[replace ? 'replaceState' : 'pushState']({ page }, '', url.pathname + url.search);
    window.scrollTo(0, 0);
    Promise.resolve(pages[page](main)).catch(onError).finally(icons);
  }

  window.addEventListener('popstate', () => {
    const p = new URL(location.href).searchParams.get('page') || 'search';
    if (p !== state.page) switchPage(p, { replace: true });
  });

  // =========================================================================
  // KIRISH / RO'YXATDAN O'TISH / PAROLNI TIKLASH / 2FA
  // =========================================================================
  let authStatus = null;

  async function showAuth(mode = 'login', extra = {}) {
    $('appShell').classList.add('hidden');
    $('authGate').classList.remove('hidden');
    if (!authStatus) {
      try { authStatus = await api('/api/auth/bootstrap-status'); } catch (e) { authStatus = {}; }
    }
    if (mode === 'login' && authStatus.bootstrapOpen && !authStatus.hasAdmin) mode = 'register';
    renderAuth(mode, extra);
  }

  function authHeader() {
    return `
      <div class="text-center mb-5">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-green to-brand-blue text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-600/20"><i data-lucide="pill" class="w-7 h-7"></i></div>
        <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">DORI <span class="text-brand-green">TOP</span></h1>
        <p class="text-sm text-slate-500 mt-1">${esc(T('Dorilarni qidirish va narxlarni taqqoslash platformasi'))}</p>
      </div>
      <div class="flex items-center justify-between mb-4">
        <button type="button" data-action="back-to-search" class="text-xs font-semibold text-brand-blue hover:underline">← ${esc(T('Qidiruvga qaytish'))}</button>
        <button type="button" data-action="toggle-lang" class="text-xs font-bold text-slate-500 hover:text-slate-800">${T.lang === 'ru' ? 'O‘zbekcha' : 'Русский'}</button>
      </div>`;
  }

  function renderAuth(mode, extra = {}) {
    const card = $('authCard');
    const tabs = (mode === 'login' || mode === 'register') ? `
      <div class="grid grid-cols-2 gap-1.5 bg-slate-200/60 p-1 rounded-2xl mb-5">
        <button type="button" data-action="auth-mode" data-mode="login" class="py-2.5 rounded-xl text-sm font-bold transition ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}">${esc(T('Kirish'))}</button>
        <button type="button" data-action="auth-mode" data-mode="register" class="py-2.5 rounded-xl text-sm font-bold transition ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}">${esc(T('Ro‘yxatdan o‘tish'))}</button>
      </div>` : '';
    const bootstrap = authStatus && authStatus.bootstrapOpen && !authStatus.hasAdmin ? `
      <div class="mb-4 p-3.5 rounded-2xl bg-sky-50/80 border border-sky-200/80 text-xs text-sky-900 leading-relaxed">
        <b>${esc(T('Birinchi ishga tushirish'))}:</b> ${esc(T('tizimda hali admin yo‘q (faqat ishlab chiqish rejimida). Birinchi ro‘yxatdan o‘tgan foydalanuvchi Administrator bo‘ladi.'))}
      </div>` : '';
    let form = '';
    const q = T.lang === 'ru' ? '?lang=ru' : '';
    if (mode === 'login') {
      form = `
        <form data-form="login" class="space-y-4">
          <div><label class="field-label" for="aPhone">${esc(T('Telefon raqami'))}</label><input id="aPhone" name="phone" type="tel" required autocomplete="tel" placeholder="+998901234567" class="input py-3" value="${esc(extra.phone || '')}"/></div>
          <div><label class="field-label" for="aPass">${esc(T('Parol'))}</label><input id="aPass" name="password" type="password" required autocomplete="current-password" placeholder="••••••••" class="input py-3"/></div>
          <button type="submit" class="btn w-full py-3.5 bg-gradient-to-r from-brand-green to-brand-blue text-white font-bold">${esc(T('Tizimga kirish'))}</button>
          <button type="button" data-action="auth-mode" data-mode="reset" class="w-full text-xs font-semibold text-slate-500 hover:text-brand-blue">${esc(T('Parolni unutdingizmi?'))}</button>
        </form>`;
    } else if (mode === 'register') {
      form = `
        <form data-form="register" class="space-y-4">
          <div><label class="field-label" for="aName">${esc(T('Ism-familiya'))}</label><input id="aName" name="full_name" required autocomplete="name" placeholder="${esc(T('Masalan: Jasur Karimov'))}" class="input py-3"/></div>
          <div><label class="field-label" for="aPhone">${esc(T('Telefon raqami'))}</label><input id="aPhone" name="phone" type="tel" required autocomplete="tel" placeholder="+998901234567" class="input py-3" value="${esc(extra.phone || '')}"/></div>
          <div><label class="field-label" for="aPass">${esc(T('Parol (kamida 8 ta belgi)'))}</label><input id="aPass" name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password" placeholder="••••••••" class="input py-3"/></div>
          <div id="setupCodeWrap" class="${extra.needSetupCode ? '' : 'hidden'}"><label class="field-label" for="aSetup">${esc(T('Administrator sozlash kodi'))}</label><input id="aSetup" name="setup_code" class="input py-3" autocomplete="off"/></div>
          <label class="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" name="accept_terms" class="mt-0.5 w-4 h-4" required/>
            <span>${T('Men <a class="text-brand-blue underline" href="/shartlar{q}" target="_blank" rel="noopener">foydalanish shartlari</a> va <a class="text-brand-blue underline" href="/maxfiylik{q}" target="_blank" rel="noopener">maxfiylik siyosati</a>ga roziman.', { q })}</span></label>
          <button type="submit" class="btn w-full py-3.5 bg-gradient-to-r from-brand-green to-brand-blue text-white font-bold">${esc(T('Ro‘yxatdan o‘tish'))}</button>
        </form>`;
    } else if (mode === 'reset') {
      const tgOn = authStatus && authStatus.telegram && authStatus.telegram.enabled;
      form = `
        <h2 class="text-lg font-bold text-slate-900 mb-2">${esc(T('Parolni tiklash'))}</h2>
        <p class="text-xs text-slate-600 mb-4">${esc(tgOn ? T('Hisobingizga Telegram ulangan bo‘lsa, tasdiqlash kodi botga yuboriladi. Telegram ulanmagan bo‘lsa, administratorga murojaat qiling.') : T('Parolni tiklash uchun administratorga murojaat qiling — u sizga vaqtinchalik parol beradi.'))}</p>
        ${tgOn ? `
        <form data-form="reset-request" class="space-y-3 ${extra.sent ? 'hidden' : ''}">
          <div><label class="field-label" for="rPhone">${esc(T('Telefon raqami'))}</label><input id="rPhone" name="phone" type="tel" required placeholder="+998901234567" class="input py-3" value="${esc(extra.phone || '')}"/></div>
          <button type="submit" class="btn btn-md btn-blue w-full">${esc(T('Kod yuborish'))}</button>
        </form>
        <form data-form="reset-confirm" class="space-y-3 ${extra.sent ? '' : 'hidden'}">
          <input type="hidden" name="phone" value="${esc(extra.phone || '')}"/>
          <p class="text-xs text-emerald-700 bg-emerald-50 rounded-xl p-3">${esc(T('Agar raqam ro‘yxatdan o‘tgan va Telegram ulangan bo‘lsa, kod botga yuborildi.'))}</p>
          <div><label class="field-label" for="rCode">${esc(T('Telegram’dagi 6 xonali kod'))}</label><input id="rCode" name="code" inputmode="numeric" maxlength="6" required class="input py-3 tracking-widest text-center text-lg font-bold" autocomplete="one-time-code"/></div>
          <div><label class="field-label" for="rPass">${esc(T('Yangi parol (kamida 8 ta belgi)'))}</label><input id="rPass" name="password" type="password" minlength="8" maxlength="72" required autocomplete="new-password" class="input py-3"/></div>
          <button type="submit" class="btn btn-md btn-green w-full">${esc(T('Parolni yangilash'))}</button>
        </form>` : ''}
        <button type="button" data-action="auth-mode" data-mode="login" class="mt-4 w-full text-xs font-semibold text-slate-500 hover:text-brand-blue">← ${esc(T('Kirish sahifasiga qaytish'))}</button>`;
    } else if (mode === '2fa') {
      form = `
        <h2 class="text-lg font-bold text-slate-900 mb-2">${esc(T('Ikki bosqichli kirish'))}</h2>
        <p class="text-xs text-slate-600 mb-4">${esc(T('Autentifikator ilovasidagi (Google Authenticator, Authy) 6 xonali kodni kiriting.'))}</p>
        <form data-form="2fa" class="space-y-3">
          <input type="hidden" name="ticket" value="${esc(extra.ticket)}"/>
          <input name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code" class="input py-3 tracking-widest text-center text-lg font-bold"/>
          <button type="submit" class="btn btn-md btn-green w-full">${esc(T('Tasdiqlash'))}</button>
        </form>
        <button type="button" data-action="auth-mode" data-mode="login" class="mt-4 w-full text-xs font-semibold text-slate-500 hover:text-brand-blue">← ${esc(T('Kirish sahifasiga qaytish'))}</button>`;
    }
    card.innerHTML = authHeader() + bootstrap + tabs + form;
    icons();
    const first = card.querySelector('form:not(.hidden) input:not([type=hidden])');
    if (first) first.focus();
  }

  async function handleAuthForm(form) {
    const kind = form.dataset.form;
    const fd = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (kind === 'login') {
        const r = await api('/api/auth/login', { method: 'POST', body: { phone: fd.phone, password: fd.password } });
        if (r.need_2fa) return renderAuth('2fa', { ticket: r.ticket });
        return afterLogin(r);
      }
      if (kind === '2fa') {
        const r = await api('/api/auth/2fa', { method: 'POST', body: { ticket: fd.ticket, code: fd.code } });
        return afterLogin(r);
      }
      if (kind === 'register') {
        if (!form.elements.accept_terms.checked) { showToast(T('Shartlarga rozilik bering.'), 'error'); return; }
        try {
          const r = await api('/api/auth/register', { method: 'POST', body: { full_name: fd.full_name, phone: fd.phone, password: fd.password, accept_terms: true, setup_code: fd.setup_code || undefined } });
          return afterLogin(r);
        } catch (err) {
          if (err.code === 'auth.admin_setup_code') { $('setupCodeWrap').classList.remove('hidden'); $('aSetup').focus(); }
          throw err;
        }
      }
      if (kind === 'reset-request') {
        await api('/api/auth/reset/request', { method: 'POST', body: { phone: fd.phone } });
        return renderAuth('reset', { sent: true, phone: fd.phone });
      }
      if (kind === 'reset-confirm') {
        await api('/api/auth/reset/confirm', { method: 'POST', body: { phone: fd.phone, code: fd.code, password: fd.password } });
        showToast(T('Parol yangilandi. Endi kiring.'));
        return renderAuth('login', { phone: fd.phone });
      }
    } catch (err) { onError(err); } finally { btn.disabled = false; }
  }

  async function afterLogin(r) {
    saveToken(r.token);
    state.user = r.user;
    if (r.user.lang && r.user.lang !== T.lang) setLang(r.user.lang, { persistRemote: false });
    showToast(T('Xush kelibsiz, {name}!', { name: r.user.full_name }));
    renderShell();
    const target = state.afterLogin || (r.user.role === 'admin' ? 'admin' : r.user.role === 'pharmacy_owner' ? 'pharmacy' : 'search');
    state.afterLogin = null;
    switchPage(target);
    if (r.user.must_change_password) forcePasswordChange();
  }

  async function forcePasswordChange() {
    const v = await openModal({
      title: T('Parolni o‘zgartiring'),
      intro: esc(T('Siz vaqtinchalik parol bilan kirdingiz. Xavfsizlik uchun yangi parol o‘rnating.')),
      fields: [
        { name: 'current_password', label: T('Vaqtinchalik parol'), type: 'password', required: true, autocomplete: 'current-password' },
        { name: 'new_password', label: T('Yangi parol (kamida 8 ta belgi)'), type: 'password', required: true, autocomplete: 'new-password' }
      ],
      cancelLabel: T('Keyinroq')
    });
    if (!v) return;
    try {
      const r = await api('/api/auth/me/password', { method: 'POST', body: v });
      saveToken(r.token);
      state.user = r.user;
      showToast(T('Parol yangilandi.'));
    } catch (err) { onError(err); forcePasswordChange(); }
  }

  function logout() {
    saveToken(null);
    state.user = null;
    renderShell();
    switchPage('search');
    showToast(T('Tizimdan chiqdingiz'), 'info');
  }

  function setLang(lang, { persistRemote = true } = {}) {
    T.setLang(lang);
    if (persistRemote && state.user) api('/api/auth/me', { method: 'PATCH', body: { lang } }).catch(() => {});
    if (!$('authGate').classList.contains('hidden')) {
      const mode = $('authCard').querySelector('[data-form="register"]') ? 'register' : 'login';
      renderAuth(mode);
      return;
    }
    renderShell();
    switchPage(state.page, { replace: true });
  }

  // =========================================================================
  // QIDIRUV SAHIFASI
  // =========================================================================
  registerPage('search', async (main) => {
    main.innerHTML = `
      <div class="text-center max-w-2xl mx-auto mb-6">
        <div id="liveStatsBadge" class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full glass text-brand-green text-xs font-semibold mb-3"><i data-lucide="database" class="w-3.5 h-3.5"></i><span>${esc(T('Yuklanmoqda...'))}</span></div>
        <h1 class="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">${esc(T('Kerakli dorini eng arzon va yaqin dorixonadan toping'))}</h1>
      </div>
      <div class="glass-strong rounded-3xl p-4 sm:p-5 mb-6 relative z-20">
        <div class="flex flex-col md:flex-row gap-2.5">
          <div class="relative flex-1">
            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400"><i data-lucide="search" class="w-5 h-5"></i></div>
            <input type="search" id="searchInput" autocomplete="off" aria-label="${esc(T('Dori qidirish'))}" placeholder="${esc(T('Dori nomi yoki ta’sir etuvchi modda (lotin yoki kirill)...'))}" class="w-full pl-11 pr-4 py-3.5 text-base font-medium rounded-2xl glass-input"/>
            <div id="autocompleteList" class="hidden absolute left-0 right-0 top-full mt-2 glass-strong rounded-2xl overflow-hidden z-30 max-h-96 overflow-y-auto" role="listbox"></div>
          </div>
          <div class="flex gap-2">
            <select id="citySelect" aria-label="${esc(T('Shahar'))}" class="flex-1 md:w-44 px-3 py-3.5 rounded-2xl glass-input text-sm font-semibold text-slate-800"><option value="all">${esc(T('Barcha shaharlar'))}</option></select>
            <select id="rxSelect" aria-label="${esc(T('Retsept'))}" class="md:w-40 px-3 py-3.5 rounded-2xl glass-input text-sm font-semibold text-slate-800">
              <option value="all">${esc(T('Barcha dorilar'))}</option>
              <option value="otc" ${state.rx === 'otc' ? 'selected' : ''}>${esc(T('Retseptsiz'))}</option>
              <option value="rx" ${state.rx === 'rx' ? 'selected' : ''}>${esc(T('Retsept bilan'))}</option>
            </select>
            <button type="button" data-action="find-nearby" title="${esc(T('Yaqinimdagi'))}" class="btn px-4 py-3.5 rounded-2xl btn-green shrink-0"><i data-lucide="navigation" class="w-4 h-4"></i><span class="hidden sm:inline">${esc(T('Yaqinimdagi'))}</span></button>
          </div>
        </div>
        <div id="popularChipsWrap" class="hidden mt-3.5 flex flex-wrap items-center gap-2">
          <span class="text-xs font-semibold text-slate-500">${esc(T('Ko‘p qidiriladi:'))}</span>
          <div id="popularChips" class="flex flex-wrap items-center gap-1.5"></div>
        </div>
      </div>
      <div id="medicinePassport" class="mb-5"></div>
      <div id="controlsBar" class="hidden glass rounded-2xl p-3.5 mb-5"></div>
      <div id="resultSummaryBar" class="mb-3 text-sm text-slate-600"></div>
      <div id="listViewContainer" class="space-y-3.5"></div>
      <div id="mapViewContainer" class="hidden glass rounded-3xl overflow-hidden"><div id="pharmacyMap" class="w-full h-[500px] z-10"></div></div>
      <div id="analogsSection" class="mt-7"></div>`;
    searchMap = null;

    const input = $('searchInput');
    const ac = debounce((q) => loadAutocomplete(q, false), 180);
    const acFinal = debounce((q) => { if (q.trim().length >= 2) loadAutocomplete(q, true, true); }, 1500);
    input.addEventListener('input', (e) => { ac(e.target.value); acFinal(e.target.value); });
    input.addEventListener('focus', () => loadAutocomplete(input.value, false));
    input.addEventListener('keydown', (e) => {
      const list = $('autocompleteList');
      const opts = [...list.querySelectorAll('[data-action="select-med"]')];
      const idx = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); opts[0].focus(); }
      if (e.key === 'Enter') { e.preventDefault(); if (input.value.trim().length >= 2) loadAutocomplete(input.value, true); }
      if (e.key === 'Escape') list.classList.add('hidden');
      void idx;
    });
    $('autocompleteList').addEventListener('keydown', (e) => {
      const opts = [...$('autocompleteList').querySelectorAll('[data-action="select-med"]')];
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i < opts.length - 1) { e.preventDefault(); opts[i + 1].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? opts[i - 1] : input).focus(); }
      if (e.key === 'Escape') { $('autocompleteList').classList.add('hidden'); input.focus(); }
    });
    $('citySelect').addEventListener('change', (e) => { state.city = e.target.value; loadOffers(); });
    $('rxSelect').addEventListener('change', (e) => { state.rx = e.target.value; if (input.value) loadAutocomplete(input.value, false); });

    await loadSearchOverview();
  });

  let searchMap = null, searchMarkers = null, markerByPharmacy = {};

  async function loadSearchOverview() {
    const [health, citiesRes, popRes] = await Promise.all([api('/api/health'), api('/api/cities'), api('/api/medicines/popular')]);
    const { pharmacies, medicines, inventory } = health.counts;
    $('liveStatsBadge').innerHTML = `<i data-lucide="database" class="w-3.5 h-3.5"></i><span>${esc(T('{p} dorixona • {m} dori • {i} narx', { p: pharmacies, m: medicines, i: inventory }))}</span>`;
    state.cities = citiesRes.cities;
    const sel = $('citySelect');
    sel.innerHTML = `<option value="all">${esc(T('Barcha shaharlar'))}</option>` + citiesRes.cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (citiesRes.cities.includes(state.city)) sel.value = state.city; else state.city = 'all';

    const wrap = $('popularChipsWrap');
    if (popRes.medicines.length) {
      wrap.classList.remove('hidden');
      $('popularChips').innerHTML = popRes.medicines.map(m => `
        <button type="button" data-action="select-med" data-med-id="${m.id}" class="px-3 py-1.5 rounded-full text-xs font-semibold border transition ${state.selectedMedId === m.id ? 'bg-brand-green text-white border-brand-green' : 'bg-white/80 text-slate-700 border-slate-200 hover:border-brand-blue'}">${esc(m.name)}${m.dosage ? ' <span class="opacity-70">' + esc(m.dosage) + '</span>' : ''}</button>`).join('');
    } else {
      wrap.classList.add('hidden');
    }

    // Havola orqali kelgan dori: /?dori=slug
    const slug = new URL(location.href).searchParams.get('dori');
    if (slug && !state.selectedMedId) {
      try {
        const r = await api(`/api/medicines/by-slug/${encodeURIComponent(slug)}`);
        state.selectedMedId = r.medicine.id;
      } catch (e) { /* topilmadi */ }
    }
    if (!state.selectedMedId && popRes.medicines.length) state.selectedMedId = popRes.medicines[0].id;
    if (state.selectedMedId) await loadOffers();
    else renderEmptySearch(medicines);
    icons();
  }

  function renderEmptySearch(medCount) {
    const role = state.user ? state.user.role : 'guest';
    const cta = role === 'admin'
      ? `<button type="button" data-action="switch-page" data-page="admin" class="btn btn-md btn-blue">${esc(T('Admin panelga o‘tish'))}</button>`
      : role === 'pharmacy_owner'
        ? `<button type="button" data-action="switch-page" data-page="pharmacy" class="btn btn-md btn-green">${esc(T('Dorixonamga dori qo‘shish'))}</button>`
        : role === 'user'
          ? `<button type="button" data-action="switch-page" data-page="apply" class="btn btn-md btn-blue">${esc(T('Dorixona ochishga ariza berish'))}</button>`
          : `<button type="button" data-action="show-auth" class="btn btn-md btn-blue">${esc(T('Dorixona egasi sifatida kirish'))}</button>`;
    $('listViewContainer').innerHTML = `
      <div class="glass-strong rounded-3xl p-10 text-center">
        <div class="w-14 h-14 rounded-2xl bg-sky-50 text-brand-blue flex items-center justify-center mx-auto mb-3"><i data-lucide="database" class="w-7 h-7"></i></div>
        <h3 class="text-xl font-extrabold text-slate-900 mb-2">${esc(medCount ? T('Narxlar hali kiritilmagan') : T('Hozircha dorilar bazasi bo‘sh'))}</h3>
        <p class="text-sm text-slate-600 max-w-md mx-auto mb-5">${esc(T('Dorixonalar narxlarni kiritgach, bu yerda qidiruv natijalari ko‘rinadi. Yuqoridagi qidiruv orqali katalogdagi dorini tanlashingiz mumkin.'))}</p>
        ${cta}
      </div>`;
    icons();
  }

  async function loadAutocomplete(q, final, silent = false) {
    const list = $('autocompleteList');
    if (!list) return;
    try {
      const params = new URLSearchParams({ q, city: state.city, rx: state.rx });
      if (final) params.set('final', '1');
      const data = await api(`/api/medicines/autocomplete?${params}`);
      if (silent || document.activeElement !== $('searchInput') && !final) return;
      if (!q.trim() && !data.medicines.length) { list.classList.add('hidden'); return; }
      list.innerHTML = data.medicines.length ? data.medicines.map(m => `
        <button type="button" role="option" data-action="select-med" data-med-id="${m.id}" class="w-full px-4 py-3 text-left hover:bg-white/90 focus:bg-white focus:outline-none flex items-center justify-between gap-3 border-b border-slate-200/60 last:border-0">
          <span class="min-w-0">
            <span class="block font-bold text-slate-900 text-sm truncate">${esc(m.name)} ${m.dosage ? `<span class="font-normal text-slate-500">${esc(m.dosage)}</span>` : ''}</span>
            <span class="block text-xs text-slate-500 truncate">${esc(m.active_ingredient)}${m.prescription ? ' • <span class="text-rose-600 font-semibold">' + esc(T('Retsept bilan')) + '</span>' : ''}</span>
          </span>
          <span class="text-right shrink-0">
            <span class="block text-sm font-bold ${m.min_price ? 'text-brand-green' : 'text-slate-400'}">${m.min_price ? esc(T('{p} dan', { p: price(m.min_price) })) : esc(T('Mavjud emas'))}</span>
            <span class="block text-[11px] text-slate-400">${esc(T('{n} dorixonada', { n: m.available_count }))}</span>
          </span>
        </button>`).join('')
        : `<div class="p-4 text-center text-sm text-slate-500">${esc(T('Mos dori topilmadi. Boshqacha yozib ko‘ring (masalan, ta’sir etuvchi modda nomi).'))}</div>`;
      list.classList.remove('hidden');
    } catch (e) { /* jim */ }
  }

  function offersParams() {
    const p = new URLSearchParams({
      city: state.city,
      availableOnly: String(state.filters.availableOnly),
      openNow: String(state.filters.openNow),
      is247: String(state.filters.is247),
      verified: String(state.filters.verified),
      sort: state.sortBy
    });
    if (state.priceMin) p.set('priceMin', state.priceMin);
    if (state.priceMax) p.set('priceMax', state.priceMax);
    if (state.userLocation) { p.set('lat', state.userLocation.lat); p.set('lng', state.userLocation.lng); }
    return p;
  }

  async function loadOffers(focusPharmacyId = null) {
    if (!state.selectedMedId || state.page !== 'search') return;
    try {
      const data = await api(`/api/medicines/${state.selectedMedId}/offers?${offersParams()}`);
      state.lastOffers = data.offers;
      state.lastMedicine = data.medicine;
      state.lastUserState = data.user_state || null;
      renderOffers(data, focusPharmacyId);
      const url = new URL(location.href);
      if (data.medicine.slug && url.searchParams.get('dori') !== data.medicine.slug) {
        url.searchParams.set('dori', data.medicine.slug);
        history.replaceState(history.state, '', url.pathname + url.search);
      }
      document.title = `${data.medicine.name} — DORI TOP`;
      loadPriceHistory(data.medicine.id);
    } catch (err) { onError(err); }
  }

  function renderControls() {
    const f = state.filters;
    const chip = (key, label) => `<button type="button" data-action="toggle-filter" data-filter="${key}" class="px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition ${f[key] ? 'bg-brand-green text-white border-brand-green' : 'bg-white/80 text-slate-700 border-slate-200 hover:bg-white'}">${esc(label)}</button>`;
    const seg = (act, key, val, label, cur) => `<button type="button" data-action="${act}" data-${key}="${val}" class="px-3 py-1.5 rounded-lg text-xs ${cur === val ? 'font-bold bg-white text-brand-green shadow-sm' : 'font-semibold text-slate-600'}">${esc(label)}</button>`;
    $('controlsBar').innerHTML = `
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          ${chip('availableOnly', T('Faqat mavjudlar'))}
          ${chip('openNow', T('Hozir ochiq'))}
          ${chip('is247', '24/7')}
          ${chip('verified', T('Tasdiqlangan'))}
          <span class="inline-flex items-center gap-1">
            <input type="number" id="priceMin" min="0" step="100" inputmode="numeric" placeholder="${esc(T('narx dan'))}" value="${esc(state.priceMin)}" class="w-24 px-2.5 py-2 rounded-xl glass-input text-xs font-semibold"/>
            <span class="text-slate-400">–</span>
            <input type="number" id="priceMax" min="0" step="100" inputmode="numeric" placeholder="${esc(T('gacha'))}" value="${esc(state.priceMax)}" class="w-24 px-2.5 py-2 rounded-xl glass-input text-xs font-semibold"/>
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-1 bg-slate-200/60 p-1 rounded-xl">${seg('set-sort', 'sort', 'price', T('Eng arzon'), state.sortBy)}${seg('set-sort', 'sort', 'distance', T('Eng yaqin'), state.sortBy)}</div>
          <div class="flex items-center gap-1 bg-slate-200/60 p-1 rounded-xl">${seg('set-view', 'view', 'list', T('Ro‘yxat'), state.viewMode)}${seg('set-view', 'view', 'map', T('Xarita'), state.viewMode)}</div>
        </div>
      </div>`;
    const onPrice = debounce(() => { state.priceMin = $('priceMin').value; state.priceMax = $('priceMax').value; loadOffers(); }, 600);
    $('priceMin').addEventListener('input', onPrice);
    $('priceMax').addEventListener('input', onPrice);
  }

  function renderOffers(data, focusPharmacyId = null) {
    const { medicine: med, stats, offers, analogs, user_state: us } = data;
    $('controlsBar').classList.remove('hidden');
    renderControls();
    const fav = us && us.favorite;
    const watchA = us && us.watches.includes('available');
    const watchP = us && us.watches.includes('price');
    const tgOn = state.config.telegram.enabled;

    $('medicinePassport').innerHTML = `
      <div class="glass-strong rounded-3xl p-5 sm:p-6">
        <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="chip bg-sky-50 text-brand-blue">${esc(med.category)}</span>
              ${rxBadge(med.prescription)}
            </div>
            <h2 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1.5">${esc(med.name)} ${med.dosage ? `<span class="text-lg font-bold text-slate-500">${esc(med.dosage)}</span>` : ''}</h2>
            <div class="mt-1.5 text-sm text-slate-600"><strong>${esc(T('Ta’sir etuvchi modda'))}:</strong> ${esc(med.active_ingredient)}${med.manufacturer ? ' • ' + esc(med.manufacturer) : ''}</div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" data-action="toggle-fav" class="btn btn-sm ${fav ? 'bg-rose-50 text-rose-600' : 'btn-ghost'}"><i data-lucide="heart" class="w-3.5 h-3.5 ${fav ? 'fill-current' : ''}"></i>${esc(fav ? T('Sevimlilarda') : T('Sevimlilarga'))}</button>
              <button type="button" data-action="cart-add" data-med-id="${med.id}" class="btn btn-sm btn-ghost"><i data-lucide="shopping-basket" class="w-3.5 h-3.5"></i>${esc(T('Savatga'))}</button>
              ${tgOn ? `<button type="button" data-action="toggle-watch" data-kind="${stats.available_offers ? 'price' : 'available'}" class="btn btn-sm ${(stats.available_offers ? watchP : watchA) ? 'btn-soft' : 'btn-ghost'}"><i data-lucide="${stats.available_offers ? 'trending-down' : 'bell'}" class="w-3.5 h-3.5"></i>${esc(stats.available_offers ? ((watchP) ? T('Narx kuzatilmoqda') : T('Narx tushsa xabar ber')) : (watchA ? T('Kuzatilmoqda') : T('Kelganda xabar ber')))}</button>` : ''}
              <button type="button" data-action="share-med" class="btn btn-sm btn-ghost"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>${esc(T('Ulashish'))}</button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3 shrink-0 md:min-w-[280px]">
            <div class="bg-emerald-50/80 border border-emerald-200/80 rounded-2xl p-3">
              <div class="text-[11px] font-semibold text-emerald-700 uppercase">${esc(T('Eng arzon'))}</div>
              <div class="text-lg font-extrabold text-brand-green mt-0.5">${stats.min_price ? price(stats.min_price) : esc(T('Mavjud emas'))}</div>
            </div>
            <div class="bg-white/80 border border-slate-200/80 rounded-2xl p-3">
              <div class="text-[11px] font-semibold text-slate-500 uppercase">${esc(T('O‘rtacha'))}</div>
              <div class="text-lg font-extrabold text-slate-800 mt-0.5">${stats.avg_price ? price(stats.avg_price) : '—'}</div>
            </div>
          </div>
        </div>
        <details id="historyBox" class="mt-4 pt-3 border-t border-slate-200/70">
          <summary class="text-xs font-bold text-brand-blue cursor-pointer">${esc(T('Narx tarixi (eng arzon narx, 90 kun)'))}</summary>
          <div id="historyChart" class="mt-3"></div>
        </details>
        <p class="mt-3 text-[11px] text-amber-700"><i data-lucide="info" class="w-3 h-3 inline -mt-0.5"></i> ${esc(T('Sayt shifokor maslahati o‘rnini bosmaydi. Narx va mavjudlikni dorixonadan aniqlashtiring.'))}</p>
      </div>`;

    $('resultSummaryBar').innerHTML = esc(T('{n} ta dorixona topildi', { n: offers.length })) + (state.userLocation ? '' : ` <span class="muted">• ${esc(T('Masofani ko‘rish uchun “Yaqinimdagi” tugmasini bosing'))}</span>`);
    const inStock = offers.filter(o => o.status !== 'out');
    const cheapest = inStock.length ? Math.min(...inStock.map(o => o.price)) : null;
    const listEl = $('listViewContainer');
    const mapWrap = $('mapViewContainer');

    if (state.viewMode === 'map') {
      listEl.classList.add('hidden');
      mapWrap.classList.remove('hidden');
      renderMap(offers, cheapest, focusPharmacyId);
    } else {
      mapWrap.classList.add('hidden');
      listEl.classList.remove('hidden');
      listEl.innerHTML = offers.length ? offers.map(o => offerCard(o, cheapest, med)).join('')
        : `<div class="glass rounded-3xl p-8 text-center text-sm text-slate-600">${esc(stats.total_offers ? T('Tanlangan filtrlarga mos dorixona topilmadi.') : T('Bu dori hozircha hech bir dorixonada yo‘q.'))}${tgOn && !stats.available_offers ? `<div class="mt-3"><button type="button" data-action="toggle-watch" data-kind="available" class="btn btn-md btn-soft"><i data-lucide="bell" class="w-4 h-4"></i>${esc(T('Kelganda Telegram orqali xabar ber'))}</button></div>` : ''}</div>`;
    }

    $('analogsSection').innerHTML = analogs.length ? `
      <div class="glass rounded-3xl p-5">
        <h3 class="text-base font-extrabold text-slate-900 mb-1">${esc(T('Muqobil (analog) dorilar'))}</h3>
        <p class="muted mb-3">${esc(T('Ta’sir etuvchi moddasi bir xil. Almashtirishdan oldin shifokor bilan maslahatlashing.'))}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${analogs.map(a => `
            <button type="button" data-action="select-med" data-med-id="${a.id}" class="text-left bg-white/80 hover:bg-white rounded-2xl border border-slate-200/80 p-4 transition">
              <div class="font-bold text-slate-900">${esc(a.name)} ${a.dosage ? `<span class="font-normal text-slate-500 text-sm">${esc(a.dosage)}</span>` : ''}</div>
              <div class="text-xs text-slate-500 mt-0.5">${esc(a.manufacturer || a.active_ingredient)} ${a.prescription ? '• <span class="text-rose-600">' + esc(T('Retsept bilan')) + '</span>' : ''}</div>
              <div class="mt-2.5 flex items-center justify-between text-sm">
                <span class="font-extrabold ${a.min_price ? 'text-brand-green' : 'text-slate-400'}">${a.min_price ? esc(T('{p} dan', { p: price(a.min_price) })) : esc(T('Mavjud emas'))}</span>
                <span class="text-xs font-semibold text-brand-blue">${esc(T('{n} dorixona', { n: a.available_count }))} →</span>
              </div>
            </button>`).join('')}
        </div>
      </div>` : '';
    icons();
  }

  function offerCard(o, cheapest, med) {
    const isCheapest = cheapest !== null && o.status !== 'out' && o.price === cheapest;
    const st = statusMeta(o.status);
    const stale = Number(o.updated_days) >= (state.config.stale_days || 7);
    const phones = [o.phone, ...(o.phones || [])].filter((v, i, a) => v && a.indexOf(v) === i);
    return `
      <article class="glass rounded-3xl p-5 ${isCheapest ? 'ring-2 ring-brand-green/50' : ''} animate-fade-up">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="flex gap-3 min-w-0">
            ${o.logo_url ? `<img src="${esc(o.logo_url)}" alt="" class="w-12 h-12 rounded-xl object-cover border border-slate-200 bg-white shrink-0" loading="lazy"/>` : `<div class="w-12 h-12 rounded-xl bg-sky-50 text-brand-blue flex items-center justify-center shrink-0"><i data-lucide="building-2" class="w-5 h-5"></i></div>`}
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5 mb-1">
                ${isCheapest ? `<span class="chip bg-brand-green text-white">${esc(T('Eng arzon'))}</span>` : ''}
                <span class="chip border ${st.cls}"><span class="w-1.5 h-1.5 rounded-full ${st.dot}"></span>${st.label}</span>
                <span class="chip ${o.open_now ? 'bg-sky-50 text-brand-blue' : 'bg-slate-200/70 text-slate-600'}">${esc(hoursText(o))} • ${esc(o.open_now ? T('Ochiq') : T('Yopiq'))}</span>
                ${verifiedBadge(o.verified)}
              </div>
              <h3 class="text-lg font-bold text-slate-900">${esc(o.pharmacy_name)}</h3>
              <div class="text-sm text-slate-600 mt-0.5">${esc(o.city)}, ${esc(o.address)}${o.distance_km !== null ? ` <span class="ml-1 font-semibold text-brand-blue">${esc(distance(o.distance_km))}</span>` : ''}</div>
              <div class="text-xs mt-1 ${stale ? 'text-amber-600 font-semibold' : 'text-slate-400'}">${esc(T('Narx yangilangan: {d}', { d: daysAgo(o.updated_days) }))}${stale ? ' — ' + esc(T('dorixonadan aniqlashtiring')) : ''}</div>
              ${phones.length > 1 ? `<div class="text-xs text-slate-500 mt-0.5">${phones.map(esc).join(' • ')}</div>` : ''}
            </div>
          </div>
          <div class="flex flex-col items-stretch md:items-end gap-2.5 pt-3 md:pt-0 border-t md:border-t-0 border-slate-200/70">
            <div class="text-2xl font-extrabold ${o.status === 'out' ? 'text-slate-400 line-through' : isCheapest ? 'text-brand-green' : 'text-slate-900'}">${price(o.price)}</div>
            <div class="flex flex-wrap items-center gap-1.5 md:justify-end">
              <button type="button" data-action="open-call" data-pharmacy-id="${o.pharmacy_id}" class="btn btn-sm btn-green"><i data-lucide="phone" class="w-3.5 h-3.5"></i>${esc(T('Qo‘ng‘iroq'))}</button>
              ${o.status !== 'out' ? `<button type="button" data-action="reserve" data-pharmacy-id="${o.pharmacy_id}" class="btn btn-sm btn-blue"><i data-lucide="calendar-check" class="w-3.5 h-3.5"></i>${esc(T('Bron qilish'))}</button>` : ''}
              <button type="button" data-action="focus-on-map" data-pharmacy-id="${o.pharmacy_id}" class="btn btn-sm btn-soft">${esc(T('Xaritada'))}</button>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${Number(o.lat)},${Number(o.lng)}" target="_blank" rel="noopener noreferrer" data-route-ph="${o.pharmacy_id}" class="btn btn-sm bg-slate-100 text-slate-700">${esc(T('Yo‘nalish'))}</a>
              <button type="button" data-action="report-price" data-inv-id="${o.inventory_id}" title="${esc(T('Noto‘g‘ri narx yoki ma’lumot haqida xabar berish'))}" class="btn btn-sm text-slate-400 hover:text-amber-600"><i data-lucide="flag" class="w-3.5 h-3.5"></i></button>
            </div>
          </div>
        </div>
      </article>`;
  }

  function renderMap(offers, cheapest, focusPharmacyId) {
    if (!searchMap) {
      searchMap = makeMap('pharmacyMap', state.userLocation || DEFAULT_CENTER, 12);
      searchMarkers = L.layerGroup().addTo(searchMap);
    }
    setTimeout(() => {
      searchMap.invalidateSize();
      searchMarkers.clearLayers();
      markerByPharmacy = {};
      const bounds = [];
      offers.forEach(o => {
        const isCheapest = cheapest !== null && o.status !== 'out' && o.price === cheapest;
        const cls = o.status === 'out' ? 'price-pin-out' : isCheapest ? 'price-pin-cheapest' : o.status === 'low' ? 'price-pin-low' : 'price-pin-normal';
        const icon = L.divIcon({ className: 'leaflet-div-icon', html: `<div class="price-pin ${cls}">${price(o.price)}</div>`, iconSize: [110, 32], iconAnchor: [55, 16] });
        const m = L.marker([o.lat, o.lng], { icon }).bindPopup(`<b>${esc(o.pharmacy_name)}</b><br>${esc(o.address)}<br>${esc(hoursText(o))}<br><b style="color:#059669">${price(o.price)}</b>`);
        m.addTo(searchMarkers);
        markerByPharmacy[o.pharmacy_id] = m;
        bounds.push([o.lat, o.lng]);
      });
      if (state.userLocation) {
        L.circleMarker([state.userLocation.lat, state.userLocation.lng], { radius: 7, color: '#0284C7', fillColor: '#0284C7', fillOpacity: 0.9 }).bindTooltip(T('Siz')).addTo(searchMarkers);
      }
      if (focusPharmacyId && markerByPharmacy[focusPharmacyId]) {
        const t = offers.find(x => x.pharmacy_id === Number(focusPharmacyId));
        if (t) { searchMap.setView([t.lat, t.lng], 15); markerByPharmacy[focusPharmacyId].openPopup(); return; }
      }
      if (bounds.length === 1) searchMap.setView(bounds[0], 14);
      else if (bounds.length > 1) searchMap.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
    }, 60);
  }

  async function loadPriceHistory(medId) {
    const box = $('historyBox');
    if (!box) return;
    const render = async () => {
      try {
        const r = await api(`/api/medicines/${medId}/price-history?days=90&city=${encodeURIComponent(state.city)}`);
        const el = $('historyChart');
        if (!el) return;
        const pts = r.points.filter(p => p.min_price !== null).map(p => ({ x: p.day.slice(5).split('-').reverse().join('.'), y: p.min_price }));
        el.innerHTML = pts.length >= 2 ? lineChart(pts) : `<div class="muted">${esc(T('Grafik uchun ma’lumot yetarli emas — narxlar bir necha kun kuzatilgach paydo bo‘ladi.'))}</div>`;
        bindCharts(el);
      } catch (e) { /* jim */ }
    };
    box.addEventListener('toggle', () => { if (box.open) render(); });
  }

  function findOffer(pid) {
    return state.lastOffers.find(x => String(x.pharmacy_id) === String(pid));
  }

  function trackEvent(type, pharmacyId, medicineId) {
    fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, pharmacy_id: Number(pharmacyId), medicine_id: medicineId || 0 }), keepalive: true }).catch(() => {});
  }

  async function openCall(o) {
    trackEvent('call', o.pharmacy_id, state.selectedMedId);
    const phones = [o.phone, ...(o.phones || [])].filter((v, i, a) => v && a.indexOf(v) === i);
    await infoModal(o.pharmacy_name, `
      <div class="text-xs text-slate-500 -mt-2 mb-3">${esc(o.city)}, ${esc(o.address)} • ${esc(T('Bugun'))}: ${esc(hoursText(o))}</div>
      <div class="space-y-2">
        ${phones.map(p => `
          <div class="bg-white/80 rounded-2xl p-3.5 border border-slate-200/80 flex items-center justify-between gap-3">
            <div class="text-lg font-extrabold text-slate-900">${esc(p)}</div>
            <div class="flex gap-1.5">
              <button type="button" data-action="copy-text" data-text="${esc(p)}" class="btn btn-sm btn-ghost">${esc(T('Nusxalash'))}</button>
              <a href="tel:${esc(p.replace(/[^\d+]/g, ''))}" class="btn btn-sm btn-green"><i data-lucide="phone" class="w-3.5 h-3.5"></i>${esc(T('Qo‘ng‘iroq'))}</a>
            </div>
          </div>`).join('')}
      </div>
      ${o.schedule ? `<div class="mt-3 text-xs text-slate-600">${scheduleText(o.schedule)}</div>` : ''}`);
  }

  const DAY_NAMES = () => [T('Yakshanba'), T('Dushanba'), T('Seshanba'), T('Chorshanba'), T('Payshanba'), T('Juma'), T('Shanba')];
  function scheduleText(s) {
    const names = DAY_NAMES();
    return [1, 2, 3, 4, 5, 6, 0].map(d => `<div class="flex justify-between max-w-xs"><span>${esc(names[d])}</span><span class="font-semibold">${s[d].closed ? esc(T('Dam olish')) : esc(s[d].open + '–' + s[d].close)}</span></div>`).join('');
  }

  // ---- Bron qilish
  async function reserve(pharmacyId, items, { pharmacyName = '' } = {}) {
    if (!state.user) {
      showToast(T('Bron qilish uchun tizimga kiring.'), 'info');
      state.afterLogin = state.page;
      return showAuth('login');
    }
    const list = items.map(i => `<li>${esc(i.name)} × ${i.qty} — <b>${price(i.price * i.qty)}</b></li>`).join('');
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    const rxWarn = items.some(i => i.prescription) ? `<p class="mt-2 text-xs text-rose-700 bg-rose-50 rounded-xl p-2.5">${esc(T('Ro‘yxatda retsept bilan beriladigan dori bor — dorixonaga retseptni olib boring.'))}</p>` : '';
    const fields = [
      { name: 'customer_name', label: T('Ismingiz'), value: state.user.full_name, required: true },
      { name: 'customer_phone', label: T('Telefon'), value: state.user.phone, required: true, type: 'tel' },
      { name: 'note', label: T('Izoh (ixtiyoriy)'), type: 'textarea', rows: 2, placeholder: T('Masalan: kechqurun 18:00 da olib ketaman') }
    ];
    if (items.length === 1) fields.unshift({ name: 'qty', label: T('Miqdori (dona/qadoq)'), type: 'number', value: items[0].qty || 1, min: 1, max: 20, required: true });
    const v = await openModal({
      title: T('Bron qilish') + (pharmacyName ? ' — ' + pharmacyName : ''),
      intro: `<ul class="list-disc pl-5 space-y-0.5">${list}</ul><div class="mt-2 font-bold">${esc(T('Jami'))}: ${price(total)}</div>${rxWarn}
              <p class="mt-2 text-xs text-slate-500">${esc(T('Dorixona bronni tasdiqlagach, dori belgilangan vaqtgacha siz uchun ushlab turiladi. To‘lov dorixonada amalga oshiriladi.'))}</p>`,
      fields,
      submitLabel: T('Bron qilish')
    });
    if (!v) return;
    try {
      const body = {
        pharmacy_id: Number(pharmacyId),
        items: items.map(i => ({ medicine_id: i.medicine_id, qty: items.length === 1 ? Number(v.qty) || 1 : i.qty })),
        customer_name: v.customer_name, customer_phone: v.customer_phone, note: v.note
      };
      const r = await api('/api/reservations', { method: 'POST', body });
      await infoModal(T('Bron yuborildi'), `
        <p>${esc(T('Bron raqami'))}: <b class="text-lg">#${esc(r.reservation.code)}</b></p>
        <p class="mt-2">${esc(T('Dorixona tasdiqlashini kuting. Holatini “Bronlarim” sahifasida kuzatishingiz mumkin.'))}</p>
        ${state.user.telegram_linked ? '' : `<p class="mt-2 text-xs text-slate-500">${esc(T('Telegram ulasangiz, bron holati haqida darhol xabar olasiz (Profil sahifasi).'))}</p>`}`);
    } catch (err) { onError(err); }
  }

  async function reportPrice(invId) {
    const v = await openModal({
      title: T('Noto‘g‘ri ma’lumot haqida xabar'),
      fields: [
        { name: 'reason', type: 'radio', label: T('Nima noto‘g‘ri?'), options: [
          { value: 'wrong_price', label: T('Narx boshqacha') },
          { value: 'out_of_stock', label: T('Dori yo‘q ekan') },
          { value: 'closed', label: T('Dorixona yopiq / ish vaqti noto‘g‘ri') },
          { value: 'wrong_info', label: T('Manzil yoki telefon noto‘g‘ri') },
          { value: 'other', label: T('Boshqa') }
        ] },
        { name: 'reported_price', label: T('Haqiqiy narx (bilsangiz)'), type: 'number', min: 0, step: 100 },
        { name: 'comment', label: T('Izoh'), type: 'textarea', rows: 2 }
      ],
      submitLabel: T('Yuborish')
    });
    if (!v) return;
    try {
      await api('/api/reports', { method: 'POST', body: { inventory_id: Number(invId), reason: v.reason, reported_price: v.reported_price || undefined, comment: v.comment } });
      showToast(T('Rahmat! Xabaringiz dorixona va administratorga yuborildi.'));
    } catch (err) { onError(err); }
  }

  async function toggleWatch(kind) {
    if (!state.user) { state.afterLogin = 'search'; showToast(T('Xabar olish uchun tizimga kiring.'), 'info'); return showAuth('login'); }
    const med = state.lastMedicine;
    if (!med) return;
    try {
      const us = state.lastUserState;
      const on = Boolean(us && us.watches.includes(kind));
      if (on) await api(`/api/my/watches?medicine_id=${med.id}&kind=${kind}`, { method: 'DELETE' });
      else await api('/api/my/watches', { method: 'PUT', body: { medicine_id: med.id, kind, city: state.city } });
      showToast(on ? T('Kuzatuv o‘chirildi') : (kind === 'price' ? T('Narx tushsa Telegram orqali xabar beramiz.') : T('Dori paydo bo‘lsa Telegram orqali xabar beramiz.')));
      loadOffers();
    } catch (err) {
      if (err.code === 'watch.need_telegram') {
        const ok = await confirmModal(T('Telegram ulanmagan'), T('Xabarnomalar Telegram bot orqali yuboriladi. Hozir ulaysizmi?'), { danger: false, confirmLabel: T('Telegram’ni ulash') });
        if (ok) linkTelegram();
        return;
      }
      onError(err);
    }
  }

  async function toggleFav() {
    if (!state.user) { state.afterLogin = 'search'; showToast(T('Sevimlilarga qo‘shish uchun tizimga kiring.'), 'info'); return showAuth('login'); }
    const med = state.lastMedicine;
    const on = Boolean(state.lastUserState && state.lastUserState.favorite);
    try {
      await api(`/api/my/favorites/${med.id}`, { method: on ? 'DELETE' : 'PUT' });
      showToast(on ? T('Sevimlilardan olib tashlandi') : T('Sevimlilarga qo‘shildi'));
      loadOffers();
    } catch (err) { onError(err); }
  }

  async function shareMed() {
    const med = state.lastMedicine;
    if (!med) return;
    const url = `${location.origin}/dori/${med.slug}${T.lang === 'ru' ? '?lang=ru' : ''}`;
    try {
      if (navigator.share) await navigator.share({ title: med.name, url });
      else { await navigator.clipboard.writeText(url); showToast(T('Havola nusxalandi')); }
    } catch (e) { /* bekor qilindi */ }
  }

  // =========================================================================
  // SAVAT SAHIFASI
  // =========================================================================
  registerPage('cart', async (main) => {
    const items = cart.items();
    main.innerHTML = `
      <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-1">${esc(T('Savat'))}</h1>
      <p class="text-sm text-slate-600 mb-5">${esc(T('Bir nechta dorini qo‘shing — qaysi dorixonada hammasi borligi va umumiy narxi qancha bo‘lishini ko‘rsatamiz.'))}</p>
      <div id="cartItems" class="card mb-5"></div>
      <div id="cartResults" class="space-y-3"></div>`;
    if (!items.length) {
      $('cartItems').innerHTML = `<div class="text-center py-6 text-sm text-slate-600">${esc(T('Savat bo‘sh. Qidiruvda dori tanlab, “Savatga” tugmasini bosing.'))}<div class="mt-4"><button type="button" data-action="switch-page" data-page="search" class="btn btn-md btn-green">${esc(T('Dori qidirish'))}</button></div></div>`;
      return;
    }
    $('cartItems').innerHTML = `
      <div class="divide-y divide-slate-200/70">
        ${items.map(i => `
          <div class="py-3 flex items-center justify-between gap-3">
            <div class="min-w-0"><div class="font-bold text-slate-900 truncate">${esc(i.name)}</div><div class="muted">${esc(i.dosage)}</div></div>
            <div class="flex items-center gap-2 shrink-0">
              <input type="number" min="1" max="99" value="${i.qty}" data-cart-qty="${i.id}" aria-label="${esc(T('Miqdori'))}" class="w-16 px-2 py-1.5 rounded-xl glass-input text-sm font-bold text-center"/>
              <button type="button" data-action="cart-remove" data-med-id="${i.id}" class="btn btn-sm btn-danger" aria-label="${esc(T('O‘chirish'))}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </div>
          </div>`).join('')}
      </div>
      <div class="flex flex-wrap items-center gap-2 pt-3">
        <select id="cartCity" class="px-3 py-2 rounded-xl glass-input text-sm font-semibold"><option value="all">${esc(T('Barcha shaharlar'))}</option>${state.cities.map(c => `<option ${c === state.city ? 'selected' : ''} value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
        <button type="button" data-action="cart-compare" class="btn btn-md btn-green"><i data-lucide="scale" class="w-4 h-4"></i>${esc(T('Dorixonalarni taqqoslash'))}</button>
        <button type="button" data-action="cart-clear" class="btn btn-md btn-ghost">${esc(T('Tozalash'))}</button>
      </div>`;
    main.querySelectorAll('[data-cart-qty]').forEach(inp => inp.addEventListener('change', () => { cart.setQty(Number(inp.dataset.cartQty), parseInt(inp.value, 10) || 1); compareCart(); }));
    if (!state.cities.length) {
      try { state.cities = (await api('/api/cities')).cities; } catch (e) { /* */ }
    }
    compareCart();
  });

  async function compareCart() {
    const el = $('cartResults');
    if (!el) return;
    loading(el);
    const items = cart.items();
    const city = $('cartCity') ? $('cartCity').value : 'all';
    try {
      const r = await api('/api/cart/compare', { method: 'POST', body: { items: items.map(i => ({ medicine_id: i.id, qty: i.qty })), city, ...(state.userLocation || {}) } });
      const meds = Object.fromEntries(r.medicines.map(m => [m.id, m]));
      state.cartResult = r;
      el.innerHTML = r.pharmacies.length ? r.pharmacies.map((p, idx) => `
        <article class="glass rounded-3xl p-5 ${idx === 0 && !p.missing ? 'ring-2 ring-brand-green/50' : ''}">
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap gap-1.5 mb-1">
                ${p.missing ? `<span class="chip bg-amber-50 text-amber-700">${esc(T('{n} ta dori yo‘q', { n: p.missing }))}</span>` : `<span class="chip bg-emerald-50 text-brand-green">${esc(T('Hammasi bor'))}</span>`}
                <span class="chip ${p.open_now ? 'bg-sky-50 text-brand-blue' : 'bg-slate-200/70 text-slate-600'}">${esc(hoursText(p))} • ${esc(p.open_now ? T('Ochiq') : T('Yopiq'))}</span>
                ${verifiedBadge(p.verified)}
              </div>
              <h3 class="text-lg font-bold text-slate-900">${esc(p.pharmacy_name)}</h3>
              <div class="text-sm text-slate-600">${esc(p.city)}, ${esc(p.address)}${p.distance_km !== null ? ` <b class="text-brand-blue">${esc(distance(p.distance_km))}</b>` : ''}</div>
              <ul class="mt-2 text-xs text-slate-600 space-y-0.5">
                ${p.items.map(it => `<li>${esc(meds[it.medicine_id] ? meds[it.medicine_id].name + ' ' + (meds[it.medicine_id].dosage || '') : '#' + it.medicine_id)} × ${it.qty} — <b>${price(it.subtotal)}</b>${it.status === 'low' ? ` <span class="text-amber-600">(${esc(T('kam qoldi'))})</span>` : ''}</li>`).join('')}
              </ul>
            </div>
            <div class="text-right shrink-0">
              <div class="text-xs text-slate-500">${esc(T('Jami ({n}/{m} dori)', { n: p.found, m: r.requested }))}</div>
              <div class="text-2xl font-extrabold text-slate-900">${price(p.total)}</div>
              <div class="flex gap-1.5 justify-end mt-2">
                <a href="tel:${esc(String(p.phone).replace(/[^\d+]/g, ''))}" class="btn btn-sm btn-ghost"><i data-lucide="phone" class="w-3.5 h-3.5"></i></a>
                <button type="button" data-action="cart-reserve" data-idx="${idx}" class="btn btn-sm btn-blue">${esc(T('Hammasini bron qilish'))}</button>
              </div>
            </div>
          </div>
        </article>`).join('')
        : `<div class="glass rounded-3xl p-8 text-center text-sm text-slate-600">${esc(T('Tanlangan dorilar hech bir dorixonada topilmadi.'))}</div>`;
      icons();
    } catch (err) { onError(err); }
  }

  // =========================================================================
  // SEVIMLILAR
  // =========================================================================
  registerPage('favorites', async (main) => {
    main.innerHTML = `<h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-5">${esc(T('Sevimlilar'))}</h1><div id="favList" class="space-y-3"></div>`;
    loading($('favList'));
    const r = await api('/api/my/favorites');
    const tgOn = state.config.telegram.enabled;
    $('favList').innerHTML = r.favorites.length ? r.favorites.map(f => `
      <div class="glass rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button type="button" data-action="select-med" data-med-id="${f.id}" class="text-left min-w-0">
          <div class="font-bold text-slate-900">${esc(f.name)} <span class="font-normal text-slate-500 text-sm">${esc(f.dosage)}</span> ${rxBadge(f.prescription)}</div>
          <div class="text-sm mt-0.5 ${f.min_price ? 'text-brand-green font-bold' : 'text-slate-400'}">${f.min_price ? esc(T('{p} dan', { p: price(f.min_price) })) + ` <span class="font-normal text-slate-500">• ${esc(T('{n} dorixonada', { n: f.available_count }))}</span>` : esc(T('Mavjud emas'))}</div>
        </button>
        <div class="flex flex-wrap gap-1.5">
          ${tgOn ? `
          <button type="button" data-action="fav-watch" data-med-id="${f.id}" data-kind="price" data-on="${f.watches.includes('price') ? 1 : 0}" class="btn btn-sm ${f.watches.includes('price') ? 'btn-soft' : 'btn-ghost'}"><i data-lucide="trending-down" class="w-3.5 h-3.5"></i>${esc(T('Narx tushsa'))}</button>
          <button type="button" data-action="fav-watch" data-med-id="${f.id}" data-kind="available" data-on="${f.watches.includes('available') ? 1 : 0}" class="btn btn-sm ${f.watches.includes('available') ? 'btn-soft' : 'btn-ghost'}"><i data-lucide="bell" class="w-3.5 h-3.5"></i>${esc(T('Kelganda'))}</button>` : ''}
          <button type="button" data-action="cart-add" data-med-id="${f.id}" data-name="${esc(f.name)}" data-dosage="${esc(f.dosage)}" class="btn btn-sm btn-ghost"><i data-lucide="shopping-basket" class="w-3.5 h-3.5"></i></button>
          <button type="button" data-action="fav-remove" data-med-id="${f.id}" class="btn btn-sm btn-danger"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
      </div>`).join('')
      : `<div class="glass rounded-3xl p-8 text-center text-sm text-slate-600">${esc(T('Sevimlilar ro‘yxati bo‘sh. Dori sahifasida ♡ tugmasini bosing.'))}</div>`;
  });

  // =========================================================================
  // MENING BRONLARIM
  // =========================================================================
  registerPage('reservations', async (main) => {
    main.innerHTML = `<h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-5">${esc(T('Bronlarim'))}</h1><div id="resList" class="space-y-3"></div>`;
    loading($('resList'));
    const r = await api('/api/my/reservations');
    $('resList').innerHTML = r.reservations.length ? r.reservations.map(x => {
      const st = resStatusMeta(x.status);
      return `
        <div class="glass rounded-2xl p-4">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div>
              <div class="flex items-center gap-2"><span class="font-extrabold text-slate-900">#${esc(x.code)}</span><span class="chip ${st.cls}">${esc(st.label)}</span></div>
              <div class="font-semibold text-slate-800 mt-1">${esc(x.pharmacy_name)}</div>
              <div class="text-xs text-slate-500">${esc(x.city)}, ${esc(x.address)} • ${esc(x.pharmacy_phone)}</div>
              <ul class="mt-2 text-sm text-slate-700">${x.items.map(i => `<li>${esc(i.name)} × ${i.qty} — ${price(i.price * i.qty)}</li>`).join('')}</ul>
              ${x.status === 'confirmed' && x.hold_until ? `<div class="mt-1 text-xs font-semibold text-brand-green">${esc(T('{t} gacha ushlab turiladi', { t: fmtDate(x.hold_until) }))}</div>` : ''}
              ${x.owner_note ? `<div class="mt-1 text-xs text-slate-500">${esc(T('Dorixona izohi'))}: ${esc(x.owner_note)}</div>` : ''}
            </div>
            <div class="text-right">
              <div class="text-lg font-extrabold">${price(x.total)}</div>
              <div class="muted">${fmtDate(x.created_at)}</div>
              ${['pending', 'confirmed'].includes(x.status) ? `<button type="button" data-action="res-cancel" data-id="${x.id}" class="btn btn-sm btn-danger mt-2">${esc(T('Bekor qilish'))}</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('') : `<div class="glass rounded-3xl p-8 text-center text-sm text-slate-600">${esc(T('Hali bron qilmagansiz.'))}</div>`;
  });

  // =========================================================================
  // PROFIL
  // =========================================================================
  async function linkTelegram() {
    try {
      const r = await api('/api/auth/me/telegram/link', { method: 'POST' });
      window.open(r.url, '_blank', 'noopener');
      await infoModal(T('Telegram’ni ulash'), `<p>${esc(T('Telegram ochildi: botda “Start” tugmasini bosing. So‘ng bu sahifani yangilang.'))}</p><p class="mt-2"><a class="text-brand-blue underline break-all" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></p>`);
      const me = await api('/api/auth/me');
      state.user = me.user;
      if (state.page === 'profile') switchPage('profile', { replace: true });
    } catch (err) { onError(err); }
  }

  registerPage('profile', async (main) => {
    const me = (await api('/api/auth/me')).user;
    state.user = me;
    const tgOn = state.config.telegram.enabled;
    main.innerHTML = `
      <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-5">${esc(T('Profil'))}</h1>
      <div class="space-y-5">
        <section class="card">
          <h2 class="font-bold text-slate-900 mb-3">${esc(T('Shaxsiy ma’lumotlar'))}</h2>
          <form id="profileForm" class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div><label class="field-label">${esc(T('Ism-familiya'))}</label><input name="full_name" class="input" value="${esc(me.full_name)}" required/></div>
            <div><label class="field-label">${esc(T('Telefon'))}</label><input class="input bg-slate-100" value="${esc(me.phone)}" disabled/></div>
            <div><label class="field-label">${esc(T('Til'))}</label><select name="lang" class="input font-semibold"><option value="uz" ${me.lang === 'uz' ? 'selected' : ''}>O‘zbekcha</option><option value="ru" ${me.lang === 'ru' ? 'selected' : ''}>Русский</option></select></div>
            <div class="sm:col-span-3"><button class="btn btn-md btn-green">${esc(T('Saqlash'))}</button> <span class="muted ml-2">${esc(roleLabel(me.role))}</span></div>
          </form>
        </section>

        <section class="card">
          <h2 class="font-bold text-slate-900 mb-1 flex items-center gap-2"><i data-lucide="send" class="w-4 h-4 text-brand-blue"></i>Telegram</h2>
          <p class="text-sm text-slate-600 mb-3">${esc(T('Telegram ulansa: bron holati, “kelganda xabar ber”, narx tushishi, dorixona eslatmalari va parolni tiklash kodi botga keladi.'))}</p>
          ${!tgOn ? `<div class="muted">${esc(T('Telegram bot hozircha sozlanmagan.'))}</div>` : me.telegram_linked
            ? `<div class="flex items-center gap-2"><span class="chip bg-emerald-50 text-brand-green"><i data-lucide="check" class="w-3.5 h-3.5"></i>${esc(T('Ulangan'))}</span><button type="button" data-action="tg-unlink" class="btn btn-sm btn-danger">${esc(T('Uzish'))}</button></div>`
            : `<button type="button" data-action="tg-link" class="btn btn-md btn-blue"><i data-lucide="send" class="w-4 h-4"></i>${esc(T('Telegram’ni ulash'))}</button>`}
        </section>

        <section class="card">
          <h2 class="font-bold text-slate-900 mb-3">${esc(T('Parolni o‘zgartirish'))}</h2>
          <form id="passwordForm" class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div><label class="field-label">${esc(T('Joriy parol'))}</label><input name="current_password" type="password" autocomplete="current-password" class="input" required/></div>
            <div><label class="field-label">${esc(T('Yangi parol (kamida 8 ta belgi)'))}</label><input name="new_password" type="password" minlength="8" maxlength="72" autocomplete="new-password" class="input" required/></div>
            <div><button class="btn btn-md btn-blue w-full">${esc(T('Yangilash'))}</button></div>
          </form>
        </section>

        <section class="card" id="twofaCard">
          <h2 class="font-bold text-slate-900 mb-1 flex items-center gap-2"><i data-lucide="shield-check" class="w-4 h-4 text-brand-green"></i>${esc(T('Ikki bosqichli kirish (2FA)'))}</h2>
          <p class="text-sm text-slate-600 mb-3">${esc(me.role === 'admin' ? T('Administratorlar uchun majburiy. Kirishda paroldan tashqari autentifikator ilovasidagi kod so‘raladi.') : T('Hisobingizni qo‘shimcha himoyalaydi: kirishda autentifikator ilovasidagi kod so‘raladi.'))}</p>
          ${me.totp_enabled
            ? `<div class="flex items-center gap-2"><span class="chip bg-emerald-50 text-brand-green"><i data-lucide="check" class="w-3.5 h-3.5"></i>${esc(T('Yoqilgan'))}</span>${me.role !== 'admin' ? `<button type="button" data-action="2fa-disable" class="btn btn-sm btn-danger">${esc(T('O‘chirish'))}</button>` : ''}</div>`
            : `<button type="button" data-action="2fa-setup" class="btn btn-md btn-green">${esc(T('2FA ni yoqish'))}</button>`}
        </section>

        <section class="card">
          <h2 class="font-bold text-slate-900 mb-2">${esc(T('Xavfsizlik'))}</h2>
          <button type="button" data-action="logout-all" class="btn btn-md btn-ghost"><i data-lucide="log-out" class="w-4 h-4"></i>${esc(T('Barcha qurilmalardan chiqish'))}</button>
        </section>
      </div>`;

    $('profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const r = await api('/api/auth/me', { method: 'PATCH', body: fd });
        state.user = { ...state.user, ...r.user };
        showToast(T('Saqlandi'));
        if (fd.lang !== T.lang) setLang(fd.lang, { persistRemote: false }); else renderNav();
      } catch (err) { onError(err); }
    });
    $('passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const r = await api('/api/auth/me/password', { method: 'POST', body: fd });
        saveToken(r.token);
        state.user = r.user;
        e.target.reset();
        showToast(T('Parol yangilandi. Boshqa qurilmalardagi sessiyalar yopildi.'));
      } catch (err) { onError(err); }
    });
  });

  async function setup2fa() {
    try {
      const s = await api('/api/auth/me/2fa/setup', { method: 'POST' });
      const v = await openModal({
        title: T('2FA ni yoqish'),
        intro: `
          <ol class="list-decimal pl-5 space-y-1 text-sm">
            <li>${esc(T('Telefoningizga Google Authenticator yoki Authy ilovasini o‘rnating.'))}</li>
            <li>${esc(T('QR kodni skanerlang yoki kalitni qo‘lda kiriting.'))}</li>
            <li>${esc(T('Ilova ko‘rsatgan 6 xonali kodni kiriting.'))}</li>
          </ol>
          <div class="qr-box flex justify-center my-3 bg-white rounded-2xl p-3">${s.qr_svg || ''}</div>
          <div class="text-xs text-center break-all font-mono bg-slate-100 rounded-xl p-2">${esc(s.secret)}</div>`,
        fields: [{ name: 'code', label: T('6 xonali kod'), required: true, autocomplete: 'one-time-code' }],
        submitLabel: T('Yoqish')
      });
      if (!v) return;
      const r = await api('/api/auth/me/2fa/enable', { method: 'POST', body: { code: v.code } });
      saveToken(r.token);
      state.user = r.user;
      showToast(T('Ikki bosqichli kirish yoqildi.'));
      switchPage('profile', { replace: true });
    } catch (err) { onError(err); }
  }

  async function disable2fa() {
    const v = await openModal({
      title: T('2FA ni o‘chirish'),
      fields: [
        { name: 'password', label: T('Joriy parol'), type: 'password', required: true },
        { name: 'code', label: T('6 xonali kod'), required: true }
      ],
      submitLabel: T('O‘chirish'), danger: true
    });
    if (!v) return;
    try {
      const r = await api('/api/auth/me/2fa/disable', { method: 'POST', body: v });
      saveToken(r.token); state.user = r.user;
      showToast(T('2FA o‘chirildi.'));
      switchPage('profile', { replace: true });
    } catch (err) { onError(err); }
  }

  // =========================================================================
  // DORIXONA OCHISH ARIZASI
  // =========================================================================
  registerPage('apply', async (main) => {
    main.innerHTML = `
      <div class="space-y-6">
        <div class="glass-strong rounded-3xl p-6 sm:p-7">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-11 h-11 rounded-2xl bg-sky-50 text-brand-blue flex items-center justify-center"><i data-lucide="file-check-2" class="w-5 h-5"></i></div>
            <div>
              <h1 class="text-xl sm:text-2xl font-extrabold text-slate-900">${esc(T('Dorixona ochishga ariza berish'))}</h1>
              <p class="text-xs sm:text-sm text-slate-500">${esc(T('Arizangiz administrator tomonidan tekshirilib, litsenziya tasdiqlangach dorixona kabineti ochiladi.'))}</p>
            </div>
          </div>
          <form id="applyForm" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div><label class="field-label">${esc(T('Dorixona nomi'))} *</label><input name="name" required class="input" placeholder="${esc(T('Masalan: Shifo Farm'))}"/></div>
              <div><label class="field-label">${esc(T('Litsenziya raqami'))} *</label><input name="license_number" required class="input" placeholder="UZ-PH-2026-0412"/></div>
              <div><label class="field-label">${esc(T('Shahar'))} *</label><input name="city" required class="input" list="cityList" placeholder="${esc(T('Andijon / Toshkent'))}"/><datalist id="cityList">${state.cities.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
              <div class="sm:col-span-2"><label class="field-label">${esc(T('Aniq manzil'))} *</label><input name="address" required class="input" placeholder="${esc(T('Ko‘cha, uy raqami, mo‘ljal'))}"/></div>
              <div><label class="field-label">${esc(T('Dorixona telefoni'))} *</label><input name="phone" type="tel" required class="input" placeholder="+998 74 223 00 00"/></div>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <div><label class="field-label">${esc(T('Kenglik (lat)'))} *</label><input name="lat" id="apLat" type="number" step="any" required value="${DEFAULT_CENTER.lat}" class="input"/></div>
              <div><label class="field-label">${esc(T('Uzunlik (lng)'))} *</label><input name="lng" id="apLng" type="number" step="any" required value="${DEFAULT_CENTER.lng}" class="input"/></div>
              <label class="inline-flex items-center gap-2 pb-2.5 text-sm font-semibold text-slate-700"><input type="checkbox" name="is_247" class="w-4 h-4"/> 24/7</label>
              <div class="grid grid-cols-2 gap-2"><input type="time" name="open_time" value="08:00" class="input px-2"/><input type="time" name="close_time" value="22:00" class="input px-2"/></div>
            </div>
            <div>
              <div class="text-xs font-semibold text-slate-500 mb-1.5">${esc(T('Xaritadan nuqtani bosib yoki markerni surib belgilang:'))}</div>
              <div id="applyPickerMap" class="w-full h-60 rounded-2xl border border-slate-200 z-10"></div>
            </div>
            <button type="submit" class="btn btn-md btn-blue">${esc(T('Arizani yuborish'))}</button>
          </form>
        </div>
        <div class="card">
          <h2 class="text-base font-bold text-slate-900 mb-3">${esc(T('Mening arizalarim'))}</h2>
          <div id="myRequestsList" class="space-y-3"></div>
        </div>
      </div>`;
    mountPicker($('applyPickerMap'), $('apLat'), $('apLng'));
    $('applyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      fd.is_247 = e.target.elements.is_247.checked;
      fd.lat = parseFloat(fd.lat); fd.lng = parseFloat(fd.lng);
      try {
        await api('/api/pharmacy-requests', { method: 'POST', body: fd });
        e.target.reset();
        showToast(T('Arizangiz yuborildi! Administrator tasdiqlashini kuting.'));
        loadMyRequests();
      } catch (err) { onError(err); }
    });
    loadMyRequests();
  });

  async function loadMyRequests() {
    const el = $('myRequestsList');
    const res = await api('/api/my/pharmacy-requests');
    el.innerHTML = res.requests.length ? res.requests.map(r => {
      const badge = r.status === 'approved' ? `<span class="chip bg-emerald-50 text-brand-green">${esc(T('Tasdiqlandi'))}</span>`
        : r.status === 'rejected' ? `<span class="chip bg-rose-50 text-rose-600">${esc(T('Rad etildi'))}</span>`
          : `<span class="chip bg-amber-50 text-amber-700">${esc(T('Tekshiruvda'))}</span>`;
      return `
        <div class="bg-white/80 rounded-2xl border border-slate-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div class="font-bold text-slate-900">${esc(r.name)} <span class="text-xs font-normal text-slate-500">(${esc(r.license_number)})</span></div>
            <div class="text-xs text-slate-600">${esc(r.city)}, ${esc(r.address)} • ${esc(r.phone)}</div>
            ${r.admin_note ? `<div class="text-xs text-slate-500 mt-1">${esc(T('Izoh'))}: ${esc(r.admin_note)}</div>` : ''}
          </div>
          ${badge}
        </div>`;
    }).join('') : `<div class="text-sm text-slate-500">${esc(T('Siz hali ariza yubormagansiz.'))}</div>`;
  }

  // =========================================================================
  // GLOBAL HODISALAR
  // =========================================================================
  const actions = {
    'switch-page': (b) => switchPage(b.dataset.page),
    'show-auth': () => showAuth('login'),
    'back-to-search': () => { renderShell(); switchPage(state.page || 'search', { replace: true }); },
    'auth-mode': (b) => renderAuth(b.dataset.mode),
    'logout': logout,
    'toggle-lang': () => setLang(T.lang === 'ru' ? 'uz' : 'ru'),
    'modal-close': () => closeModal(null),
    'copy-text': (b) => navigator.clipboard?.writeText(b.dataset.text).then(() => showToast(T('Nusxalandi: {t}', { t: b.dataset.text }))),
    'select-med': async (b) => {
      state.selectedMedId = Number(b.dataset.medId);
      const list = $('autocompleteList');
      if (list) list.classList.add('hidden');
      if (state.page !== 'search') { switchPage('search'); return; }
      const inp = $('searchInput');
      if (inp) inp.value = '';
      await loadOffers();
      document.querySelectorAll('#popularChips [data-med-id]').forEach(c => {
        const on = Number(c.dataset.medId) === state.selectedMedId;
        c.className = `px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? 'bg-brand-green text-white border-brand-green' : 'bg-white/80 text-slate-700 border-slate-200 hover:border-brand-blue'}`;
      });
      $('medicinePassport').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'toggle-filter': (b) => { state.filters[b.dataset.filter] = !state.filters[b.dataset.filter]; loadOffers(); },
    'set-sort': (b) => {
      state.sortBy = b.dataset.sort;
      if (state.sortBy === 'distance' && !state.userLocation) return actions['find-nearby']();
      loadOffers();
    },
    'set-view': (b) => { state.viewMode = b.dataset.view; loadOffers(); },
    'find-nearby': () => {
      if (!navigator.geolocation) { showToast(T('Brauzeringiz joylashuvni aniqlay olmaydi.'), 'error'); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => { state.userLocation = { lat: p.coords.latitude, lng: p.coords.longitude }; state.sortBy = 'distance'; loadOffers(); showToast(T('Eng yaqin dorixonalar saralandi!')); },
        () => { showToast(T('Joylashuvga ruxsat berilmadi. Narx bo‘yicha saralangan.'), 'info'); state.sortBy = 'price'; loadOffers(); },
        { timeout: 8000, maximumAge: 300000 }
      );
    },
    'open-call': (b) => { const o = findOffer(b.dataset.pharmacyId); if (o) openCall(o); },
    'focus-on-map': (b) => { state.viewMode = 'map'; loadOffers(b.dataset.pharmacyId); },
    'reserve': (b) => {
      const o = findOffer(b.dataset.pharmacyId);
      const m = state.lastMedicine;
      if (o && m) reserve(o.pharmacy_id, [{ medicine_id: m.id, name: `${m.name} ${m.dosage || ''}`.trim(), qty: 1, price: o.price, prescription: m.prescription }], { pharmacyName: o.pharmacy_name });
    },
    'report-price': (b) => reportPrice(b.dataset.invId),
    'toggle-watch': (b) => toggleWatch(b.dataset.kind),
    'toggle-fav': toggleFav,
    'share-med': shareMed,
    'cart-add': (b) => {
      const m = state.lastMedicine && state.lastMedicine.id === Number(b.dataset.medId) ? state.lastMedicine : { id: Number(b.dataset.medId), name: b.dataset.name, dosage: b.dataset.dosage };
      cart.add(m);
      showToast(T('Savatga qo‘shildi ({n} ta dori)', { n: cart.count() }));
    },
    'cart-remove': (b) => { cart.remove(Number(b.dataset.medId)); switchPage('cart', { replace: true }); },
    'cart-clear': () => { cart.save([]); switchPage('cart', { replace: true }); },
    'cart-compare': compareCart,
    'cart-reserve': (b) => {
      const p = state.cartResult.pharmacies[Number(b.dataset.idx)];
      const meds = Object.fromEntries(state.cartResult.medicines.map(m => [m.id, m]));
      reserve(p.pharmacy_id, p.items.map(it => ({ medicine_id: it.medicine_id, qty: it.qty, price: it.price, name: meds[it.medicine_id] ? `${meds[it.medicine_id].name} ${meds[it.medicine_id].dosage || ''}`.trim() : '#' + it.medicine_id, prescription: meds[it.medicine_id] && meds[it.medicine_id].prescription })), { pharmacyName: p.pharmacy_name });
    },
    'fav-remove': async (b) => { try { await api(`/api/my/favorites/${b.dataset.medId}`, { method: 'DELETE' }); switchPage('favorites', { replace: true }); } catch (err) { onError(err); } },
    'fav-watch': async (b) => {
      try {
        if (b.dataset.on === '1') await api(`/api/my/watches?medicine_id=${b.dataset.medId}&kind=${b.dataset.kind}`, { method: 'DELETE' });
        else await api('/api/my/watches', { method: 'PUT', body: { medicine_id: Number(b.dataset.medId), kind: b.dataset.kind } });
        switchPage('favorites', { replace: true });
      } catch (err) {
        if (err.code === 'watch.need_telegram') { if (await confirmModal(T('Telegram ulanmagan'), T('Xabarnomalar Telegram bot orqali yuboriladi. Hozir ulaysizmi?'), { danger: false, confirmLabel: T('Telegram’ni ulash') })) linkTelegram(); return; }
        onError(err);
      }
    },
    'res-cancel': async (b) => {
      if (!(await confirmModal(T('Bronni bekor qilish'), T('Bron bekor qilinsinmi?')))) return;
      try { await api(`/api/reservations/${b.dataset.id}/cancel`, { method: 'POST' }); showToast(T('Bron bekor qilindi'), 'info'); switchPage('reservations', { replace: true }); } catch (err) { onError(err); }
    },
    'tg-link': linkTelegram,
    'tg-unlink': async () => {
      if (!(await confirmModal(T('Telegram’ni uzish'), T('Telegram xabarnomalari to‘xtatiladi. Davom etasizmi?')))) return;
      try { await api('/api/auth/me/telegram', { method: 'DELETE' }); switchPage('profile', { replace: true }); } catch (err) { onError(err); }
    },
    '2fa-setup': setup2fa,
    '2fa-disable': disable2fa,
    'logout-all': async () => {
      if (!(await confirmModal(T('Barcha qurilmalardan chiqish'), T('Barcha qurilmalardagi sessiyalar yopiladi, shu jumladan shu qurilmada ham.')))) return;
      try { await api('/api/auth/me/logout-all', { method: 'POST' }); logout(); } catch (err) { onError(err); }
    }
  };

  document.addEventListener('click', async (e) => {
    const list = $('autocompleteList');
    if (list && !e.target.closest('#searchInput') && !e.target.closest('#autocompleteList')) list.classList.add('hidden');
    if (e.target === $('modal')) { closeModal(null); return; }
    const route = e.target.closest('[data-route-ph]');
    if (route) trackEvent('route', route.dataset.routePh, state.selectedMedId);
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const fn = actions[btn.dataset.action];
    if (fn) {
      e.preventDefault();
      try { await fn(btn, e); } catch (err) { onError(err); }
    }
  });

  document.addEventListener('submit', (e) => {
    const f = e.target.closest('#authCard form[data-form]');
    if (f) { e.preventDefault(); handleAuthForm(f); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(null);
  });

  // =========================================================================
  // ISHGA TUSHIRISH
  // =========================================================================
  async function init() {
    const url = new URL(location.href);
    const qLang = url.searchParams.get('lang');
    if (qLang === 'ru' || qLang === 'uz') T.setLang(qLang);
    state.token = store.get(TOKEN_KEY);
    try { state.config = await api('/api/config'); } catch (e) { /* standart */ }
    if (state.token) {
      try {
        state.user = (await api('/api/auth/me')).user;
        if (state.user.lang && !qLang && state.user.lang !== T.lang) T.setLang(state.user.lang);
      } catch (e) { saveToken(null); state.user = null; }
    }
    renderShell();
    const page = url.searchParams.get('page') || 'search';
    switchPage(page, { replace: true });
    if (state.user && state.user.must_change_password) forcePasswordChange();
  }

  // Boshqa fayllar (cabinet.js, admin.js) uchun umumiy API
  window.DT = {
    state, api, esc, price, fmtDate, daysAgo, statusMeta, resStatusMeta, rxBadge, verifiedBadge, icons, debounce,
    showToast, onError, loading, openModal, confirmModal, infoModal, closeModal, registerPage, switchPage, actions,
    makeMap, mountPicker, lineChart, barChart, bindCharts, downloadFile, roleLabel, hoursText, scheduleText, DAY_NAMES, DEFAULT_CENTER
  };

  window.addEventListener('DOMContentLoaded', init);
})();
