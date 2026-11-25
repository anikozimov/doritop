'use strict';
// Loginsiz (ochiq) qidiruv route'lari

const express = require('express');
const db = require('../db');
const config = require('../config');
const U = require('../utils');
const L = require('../lib');
const tg = require('../telegram');
const { optionalAuth } = require('../auth');

const router = express.Router();

const eventLimiter = L.rateLimit({ windowMs: 60 * 1000, max: 60 });
const reportLimiter = L.rateLimit({ windowMs: 60 * 60 * 1000, max: 6, messageKey: 'report.too_many' });

// Bir foydalanuvchi bir dorini qayta-qayta ochsa ko'rishlar soni sun'iy oshmasligi uchun (30 daqiqa)
const viewSeen = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of viewSeen) if (t < now) viewSeen.delete(k);
}, 5 * 60 * 1000).unref();

function cityParam(req) {
  return U.cleanStr(req.query.city || 'all', 80) || 'all';
}

router.get('/health', (req, res) => {
  const count = (t) => db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get().count;
  res.json({ status: 'ok', counts: { pharmacies: count('pharmacies'), medicines: count('medicines'), inventory: count('inventory') } });
});

router.get('/config', (req, res) => {
  res.json({
    telegram: { enabled: tg.enabled(), bot: config.TELEGRAM_BOT_USERNAME },
    stale_days: config.STALE_DAYS,
    site_url: config.SITE_URL
  });
});

router.get('/cities', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT city FROM pharmacies ORDER BY city ASC').all();
  res.json({ cities: rows.map(r => r.city) });
});

router.get('/medicines/popular', (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.name, m.slug, m.dosage, m.prescription, COUNT(i.id) AS offers_count,
           MIN(CASE WHEN i.status != 'out' THEN i.price END) AS min_price
    FROM medicines m
    JOIN inventory i ON i.medicine_id = m.id
    GROUP BY m.id
    ORDER BY offers_count DESC, m.id DESC
    LIMIT 8
  `).all();
  res.json({ medicines: rows.map(L.medicineView) });
});

router.get('/medicines/autocomplete', (req, res) => {
  const q = U.cleanStr(req.query.q, 100);
  const city = cityParam(req);
  const rx = ['otc', 'rx'].includes(req.query.rx) ? req.query.rx : 'all';
  const clause = buildClause(q);
  const rxSql = rx === 'otc' ? 'AND m.prescription = 0' : rx === 'rx' ? 'AND m.prescription = 1' : '';

  const rows = db.prepare(`
    SELECT m.*,
           COUNT(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN 1 END) AS available_count,
           MIN(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN i.price END) AS min_price
    FROM medicines m
    LEFT JOIN inventory i ON i.medicine_id = m.id
    LEFT JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE ${clause.sql} ${rxSql}
    GROUP BY m.id
    ORDER BY available_count DESC, m.name ASC
    LIMIT 10
  `).all(city, city, city, city, ...clause.params);

  // Qidiruv statistikasi: faqat foydalanuvchi yozishni tugatganda (final=1) hisoblanadi
  if (req.query.final === '1' && q.length >= 2) {
    try { L.recordSearch(q, rows.some(r => r.available_count > 0)); } catch (_) {}
  }
  res.json({ medicines: rows.map(L.medicineView) });
});

function buildClause(q) {
  return L.buildSearchClause(q, ['m.name', 'm.active_ingredient', 'm.category']);
}

router.get('/medicines/by-slug/:slug', (req, res) => {
  const m = db.prepare('SELECT id, slug, name FROM medicines WHERE slug = ?').get(String(req.params.slug).slice(0, 120));
  if (!m) return res.fail(404, 'medicine.not_found');
  res.json({ medicine: m });
});

router.get('/medicines/:id/offers', optionalAuth, (req, res) => {
  const medId = L.int(req.params.id);
  if (!medId) return res.fail(400, 'medicine.bad_id');
  const med = db.prepare('SELECT * FROM medicines WHERE id = ?').get(medId);
  if (!med) return res.fail(404, 'medicine.not_found');

  const city = cityParam(req);
  const availableOnly = req.query.availableOnly === 'true';
  const openNowOnly = req.query.openNow === 'true';
  const is247Only = req.query.is247 === 'true';
  const verifiedOnly = req.query.verified === 'true';
  const priceMin = L.int(req.query.priceMin);
  const priceMax = L.int(req.query.priceMax);
  const sortBy = req.query.sort === 'distance' ? 'distance' : 'price';
  const userLat = req.query.lat !== undefined ? parseFloat(req.query.lat) : NaN;
  const userLng = req.query.lng !== undefined ? parseFloat(req.query.lng) : NaN;
  const hasLocation = U.validCoords(userLat, userLng);

  const rawOffers = db.prepare(`
    SELECT i.id AS inventory_id, i.price, i.status, i.updated_at,
           p.id AS pharmacy_id, p.name AS pharmacy_name, p.city, p.address,
           p.phone, p.phones, p.lat, p.lng, p.is_247, p.open_time, p.close_time, p.schedule,
           p.verified, p.logo_path
    FROM inventory i
    JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE i.medicine_id = ? AND (? = 'all' OR p.city = ?)
    LIMIT 500
  `).all(medId, city, city);

  const enrichedAll = rawOffers.map(r => {
    const v = L.pharmacyView(r);
    delete v.logo_path;
    return {
      ...v,
      distance_km: hasLocation ? U.haversineKm(userLat, userLng, r.lat, r.lng) : null,
      updated_days: U.daysSince(r.updated_at)
    };
  });

  const inStockAll = enrichedAll.filter(o => o.status !== 'out');
  const stats = {
    total_offers: enrichedAll.length,
    available_offers: inStockAll.length,
    min_price: inStockAll.length ? Math.min(...inStockAll.map(o => o.price)) : null,
    max_price: inStockAll.length ? Math.max(...inStockAll.map(o => o.price)) : null,
    avg_price: inStockAll.length
      ? Math.round(inStockAll.reduce((s, o) => s + o.price, 0) / inStockAll.length / 100) * 100
      : null
  };

  const filtered = enrichedAll.filter(o => {
    if (availableOnly && o.status === 'out') return false;
    if (openNowOnly && !o.open_now) return false;
    if (is247Only && !o.is_247) return false;
    if (verifiedOnly && !o.verified) return false;
    if (priceMin !== null && o.price < priceMin) return false;
    if (priceMax !== null && priceMax > 0 && o.price > priceMax) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'distance' && a.distance_km !== null && b.distance_km !== null) {
      return a.distance_km - b.distance_km;
    }
    const aOut = a.status === 'out' ? 1 : 0;
    const bOut = b.status === 'out' ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    return a.price - b.price;
  });

  const analogs = db.prepare(`
    SELECT m.*,
           COUNT(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN 1 END) AS available_count,
           MIN(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN i.price END) AS min_price
    FROM medicines m
    LEFT JOIN inventory i ON i.medicine_id = m.id
    LEFT JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE m.id != ? AND LOWER(TRIM(m.active_ingredient)) = LOWER(TRIM(?))
    GROUP BY m.id
    ORDER BY (min_price IS NULL), min_price ASC
    LIMIT 12
  `).all(city, city, city, city, medId, med.active_ingredient);

  // Ko'rishlar statistikasi (dorixona egalari uchun)
  const seenKey = `${L.ipKey(req)}:${medId}:${city}`;
  if (!viewSeen.has(seenKey) && filtered.length) {
    viewSeen.set(seenKey, Date.now() + 30 * 60 * 1000);
    try {
      db.transaction(() => { for (const o of filtered.slice(0, 50)) L.statInc(o.pharmacy_id, medId, 'view'); })();
    } catch (_) {}
  }

  let user_state;
  if (req.user) {
    const fav = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND medicine_id = ?').get(req.user.id, medId);
    const watches = db.prepare('SELECT kind FROM watches WHERE user_id = ? AND medicine_id = ?').all(req.user.id, medId).map(w => w.kind);
    user_state = { favorite: Boolean(fav), watches };
  }

  res.json({ medicine: L.medicineView(med), stats, offers: filtered, analogs: analogs.map(L.medicineView), user_state });
});

// Narx tarixi (kunlik eng arzon va o'rtacha narx)
router.get('/medicines/:id/price-history', (req, res) => {
  const medId = L.int(req.params.id);
  if (!medId) return res.fail(400, 'medicine.bad_id');
  const days = Math.min(Math.max(L.int(req.query.days) || 90, 7), 365);
  const city = cityParam(req);
  const since = U.dayKey(new Date(Date.now() - days * 86400000));
  const rows = db.prepare(`
    SELECT day, min_price, avg_price, offers FROM price_daily
    WHERE medicine_id = ? AND city = ? AND day >= ? ORDER BY day ASC
  `).all(medId, city, since);
  // Bugungi qiymat har doim jonli hisoblanadi
  const today = U.dayKey();
  const cur = L.currentMinPrice(medId, city);
  const points = rows.filter(r => r.day !== today);
  if (cur.offers > 0) points.push({ day: today, min_price: cur.min_price, avg_price: cur.avg_price, offers: cur.offers });
  res.json({ points });
});

// Savat: bir nechta dorining har bir dorixonadagi umumiy narxi
router.post('/cart/compare', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 30) : [];
  const wanted = new Map();
  for (const it of items) {
    const id = L.int(it.medicine_id);
    const qty = Math.min(Math.max(L.int(it.qty) || 1, 1), 99);
    if (id) wanted.set(id, qty);
  }
  if (!wanted.size) return res.json({ pharmacies: [], medicines: [] });
  const city = U.cleanStr(req.body.city || 'all', 80) || 'all';
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  const hasLoc = U.validCoords(lat, lng);
  const ids = [...wanted.keys()];
  const ph = ids.map(() => '?').join(',');

  const medicines = db.prepare(`SELECT id, name, dosage, slug, prescription FROM medicines WHERE id IN (${ph})`).all(...ids).map(L.medicineView);
  const rows = db.prepare(`
    SELECT i.medicine_id, i.price, i.status, i.updated_at,
           p.id AS pharmacy_id, p.name AS pharmacy_name, p.city, p.address, p.phone, p.phones, p.lat, p.lng,
           p.is_247, p.open_time, p.close_time, p.schedule, p.verified, p.logo_path
    FROM inventory i JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE i.medicine_id IN (${ph}) AND i.status != 'out' AND (? = 'all' OR p.city = ?)
  `).all(...ids, city, city);

  const byPh = new Map();
  for (const r of rows) {
    if (!byPh.has(r.pharmacy_id)) {
      const v = L.pharmacyView(r);
      byPh.set(r.pharmacy_id, {
        pharmacy_id: r.pharmacy_id, pharmacy_name: r.pharmacy_name, city: r.city, address: r.address,
        phone: r.phone, phones: v.phones, lat: r.lat, lng: r.lng, is_247: v.is_247, open_now: v.open_now, today: v.today,
        verified: v.verified, logo_url: v.logo_url,
        distance_km: hasLoc ? U.haversineKm(lat, lng, r.lat, r.lng) : null,
        items: [], total: 0
      });
    }
    const p = byPh.get(r.pharmacy_id);
    const qty = wanted.get(r.medicine_id);
    p.items.push({ medicine_id: r.medicine_id, price: r.price, qty, status: r.status, subtotal: r.price * qty });
    p.total += r.price * qty;
  }
  const list = [...byPh.values()].map(p => ({ ...p, found: p.items.length, missing: ids.length - p.items.length }));
  list.sort((a, b) => a.missing - b.missing || a.total - b.total);
  res.json({ pharmacies: list.slice(0, 50), medicines, requested: ids.length });
});

// Qo'ng'iroq / yo'nalish bosilganini hisoblash
router.post('/events', eventLimiter, (req, res) => {
  const type = req.body.type;
  if (!['call', 'route'].includes(type)) return res.fail(400, 'common.bad_request');
  const pid = L.int(req.body.pharmacy_id);
  const mid = L.int(req.body.medicine_id) || 0;
  if (!pid || !db.prepare('SELECT id FROM pharmacies WHERE id = ?').get(pid)) return res.fail(404, 'pharmacy.not_found');
  L.statInc(pid, mid, type);
  res.json({ ok: true });
});

// "Noto'g'ri narx" xabari (mehmon ham yubora oladi)
router.post('/reports', reportLimiter, optionalAuth, (req, res) => {
  const invId = L.int(req.body.inventory_id);
  const reason = req.body.reason;
  if (!['wrong_price', 'out_of_stock', 'closed', 'wrong_info', 'other'].includes(reason)) return res.fail(400, 'report.bad_reason');
  const inv = invId && db.prepare('SELECT * FROM inventory WHERE id = ?').get(invId);
  if (!inv) return res.fail(404, 'report.not_found');
  const key = L.ipKey(req);
  const dup = db.prepare("SELECT id FROM price_reports WHERE inventory_id = ? AND reporter_key = ? AND created_at > datetime('now', '-1 day')").get(invId, key);
  if (dup) return res.json({ ok: true, duplicate: true });
  const reported = L.int(req.body.reported_price);
  db.prepare(`
    INSERT INTO price_reports (inventory_id, pharmacy_id, medicine_id, reported_price, reason, comment, reporter_user_id, reporter_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(invId, inv.pharmacy_id, inv.medicine_id, reported !== null && L.validPrice(reported) ? reported : null,
    reason, U.cleanStr(req.body.comment, 300), req.user ? req.user.id : null, key);
  L.bus.emit('report:created', { pharmacy_id: inv.pharmacy_id, medicine_id: inv.medicine_id, reason });
  res.status(201).json({ ok: true });
});

// CSV shablon (Excel'da o'zbekcha harflar to'g'ri ochilishi uchun BOM bilan)
router.get('/csv-template', (req, res) => {
  const csv = '﻿' + [
    'name,active_ingredient,manufacturer,dosage,category,price,status,prescription',
    'Paratsetamol,Paratsetamol,,500 mg tabletka,Og‘riq qoldiruvchi,3500,available,0',
    'Amoksitsillin,Amoksitsillin,,500 mg kapsula,Antibiotik,18000,low,1',
    'Ibuprofen,Ibuprofen,,200 mg tabletka,Og‘riq qoldiruvchi,6000,out,0'
  ].join('\r\n') + '\r\n';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="dori-top-shablon.csv"');
  res.send(csv);
});

module.exports = router;
