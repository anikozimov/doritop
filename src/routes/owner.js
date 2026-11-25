'use strict';
// Dorixona egasi ('pharmacy_owner') va admin route'lari: profil, ombor, CSV, statistika, bronlar, xabarlar

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const U = require('../utils');
const L = require('../lib');
const { requireAuth, requireRole } = require('../auth');
const { reservationView } = require('./user');

const router = express.Router();
const ownerOrAdmin = [requireAuth, requireRole('pharmacy_owner', 'admin')];

function pharmacyFor(req, res) {
  const id = L.int(req.params.id);
  if (!id || !L.canManagePharmacy(req.user, id)) {
    res.fail(403, 'common.forbidden');
    return null;
  }
  return id;
}

function changed(medicineIds) {
  if (medicineIds.length) L.bus.emit('inventory:changed', { medicine_ids: [...new Set(medicineIds)] });
}

// =========================================================================
// DORIXONA PROFILI
// =========================================================================
router.get('/my/pharmacies', ...ownerOrAdmin, (req, res) => {
  const rows = req.user.role === 'admin' && req.query.all === '1'
    ? db.prepare('SELECT * FROM pharmacies ORDER BY id DESC LIMIT 500').all()
    : db.prepare('SELECT * FROM pharmacies WHERE owner_id = ? ORDER BY id DESC').all(req.user.id);
  const last = db.prepare('SELECT MAX(updated_at) AS t, COUNT(*) AS c FROM inventory WHERE pharmacy_id = ?');
  const openRes = db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE pharmacy_id = ? AND status = 'pending'");
  const openRep = db.prepare("SELECT COUNT(*) AS c FROM price_reports WHERE pharmacy_id = ? AND status = 'open'");
  res.json({
    pharmacies: rows.map(p => {
      const l = last.get(p.id);
      return {
        ...L.pharmacyView(p),
        inventory_count: l.c,
        last_price_update: l.t,
        stale_days: l.t ? U.daysSince(l.t) : null,
        pending_reservations: openRes.get(p.id).c,
        open_reports: openRep.get(p.id).c
      };
    }),
    stale_threshold: config.STALE_DAYS
  });
});

// Ega: telefon(lar), manzil, shahar, xarita nuqtasi, ish vaqti va jadval. Nom va litsenziyani faqat admin o'zgartiradi.
router.put('/pharmacies/:id', ...ownerOrAdmin, (req, res) => {
  const pharmacyId = L.int(req.params.id);
  const isAdmin = req.user.role === 'admin';
  const existing = isAdmin
    ? db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pharmacyId)
    : db.prepare('SELECT * FROM pharmacies WHERE id = ? AND owner_id = ?').get(pharmacyId, req.user.id);
  if (!existing) return res.fail(404, 'pharmacy.not_found_or_not_yours');

  const b = req.body;
  const merged = {
    name: isAdmin && b.name !== undefined ? b.name : existing.name,
    license_number: isAdmin && b.license_number !== undefined ? b.license_number : existing.license_number,
    city: b.city ?? existing.city,
    address: b.address ?? existing.address,
    phone: b.phone ?? existing.phone,
    lat: b.lat ?? existing.lat,
    lng: b.lng ?? existing.lng,
    is_247: b.is_247 !== undefined ? b.is_247 : existing.is_247,
    open_time: b.open_time ?? existing.open_time,
    close_time: b.close_time ?? existing.close_time,
    phones: b.phones !== undefined ? b.phones : L.jsonParse(existing.phones, []),
    schedule: b.schedule !== undefined ? b.schedule : (existing.schedule || '')
  };
  const v = L.validatePharmacy(merged, { requireLicense: false });
  if (v.error) return res.fail(400, v.error);
  const d = v.value;
  if (isAdmin && d.license_number !== existing.license_number && L.licenseTaken(d.license_number, { exceptPharmacyId: pharmacyId })) {
    return res.fail(409, 'pharmacy.license_other');
  }
  // Litsenziya o'zgarsa "tasdiqlangan" belgisi qayta tekshirilishi kerak
  const verified = d.license_number !== existing.license_number ? 0 : existing.verified;

  db.prepare(`
    UPDATE pharmacies
    SET name = ?, license_number = ?, city = ?, address = ?, phone = ?, lat = ?, lng = ?,
        is_247 = ?, open_time = ?, close_time = ?, phones = ?, schedule = ?, verified = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(d.name, d.license_number, d.city, d.address, d.phone, d.lat, d.lng, d.is_247, d.open_time, d.close_time,
    d.phones, d.schedule, verified, pharmacyId);

  const diff = {};
  for (const k of ['name', 'license_number', 'city', 'address', 'phone', 'lat', 'lng', 'is_247', 'open_time', 'close_time', 'phones', 'schedule']) {
    if (String(existing[k] ?? '') !== String(d[k] ?? '')) diff[k] = { from: existing[k], to: d[k] };
  }
  if (Object.keys(diff).length) L.audit(req, 'update', 'pharmacy', pharmacyId, diff);
  return res.json({ pharmacy: L.pharmacyView(db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pharmacyId)) });
});

// ---- Logotip (faqat PNG/JPEG/WEBP; SVG XSS xavfi sababli qabul qilinmaydi)
const MAX_LOGO = 400 * 1024;
function detectImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function removeLogoFile(name) {
  if (!name || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(name)) return;
  fs.promises.unlink(path.join(config.UPLOAD_DIR, name)).catch(() => {});
}

router.post('/pharmacies/:id/logo', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(req.body.data_url || ''));
  if (!m) return res.fail(400, 'logo.bad_format');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_LOGO) return res.fail(400, 'logo.too_big');
  const ext = detectImage(buf);
  if (!ext) return res.fail(400, 'logo.bad_format');
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(config.UPLOAD_DIR, name), buf, { mode: 0o644 });
  const old = db.prepare('SELECT logo_path FROM pharmacies WHERE id = ?').get(pid).logo_path;
  db.prepare('UPDATE pharmacies SET logo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, pid);
  removeLogoFile(old);
  L.audit(req, 'logo', 'pharmacy', pid);
  res.json({ logo_url: `/uploads/${name}` });
});

router.delete('/pharmacies/:id/logo', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const old = db.prepare('SELECT logo_path FROM pharmacies WHERE id = ?').get(pid).logo_path;
  db.prepare("UPDATE pharmacies SET logo_path = '' WHERE id = ?").run(pid);
  removeLogoFile(old);
  res.json({ ok: true });
});

// =========================================================================
// DORILAR KATALOGI (ega ro'yxatdan tanlaydi, kerak bo'lsa yangisini qo'shadi)
// =========================================================================
router.get('/medicines/suggest', ...ownerOrAdmin, (req, res) => {
  const q = U.cleanStr(req.query.q, 100);
  if (q.length < 2) return res.json({ medicines: [] });
  const clause = L.buildSearchClause(q, ['m.name', 'm.active_ingredient', 'm.manufacturer']);
  const pid = L.int(req.query.pharmacy_id);
  const rows = db.prepare(`
    SELECT m.*, ${pid ? '(SELECT price FROM inventory i WHERE i.medicine_id = m.id AND i.pharmacy_id = ?)' : 'NULL'} AS my_price
    FROM medicines m WHERE ${clause.sql}
    ORDER BY m.verified DESC, (LOWER(m.name) LIKE LOWER(?)) DESC, m.name ASC LIMIT 15
  `).all(...(pid ? [pid] : []), ...clause.params, `${U.escapeLike(q)}%`);
  res.json({ medicines: rows.map(L.medicineView) });
});

router.post('/medicines', ...ownerOrAdmin, (req, res) => {
  const m = L.cleanMedicine(req.body);
  if (!m.name || !m.active_ingredient) return res.fail(400, 'medicine.name_required');
  const exact = L.findExactMedicine(m);
  if (exact) return res.json({ medicine: L.medicineView(exact), existed: true });
  // Yozilishi o'xshash dori bor bo'lsa, foydalanuvchidan tasdiq so'raladi (dublikatlar kamayadi)
  if (!L.toBool(req.body.force)) {
    const similar = L.findSimilarMedicines(m);
    if (similar.length) return res.fail(409, 'medicine.similar_exists', null, { similar });
  }
  const isAdmin = req.user.role === 'admin';
  const medicine = L.createMedicine(m, req.user.id, { verified: isAdmin ? 1 : 0 });
  L.audit(req, 'create', 'medicine', medicine.id, { name: m.name, dosage: m.dosage });
  return res.status(201).json({ medicine: L.medicineView(medicine) });
});

// Admin va egalar uchun dorilar ro'yxati (qidiruv + sahifalash)
router.get('/medicines', ...ownerOrAdmin, (req, res) => {
  const { limit, offset } = L.paging(req);
  const clause = L.buildSearchClause(req.query.q, ['m.name', 'm.active_ingredient', 'm.manufacturer']);
  const unverified = req.query.unverified === '1' ? 'AND m.verified = 0' : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM medicines m WHERE ${clause.sql} ${unverified}`).get(...clause.params).c;
  const rows = db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM inventory i WHERE i.medicine_id = m.id) AS offers_count
    FROM medicines m WHERE ${clause.sql} ${unverified} ORDER BY m.name ASC LIMIT ? OFFSET ?
  `).all(...clause.params, limit, offset);
  res.json({ medicines: rows.map(L.medicineView), total, limit, offset });
});

// =========================================================================
// OMBOR
// =========================================================================
router.get('/pharmacies/:id/inventory', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const { limit, offset } = L.paging(req, 50, 200);
  const conds = ['i.pharmacy_id = ?'];
  const params = [pid];
  if (req.query.q) {
    const c = L.buildSearchClause(req.query.q, ['m.name', 'm.active_ingredient', 'm.manufacturer']);
    conds.push(c.sql); params.push(...c.params);
  }
  if (L.STATUSES.includes(req.query.status)) { conds.push('i.status = ?'); params.push(req.query.status); }
  if (req.query.status === 'attention') conds.push("i.status IN ('low', 'out')");
  if (req.query.stale === '1') { conds.push("i.updated_at < datetime('now', ?)"); params.push(`-${config.STALE_DAYS} days`); }
  if (req.query.category) { conds.push('m.category = ?'); params.push(U.cleanStr(req.query.category, 60)); }
  const where = conds.join(' AND ');
  const order = req.query.sort === 'name' ? 'm.name ASC'
    : req.query.sort === 'oldest' ? 'i.updated_at ASC'
      : req.query.sort === 'price' ? 'i.price ASC'
        : "CASE i.status WHEN 'out' THEN 0 WHEN 'low' THEN 1 ELSE 2 END, i.updated_at DESC";

  const total = db.prepare(`SELECT COUNT(*) AS c FROM inventory i JOIN medicines m ON m.id = i.medicine_id WHERE ${where}`).get(...params).c;
  const items = db.prepare(`
    SELECT i.id, i.pharmacy_id, i.medicine_id, i.price, i.status, i.updated_at,
           m.name, m.active_ingredient, m.manufacturer, m.dosage, m.category, m.prescription, m.verified AS medicine_verified,
           (SELECT COUNT(*) FROM price_reports r WHERE r.inventory_id = i.id AND r.status = 'open') AS open_reports
    FROM inventory i JOIN medicines m ON m.id = i.medicine_id
    WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?
  `).all(...params, limit, offset).map(r => ({ ...r, updated_days: U.daysSince(r.updated_at), prescription: Boolean(r.prescription) }));

  const counts = db.prepare(`
    SELECT status, COUNT(*) AS c FROM inventory WHERE pharmacy_id = ? GROUP BY status
  `).all(pid).reduce((o, r) => ({ ...o, [r.status]: r.c }), { available: 0, low: 0, out: 0 });
  counts.stale = db.prepare("SELECT COUNT(*) AS c FROM inventory WHERE pharmacy_id = ? AND updated_at < datetime('now', ?)").get(pid, `-${config.STALE_DAYS} days`).c;
  const categories = db.prepare(`
    SELECT DISTINCT m.category FROM inventory i JOIN medicines m ON m.id = i.medicine_id WHERE i.pharmacy_id = ? ORDER BY m.category
  `).all(pid).map(r => r.category);
  res.json({ inventory: items, total, limit, offset, counts, categories });
});

function upsertOne(req, pid, medicineId, price, status) {
  const prev = db.prepare('SELECT id, price, status FROM inventory WHERE pharmacy_id = ? AND medicine_id = ?').get(pid, medicineId);
  L.upsertInvStmt().run(pid, medicineId, price, status);
  if (!prev || prev.price !== price || prev.status !== status) {
    L.audit(req, prev ? 'price_update' : 'price_create', 'inventory', prev ? prev.id : null, {
      pharmacy_id: pid, medicine_id: medicineId,
      from: prev ? { price: prev.price, status: prev.status } : null, to: { price, status }
    });
  }
}

router.post('/pharmacies/:id/inventory', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const medicineId = L.int(req.body.medicine_id);
  const price = L.int(req.body.price);
  const status = L.STATUSES.includes(req.body.status) ? req.body.status : 'available';
  if (!medicineId || !L.validPrice(price)) return res.fail(400, 'inventory.bad_input');
  if (!db.prepare('SELECT id FROM medicines WHERE id = ?').get(medicineId)) return res.fail(404, 'medicine.not_found');
  upsertOne(req, pid, medicineId, price, status);
  changed([medicineId]);
  return res.status(201).json({ ok: true });
});

router.patch('/inventory/:id', ...ownerOrAdmin, (req, res) => {
  const invId = L.int(req.params.id);
  const existing = invId && db.prepare('SELECT * FROM inventory WHERE id = ?').get(invId);
  if (!existing || !L.canManagePharmacy(req.user, existing.pharmacy_id)) return res.fail(403, 'inventory.not_found');
  const price = req.body.price !== undefined ? L.int(req.body.price) : existing.price;
  const status = L.STATUSES.includes(req.body.status) ? req.body.status : existing.status;
  if (!L.validPrice(price)) return res.fail(400, 'inventory.bad_price');
  upsertOne(req, existing.pharmacy_id, existing.medicine_id, price, status);
  // Narx yangilansa shu yozuv bo'yicha ochiq xabarlar yopiladi
  if (price !== existing.price || status !== existing.status) {
    db.prepare("UPDATE price_reports SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE inventory_id = ? AND status = 'open'").run(req.user.id, invId);
  }
  changed([existing.medicine_id]);
  return res.json({ ok: true });
});

router.delete('/inventory/:id', ...ownerOrAdmin, (req, res) => {
  const invId = L.int(req.params.id);
  const existing = invId && db.prepare('SELECT * FROM inventory WHERE id = ?').get(invId);
  if (!existing || !L.canManagePharmacy(req.user, existing.pharmacy_id)) return res.fail(403, 'common.forbidden');
  db.prepare('DELETE FROM inventory WHERE id = ?').run(invId);
  L.audit(req, 'price_delete', 'inventory', invId, { pharmacy_id: existing.pharmacy_id, medicine_id: existing.medicine_id, price: existing.price });
  return res.json({ deleted: true });
});

// Narxlar o'zgarmagan bo'lsa ham "tasdiqlash" (yangilangan sana bugungi bo'ladi)
router.post('/pharmacies/:id/inventory/confirm', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(L.int).filter(Boolean).slice(0, 5000) : null;
  let info;
  if (ids && ids.length) {
    info = db.prepare(`UPDATE inventory SET updated_at = CURRENT_TIMESTAMP WHERE pharmacy_id = ? AND id IN (${ids.map(() => '?').join(',')})`).run(pid, ...ids);
  } else {
    info = db.prepare('UPDATE inventory SET updated_at = CURRENT_TIMESTAMP WHERE pharmacy_id = ?').run(pid);
  }
  L.audit(req, 'price_confirm', 'pharmacy', pid, { count: info.changes });
  res.json({ confirmed: info.changes });
});

// Ommaviy narx o'zgartirish: "hamma narxni +5%" (kategoriya yoki tanlanganlar bo'yicha ham)
router.post('/pharmacies/:id/inventory/bulk-price', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const percent = Number(req.body.percent);
  const roundTo = [1, 10, 50, 100, 500, 1000].includes(Number(req.body.round_to)) ? Number(req.body.round_to) : 100;
  if (!Number.isFinite(percent) || percent === 0 || percent < -90 || percent > 300) return res.fail(400, 'bulk.bad_percent');
  const conds = ['i.pharmacy_id = ?'];
  const params = [pid];
  const scope = req.body.scope || 'all';
  if (scope === 'category') {
    conds.push('m.category = ?'); params.push(U.cleanStr(req.body.category, 60));
  } else if (scope === 'ids') {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(L.int).filter(Boolean).slice(0, 5000) : [];
    if (!ids.length) return res.fail(400, 'bulk.no_items');
    conds.push(`i.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids);
  } else if (scope === 'available') {
    conds.push("i.status != 'out'");
  }
  const rows = db.prepare(`
    SELECT i.id, i.medicine_id, i.price, m.name FROM inventory i JOIN medicines m ON m.id = i.medicine_id WHERE ${conds.join(' AND ')}
  `).all(...params);
  const changes = rows.map(r => {
    const raw = r.price * (1 + percent / 100);
    const np = Math.max(0, Math.min(L.MAX_PRICE, Math.round(raw / roundTo) * roundTo));
    return { id: r.id, medicine_id: r.medicine_id, name: r.name, from: r.price, to: np };
  }).filter(c => c.from !== c.to);

  if (L.toBool(req.body.dry_run)) return res.json({ dry_run: true, affected: changes.length, total: rows.length, sample: changes.slice(0, 10) });

  db.transaction(() => {
    const upd = db.prepare('UPDATE inventory SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    for (const c of changes) upd.run(c.to, c.id);
  })();
  L.audit(req, 'bulk_price', 'pharmacy', pid, { percent, round_to: roundTo, scope, category: req.body.category || null, affected: changes.length, sample: changes.slice(0, 20) });
  changed(changes.map(c => c.medicine_id));
  res.json({ updated: changes.length });
});

// ---- CSV
const HEADER_ALIASES = {
  name: ['name', 'nomi', 'nom', 'dori', 'dori nomi', 'название', 'наименование', 'препарат'],
  active_ingredient: ['active_ingredient', 'active', 'modda', 'tasir etuvchi modda', "ta'sir etuvchi modda", 'mnn', 'мнн', 'действующее вещество'],
  manufacturer: ['manufacturer', 'ishlab chiqaruvchi', 'zavod', 'производитель'],
  dosage: ['dosage', 'doza', 'dozasi', 'дозировка', 'доза'],
  category: ['category', 'kategoriya', 'категория', 'группа'],
  price: ['price', 'narx', 'narxi', 'цена', 'стоимость'],
  status: ['status', 'holat', 'holati', 'статус', 'наличие'],
  prescription: ['prescription', 'retsept', 'рецепт', 'rx']
};
const POSITIONAL = ['name', 'active_ingredient', 'manufacturer', 'dosage', 'category', 'price', 'status', 'prescription'];

function mapHeader(cols) {
  const norm = cols.map(c => String(c || '').toLowerCase().replace(/[‘’ʻʼ`]/g, "'").trim());
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norm.findIndex(c => aliases.includes(c));
    if (idx !== -1) map[field] = idx;
  }
  if (map.name === undefined || map.price === undefined) {
    return Object.fromEntries(POSITIONAL.map((f, i) => [f, i]));
  }
  return map;
}

function parsePriceCell(raw) {
  let s = String(raw || '').replace(/[\s ]/g, '').replace(/so['‘’ʻ]?m|сум|uzs/gi, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(parseFloat(s));
}

function parseStatusCell(raw) {
  const s = U.cleanStr(raw || '', 20).toLowerCase();
  if (!s || ['available', 'mavjud', 'bor', 'есть', 'в наличии', '1', 'ha'].includes(s)) return 'available';
  if (['low', 'kam', 'kam qoldi', 'мало', 'заканчивается'].includes(s)) return 'low';
  if (['out', 'tugagan', "yo'q", 'yoq', 'нет', '0', 'нет в наличии'].includes(s)) return 'out';
  return null;
}

// Aniq mos dori yo'q bo'lsa, yozilishi o'xshash yagona dori bo'lsa o'shani ishlatadi
function matchMedicine(m) {
  const exact = L.findExactMedicine(m);
  if (exact) return exact;
  const similar = L.findSimilarMedicines(m, 3).filter(s =>
    U.normKey(s.dosage) === U.normKey(m.dosage) &&
    (!m.manufacturer || !s.manufacturer || U.normKey(s.manufacturer) === U.normKey(m.manufacturer)));
  return similar.length === 1 ? similar[0] : null;
}

router.post('/pharmacies/:id/inventory/import-csv', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const csvText = String(req.body.csv || '').replace(/^﻿/, '').trim();
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return res.fail(400, 'csv.too_short');
  if (lines.length - 1 > L.MAX_CSV_ROWS) return res.fail(400, 'csv.too_many', { n: L.MAX_CSV_ROWS });

  const delimiter = U.detectDelimiter(lines[0]);
  const map = mapHeader(U.parseCsvLine(lines[0], delimiter));
  const missingAsOut = L.toBool(req.body.missing_as_out);
  const isAdmin = req.user.role === 'admin';
  const get = (cols, f) => (map[f] === undefined ? '' : cols[map[f]]);

  const result = db.transaction(() => {
    let imported = 0, createdMeds = 0, unchanged = 0, markedOut = 0;
    const errors = [];
    const touched = new Set();
    const medIds = [];
    const upsert = L.upsertInvStmt();
    const prevStmt = db.prepare('SELECT price, status FROM inventory WHERE pharmacy_id = ? AND medicine_id = ?');
    lines.slice(1).forEach((line, idx) => {
      const lineNo = idx + 2;
      const cols = U.parseCsvLine(line, delimiter);
      const price = parsePriceCell(get(cols, 'price'));
      const status = parseStatusCell(get(cols, 'status'));
      const m = L.cleanMedicine({
        name: get(cols, 'name'), active_ingredient: get(cols, 'active_ingredient') || get(cols, 'name'),
        manufacturer: get(cols, 'manufacturer'), dosage: get(cols, 'dosage'), category: get(cols, 'category'),
        prescription: ['1', 'true', 'ha', 'yes', 'retsept', 'да', 'rx'].includes(U.cleanStr(get(cols, 'prescription'), 10).toLowerCase())
      });
      if (!m.name) { errors.push({ line: lineNo, error: 'name' }); return; }
      if (!L.validPrice(price)) { errors.push({ line: lineNo, error: 'price', value: String(get(cols, 'price')).slice(0, 30) }); return; }
      if (!status) { errors.push({ line: lineNo, error: 'status', value: String(get(cols, 'status')).slice(0, 30) }); return; }
      let med = matchMedicine(m);
      if (!med) { med = L.createMedicine(m, req.user.id, { verified: isAdmin ? 1 : 0 }); createdMeds++; }
      const prev = prevStmt.get(pid, med.id);
      if (prev && prev.price === price && prev.status === status) unchanged++;
      upsert.run(pid, med.id, price, status);
      touched.add(med.id);
      medIds.push(med.id);
      imported++;
    });
    if (missingAsOut && touched.size) {
      const ids = [...touched];
      const info = db.prepare(`UPDATE inventory SET status = 'out', updated_at = CURRENT_TIMESTAMP
        WHERE pharmacy_id = ? AND status != 'out' AND medicine_id NOT IN (${ids.map(() => '?').join(',')})`).run(pid, ...ids);
      markedOut = info.changes;
    }
    return { imported, skipped: errors.length, created_medicines: createdMeds, unchanged, marked_out: markedOut, errors: errors.slice(0, 50), medIds };
  })();

  L.audit(req, 'csv_import', 'pharmacy', pid, { imported: result.imported, skipped: result.skipped, created_medicines: result.created_medicines, marked_out: result.marked_out });
  changed(result.medIds);
  delete result.medIds;
  return res.json(result);
});

router.get('/pharmacies/:id/inventory/export', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const rows = db.prepare(`
    SELECT m.name, m.active_ingredient, m.manufacturer, m.dosage, m.category, i.price, i.status, m.prescription, i.updated_at
    FROM inventory i JOIN medicines m ON m.id = i.medicine_id WHERE i.pharmacy_id = ? ORDER BY m.name
  `).all(pid);
  const header = 'name,active_ingredient,manufacturer,dosage,category,price,status,prescription,updated_at';
  const body = rows.map(r => [r.name, r.active_ingredient, r.manufacturer, r.dosage, r.category, r.price, r.status, r.prescription, r.updated_at]
    .map(v => U.csvEscape(v)).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="ombor-${pid}-${U.dayKey()}.csv"`);
  res.send('﻿' + [header, ...body].join('\r\n') + '\r\n');
});

// =========================================================================
// STATISTIKA
// =========================================================================
router.get('/pharmacies/:id/stats', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const days = Math.min(Math.max(L.int(req.query.days) || 30, 7), 180);
  const since = U.dayKey(new Date(Date.now() - (days - 1) * 86400000));
  const totals = db.prepare(`
    SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(calls),0) AS calls, COALESCE(SUM(routes),0) AS routes, COALESCE(SUM(reservations),0) AS reservations
    FROM pharmacy_stats WHERE pharmacy_id = ? AND day >= ?
  `).get(pid, since);
  const series = db.prepare(`
    SELECT day, SUM(views) AS views, SUM(calls) AS calls, SUM(routes) AS routes, SUM(reservations) AS reservations
    FROM pharmacy_stats WHERE pharmacy_id = ? AND day >= ? GROUP BY day ORDER BY day
  `).all(pid, since);
  const top = db.prepare(`
    SELECT s.medicine_id, m.name, m.dosage, SUM(s.views) AS views, SUM(s.calls) AS calls, SUM(s.reservations) AS reservations
    FROM pharmacy_stats s JOIN medicines m ON m.id = s.medicine_id
    WHERE s.pharmacy_id = ? AND s.day >= ? AND s.medicine_id > 0
    GROUP BY s.medicine_id ORDER BY views DESC LIMIT 10
  `).all(pid, since);
  // Narxi eng arzon bo'lgan dorilar soni (raqobatbardoshlik)
  const cheapest = db.prepare(`
    SELECT COUNT(*) AS c FROM inventory i
    WHERE i.pharmacy_id = ? AND i.status != 'out' AND i.price <= (
      SELECT MIN(i2.price) FROM inventory i2 WHERE i2.medicine_id = i.medicine_id AND i2.status != 'out')
  `).get(pid).c;
  res.json({ days, since, totals, series, top, cheapest_count: cheapest });
});

// =========================================================================
// BRONLAR (dorixona tomoni)
// =========================================================================
router.get('/pharmacies/:id/reservations', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const status = ['pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'expired'].includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`
    SELECT * FROM reservations WHERE pharmacy_id = ? ${status ? 'AND status = ?' : "AND status IN ('pending', 'confirmed')"}
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, id DESC LIMIT 100
  `).all(...(status ? [pid, status] : [pid]));
  res.json({ reservations: rows.map(reservationView) });
});

const TRANSITIONS = { pending: ['confirmed', 'rejected'], confirmed: ['completed', 'expired', 'rejected'] };

router.post('/reservations/:id/status', ...ownerOrAdmin, (req, res) => {
  const id = L.int(req.params.id);
  const r = id && db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!r || !L.canManagePharmacy(req.user, r.pharmacy_id)) return res.fail(404, 'res.not_found');
  const next = req.body.status;
  if (!(TRANSITIONS[r.status] || []).includes(next)) return res.fail(400, 'res.bad_transition');
  const note = U.cleanStr(req.body.owner_note, 300);
  if (next === 'confirmed') {
    const hours = Math.min(Math.max(Number(req.body.hold_hours) || 3, 1), 72);
    db.prepare(`UPDATE reservations SET status = 'confirmed', owner_note = ?, hold_until = datetime('now', ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(note, `+${Math.round(hours * 60)} minutes`, id);
  } else {
    db.prepare('UPDATE reservations SET status = ?, owner_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, note || r.owner_note, id);
  }
  L.audit(req, 'reservation_' + next, 'reservation', id, { pharmacy_id: r.pharmacy_id });
  L.bus.emit('reservation:status', { id, status: next, by: 'pharmacy' });
  res.json({ reservation: reservationView(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)) });
});

// =========================================================================
// "NOTO'G'RI NARX" XABARLARI (dorixona tomoni)
// =========================================================================
router.get('/pharmacies/:id/reports', ...ownerOrAdmin, (req, res) => {
  const pid = pharmacyFor(req, res); if (!pid) return;
  const rows = db.prepare(`
    SELECT r.id, r.inventory_id, r.medicine_id, r.reported_price, r.reason, r.comment, r.status, r.created_at,
           m.name, m.dosage, i.price AS current_price, i.status AS current_status
    FROM price_reports r JOIN medicines m ON m.id = r.medicine_id LEFT JOIN inventory i ON i.id = r.inventory_id
    WHERE r.pharmacy_id = ? AND r.status = 'open' ORDER BY r.id DESC LIMIT 100
  `).all(pid);
  res.json({ reports: rows });
});

router.post('/reports/:id/resolve', ...ownerOrAdmin, (req, res) => {
  const id = L.int(req.params.id);
  const r = id && db.prepare('SELECT * FROM price_reports WHERE id = ?').get(id);
  if (!r || !L.canManagePharmacy(req.user, r.pharmacy_id)) return res.fail(404, 'report.not_found');
  const status = req.body.status === 'dismissed' ? 'dismissed' : 'resolved';
  db.prepare('UPDATE price_reports SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.user.id, id);
  L.audit(req, 'report_' + status, 'price_report', id, { pharmacy_id: r.pharmacy_id });
  res.json({ ok: true });
});

module.exports = router;
