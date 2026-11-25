'use strict';
// Login qilgan foydalanuvchi route'lari: arizalar, sevimlilar, kuzatuv, bron

const express = require('express');
const db = require('../db');
const U = require('../utils');
const L = require('../lib');
const { requireAuth } = require('../auth');

const router = express.Router();

const MAX_ACTIVE_RES = 3;
const MAX_RES_PER_DAY = 10;
const MAX_FAVORITES = 200;
const MAX_WATCHES = 50;

// =========================================================================
// DORIXONA ARIZALARI (oddiy foydalanuvchi / ega -> admin tasdiqlaydi)
// =========================================================================
router.get('/my/pharmacy-requests', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM pharmacy_requests WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ requests: rows.map(r => ({ ...r, is_247: Boolean(r.is_247) })) });
});

router.post('/pharmacy-requests', requireAuth, (req, res) => {
  const v = L.validatePharmacy(req.body, { requireLicense: true });
  if (v.error) return res.fail(400, v.error);
  const d = v.value;

  if (db.prepare("SELECT id FROM pharmacy_requests WHERE user_id = ? AND status = 'pending'").get(req.user.id)) {
    return res.fail(409, 'request.already_pending');
  }
  if (L.licenseTaken(d.license_number)) return res.fail(409, 'request.license_taken');

  let id;
  try {
    id = Number(db.prepare(`
      INSERT INTO pharmacy_requests (user_id, name, license_number, city, address, phone, lat, lng, is_247, open_time, close_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, d.name, d.license_number, d.city, d.address, d.phone, d.lat, d.lng, d.is_247, d.open_time, d.close_time).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return res.fail(409, 'request.already_pending');
    throw err;
  }
  L.bus.emit('request:created', { id });
  const created = db.prepare('SELECT * FROM pharmacy_requests WHERE id = ?').get(id);
  return res.status(201).json({ request: { ...created, is_247: Boolean(created.is_247) } });
});

// =========================================================================
// SEVIMLILAR
// =========================================================================
router.get('/my/favorites', requireAuth, (req, res) => {
  const city = U.cleanStr(req.query.city || 'all', 80) || 'all';
  const rows = db.prepare(`
    SELECT m.id, m.name, m.slug, m.dosage, m.active_ingredient, m.manufacturer, m.prescription, f.created_at,
           MIN(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN i.price END) AS min_price,
           COUNT(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN 1 END) AS available_count
    FROM favorites f
    JOIN medicines m ON m.id = f.medicine_id
    LEFT JOIN inventory i ON i.medicine_id = m.id
    LEFT JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE f.user_id = ?
    GROUP BY m.id
    ORDER BY f.created_at DESC
  `).all(city, city, city, city, req.user.id);
  const watches = db.prepare('SELECT medicine_id, kind, city FROM watches WHERE user_id = ?').all(req.user.id);
  res.json({ favorites: rows.map(r => ({ ...L.medicineView(r), watches: watches.filter(w => w.medicine_id === r.id).map(w => w.kind) })) });
});

router.put('/my/favorites/:medId', requireAuth, (req, res) => {
  const mid = L.int(req.params.medId);
  if (!mid || !db.prepare('SELECT id FROM medicines WHERE id = ?').get(mid)) return res.fail(404, 'medicine.not_found');
  const count = db.prepare('SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?').get(req.user.id).c;
  if (count >= MAX_FAVORITES) return res.fail(400, 'fav.limit');
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, medicine_id) VALUES (?, ?)').run(req.user.id, mid);
  res.json({ favorite: true });
});

router.delete('/my/favorites/:medId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND medicine_id = ?').run(req.user.id, L.int(req.params.medId));
  res.json({ favorite: false });
});

// =========================================================================
// KUZATUV: "kelganda xabar ber" (available) va "narx tushsa" (price) — Telegram orqali
// =========================================================================
router.put('/my/watches', requireAuth, (req, res) => {
  const mid = L.int(req.body.medicine_id);
  const kind = req.body.kind;
  const city = U.cleanStr(req.body.city || 'all', 80) || 'all';
  if (!['available', 'price'].includes(kind)) return res.fail(400, 'common.bad_request');
  if (!mid || !db.prepare('SELECT id FROM medicines WHERE id = ?').get(mid)) return res.fail(404, 'medicine.not_found');
  if (!req.user.telegram_chat_id) return res.fail(400, 'watch.need_telegram');
  const count = db.prepare('SELECT COUNT(*) AS c FROM watches WHERE user_id = ?').get(req.user.id).c;
  if (count >= MAX_WATCHES) return res.fail(400, 'watch.limit');
  const cur = L.currentMinPrice(mid, city);
  db.prepare(`
    INSERT INTO watches (user_id, medicine_id, city, kind, last_min_price) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(req.user.id, mid, city, kind, cur.min_price ?? null);
  res.json({ watching: true, available_now: cur.offers > 0 });
});

router.delete('/my/watches', requireAuth, (req, res) => {
  const mid = L.int(req.body.medicine_id ?? req.query.medicine_id);
  const kind = req.body.kind ?? req.query.kind;
  db.prepare('DELETE FROM watches WHERE user_id = ? AND medicine_id = ? AND kind = ?').run(req.user.id, mid, kind);
  res.json({ watching: false });
});

// =========================================================================
// BRON QILISH
// =========================================================================
function reservationView(r) {
  const items = db.prepare('SELECT medicine_id, name, qty, price FROM reservation_items WHERE reservation_id = ?').all(r.id);
  return { ...r, items };
}

router.post('/reservations', requireAuth, (req, res) => {
  const pid = L.int(req.body.pharmacy_id);
  const ph = pid && db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pid);
  if (!ph) return res.fail(404, 'pharmacy.not_found');
  if (ph.owner_id === req.user.id) return res.fail(400, 'res.own_pharmacy');

  const rawItems = Array.isArray(req.body.items) ? req.body.items.slice(0, 20) : [];
  const items = [];
  for (const it of rawItems) {
    const mid = L.int(it.medicine_id);
    const qty = L.int(it.qty) || 1;
    if (!mid || qty < 1 || qty > 20) return res.fail(400, 'res.bad_items');
    if (items.some(x => x.medicine_id === mid)) continue;
    const inv = db.prepare(`
      SELECT i.price, i.status, m.name, m.dosage FROM inventory i JOIN medicines m ON m.id = i.medicine_id
      WHERE i.pharmacy_id = ? AND i.medicine_id = ?
    `).get(pid, mid);
    if (!inv || inv.status === 'out') return res.fail(409, 'res.item_unavailable', { name: inv ? inv.name : '#' + mid });
    items.push({ medicine_id: mid, qty, price: inv.price, name: `${inv.name}${inv.dosage ? ' ' + inv.dosage : ''}`.slice(0, 200) });
  }
  if (!items.length) return res.fail(400, 'res.bad_items');

  const active = db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE user_id = ? AND status IN ('pending', 'confirmed')").get(req.user.id).c;
  if (active >= MAX_ACTIVE_RES) return res.fail(429, 'res.too_many_active', { n: MAX_ACTIVE_RES });
  const today = db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE user_id = ? AND created_at > datetime('now', '-1 day')").get(req.user.id).c;
  if (today >= MAX_RES_PER_DAY) return res.fail(429, 'res.too_many_today');

  const name = U.cleanStr(req.body.customer_name || req.user.full_name, 100);
  const phone = U.cleanStr(req.body.customer_phone || req.user.phone, 30);
  if (name.length < 2 || phone.replace(/\D/g, '').length < 9) return res.fail(400, 'res.bad_contact');
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);

  const id = db.transaction(() => {
    let code;
    do { code = U.randomCode(6); } while (db.prepare('SELECT id FROM reservations WHERE code = ?').get(code));
    const rid = Number(db.prepare(`
      INSERT INTO reservations (code, user_id, pharmacy_id, customer_name, customer_phone, note, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, req.user.id, pid, name, phone, U.cleanStr(req.body.note, 300), total).lastInsertRowid);
    const ins = db.prepare('INSERT INTO reservation_items (reservation_id, medicine_id, name, qty, price) VALUES (?, ?, ?, ?, ?)');
    for (const it of items) ins.run(rid, it.medicine_id, it.name, it.qty, it.price);
    for (const it of items) L.statInc(pid, it.medicine_id, 'reservation');
    return rid;
  })();
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  L.bus.emit('reservation:created', { id });
  res.status(201).json({ reservation: reservationView(r) });
});

router.get('/my/reservations', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, p.name AS pharmacy_name, p.address, p.city, p.phone AS pharmacy_phone, p.lat, p.lng
    FROM reservations r JOIN pharmacies p ON p.id = r.pharmacy_id
    WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 50
  `).all(req.user.id);
  res.json({ reservations: rows.map(reservationView) });
});

router.post('/reservations/:id/cancel', requireAuth, (req, res) => {
  const id = L.int(req.params.id);
  const info = db.prepare(`
    UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND status IN ('pending', 'confirmed')
  `).run(id, req.user.id);
  if (!info.changes) return res.fail(404, 'res.not_found');
  L.bus.emit('reservation:status', { id, status: 'cancelled', by: 'user' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.reservationView = reservationView;
