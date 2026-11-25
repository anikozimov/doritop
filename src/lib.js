'use strict';
// Route'lar o'rtasida umumiy yordamchi funksiyalar

const crypto = require('crypto');
const { EventEmitter } = require('events');
const db = require('./db');
const U = require('./utils');
const { SERVER_KEY } = require('./auth');

const bus = new EventEmitter();
bus.setMaxListeners(50);

const ROLES = ['user', 'pharmacy_owner', 'admin'];
const STATUSES = ['available', 'low', 'out'];
const MAX_PRICE = 100000000;
const MAX_CSV_ROWS = 2000;

function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function int(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}

function jsonParse(s, def) {
  try { return JSON.parse(s); } catch (_) { return def; }
}

// ---------------------------------------------------------------- rate limit (xotirada)
function rateLimit({ windowMs, max, key = (req) => req.ip, messageKey = 'common.too_many' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.min(windowMs, 60000)).unref();
  const mw = (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let rec = hits.get(k);
    if (!rec || rec.reset <= now) { rec = { count: 0, reset: now + windowMs }; hits.set(k, rec); }
    rec.count++;
    if (rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.reset - now) / 1000)));
      return res.fail(429, messageKey);
    }
    return next();
  };
  mw.reset = () => hits.clear();
  return mw;
}

// IP manzilni ochiq saqlamaslik uchun HMAC xesh
function ipKey(req) {
  return crypto.createHmac('sha256', SERVER_KEY).update(String(req.ip || '')).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------- audit
function audit(req, action, entity, entityId, details = {}, asUserId = undefined) {
  try {
    const uid = asUserId !== undefined ? asUserId : (req && req.user ? req.user.id : null);
    db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, action, entity, entityId ?? null, JSON.stringify(details).slice(0, 4000), req ? String(req.ip || '') : '');
  } catch (err) {
    console.error('[audit] yozib bo‘lmadi:', err.message);
  }
}

// ---------------------------------------------------------------- dorixona
function pharmacyView(p) {
  const phones = jsonParse(p.phones || '[]', []);
  return {
    ...p,
    is_247: Boolean(p.is_247),
    verified: Boolean(p.verified),
    phones: Array.isArray(phones) ? phones : [],
    schedule: U.parseSchedule(p.schedule),
    open_now: U.isOpenNow(p),
    today: U.todayHours(p),
    logo_url: p.logo_path ? `/uploads/${p.logo_path}` : ''
  };
}

// Dorixona maydonlarini tekshiradi va tozalaydi. { value } yoki { error } qaytaradi.
function validatePharmacy(input, { requireLicense }) {
  const name = U.cleanStr(input.name, 120);
  const license = U.cleanStr(input.license_number, 60);
  const city = U.cleanStr(input.city, 80);
  const address = U.cleanStr(input.address, 200);
  const phone = U.cleanStr(input.phone, 30);
  const lat = typeof input.lat === 'number' ? input.lat : parseFloat(input.lat);
  const lng = typeof input.lng === 'number' ? input.lng : parseFloat(input.lng);
  const is247 = toBool(input.is_247) ? 1 : 0;
  const open = U.normalizeTime(input.open_time || '08:00');
  const close = U.normalizeTime(input.close_time || '22:00');

  if (name.length < 2 || !city || address.length < 3 || !phone) return { error: 'pharmacy.required_fields' };
  if (requireLicense && !license) return { error: 'pharmacy.license_required' };
  if (phone.replace(/\D/g, '').length < 5) return { error: 'pharmacy.bad_phone' };
  if (!U.validCoords(lat, lng)) return { error: 'pharmacy.bad_coords' };
  if (!open || !close) return { error: 'pharmacy.bad_time' };

  let phones;
  if (input.phones !== undefined) {
    phones = U.parsePhones(input.phones);
    if (phones === null) return { error: 'pharmacy.bad_phone' };
  }
  let schedule;
  if (input.schedule !== undefined) {
    if (input.schedule === null || input.schedule === '') schedule = '';
    else {
      const s = U.parseSchedule(input.schedule);
      if (!s) return { error: 'pharmacy.bad_schedule' };
      schedule = JSON.stringify(s);
    }
  }
  return {
    value: {
      name, license_number: license, city, address, phone, lat, lng, is_247: is247, open_time: open, close_time: close,
      phones: phones === undefined ? undefined : JSON.stringify(phones),
      schedule
    }
  };
}

function licenseTaken(license, { exceptPharmacyId = null } = {}) {
  if (!license) return false;
  const inPharmacies = db.prepare('SELECT id FROM pharmacies WHERE LOWER(license_number) = LOWER(?) AND id != ?')
    .get(license, exceptPharmacyId ?? -1);
  if (inPharmacies) return true;
  if (exceptPharmacyId !== null) return false;
  return Boolean(db.prepare("SELECT id FROM pharmacy_requests WHERE LOWER(license_number) = LOWER(?) AND status IN ('pending', 'approved')").get(license));
}

function canManagePharmacy(user, pharmacyId) {
  if (!Number.isInteger(pharmacyId)) return false;
  if (user.role === 'admin') return Boolean(db.prepare('SELECT id FROM pharmacies WHERE id = ?').get(pharmacyId));
  return Boolean(db.prepare('SELECT id FROM pharmacies WHERE id = ? AND owner_id = ?').get(pharmacyId, user.id));
}

// ---------------------------------------------------------------- dorilar
function cleanMedicine(input) {
  return {
    name: U.cleanStr(input.name, 150),
    active_ingredient: U.cleanStr(input.active_ingredient, 150),
    manufacturer: U.cleanStr(input.manufacturer, 100),
    dosage: U.cleanStr(input.dosage, 60),
    category: U.cleanStr(input.category, 60) || 'Umumiy',
    prescription: toBool(input.prescription) ? 1 : 0
  };
}

function medicineView(m) {
  return m ? { ...m, prescription: Boolean(m.prescription), verified: m.verified === undefined ? true : Boolean(m.verified) } : m;
}

function uniqueSlug(name, dosage, exceptId = null) {
  const base = U.slugify(`${name} ${dosage || ''}`) || 'dori';
  let slug = base;
  for (let i = 2; db.prepare('SELECT id FROM medicines WHERE slug = ? AND id != ?').get(slug, exceptId ?? -1); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

function findExactMedicine(m, exceptId = -1) {
  return db.prepare(`
    SELECT * FROM medicines
    WHERE id != ? AND LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(dosage)) = LOWER(?) AND LOWER(TRIM(manufacturer)) = LOWER(?)
  `).get(exceptId, m.name, m.dosage, m.manufacturer);
}

// Yozilishi boshqacha, lekin bir xil bo'lishi mumkin bo'lgan dorilar ("Paracetamol" ~ "paratsetamol")
function findSimilarMedicines(m, limit = 5) {
  const key = U.normKey(m.name);
  if (!key) return [];
  const doseKey = U.normKey(m.dosage);
  return db.prepare('SELECT * FROM medicines WHERE name_norm = ? LIMIT 20').all(key)
    .filter(r => !doseKey || !U.normKey(r.dosage) || U.normKey(r.dosage) === doseKey)
    .slice(0, limit)
    .map(medicineView);
}

function createMedicine(m, userId, { verified = 1 } = {}) {
  const info = db.prepare(`
    INSERT INTO medicines (name, active_ingredient, manufacturer, dosage, category, prescription, created_by, slug, name_norm, verified, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(m.name, m.active_ingredient, m.manufacturer, m.dosage, m.category, m.prescription, userId,
    uniqueSlug(m.name, m.dosage), U.normKey(m.name), verified ? 1 : 0);
  return db.prepare('SELECT * FROM medicines WHERE id = ?').get(Number(info.lastInsertRowid));
}

// Katta-kichik harfga e'tiborsiz dublikatni topadi, bo'lmasa yaratadi.
function findOrCreateMedicine(m, userId, opts) {
  const existing = findExactMedicine(m);
  if (existing) return { medicine: existing, created: false };
  return { medicine: createMedicine(m, userId, opts), created: true };
}

function buildSearchClause(q, columns) {
  const variants = U.searchVariants(q);
  if (!variants.length) return { sql: '1 = 1', params: [] };
  const conds = [];
  const params = [];
  for (const v of variants) {
    const pattern = `%${U.escapeLike(v)}%`;
    for (const col of columns) {
      conds.push(`LOWER(${col}) LIKE LOWER(?) ESCAPE '\\'`);
      params.push(pattern);
    }
  }
  // Yozilishdagi farqlarga chidamli qidiruv (paracetamol ~ paratsetamol)
  const key = U.normKey(q);
  if (key.length >= 3 && columns.includes('m.name')) {
    conds.push("m.name_norm LIKE ? ESCAPE '\\'");
    params.push(`${U.escapeLike(key)}%`);
  }
  return { sql: '(' + conds.join(' OR ') + ')', params };
}

function paging(req, defLimit = 50, maxLimit = 200) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defLimit, 1), maxLimit);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  return { limit, offset };
}

function findUserByRef({ id, phone }) {
  if (id !== undefined && id !== null && id !== '') {
    const uid = parseInt(id, 10);
    if (Number.isInteger(uid)) return db.prepare('SELECT id, full_name, phone, role, telegram_chat_id FROM users WHERE id = ?').get(uid);
  }
  if (phone) {
    const p = U.normalizePhone(phone);
    return db.prepare('SELECT id, full_name, phone, role, telegram_chat_id FROM users WHERE phone = ? OR phone = ?').get(p, U.legacyNormalizePhone(phone));
  }
  return undefined;
}

function adminCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND blocked_at IS NULL").get().c;
}

// ---------------------------------------------------------------- ombor
const upsertInvStmt = () => db.prepare(`
  INSERT INTO inventory (pharmacy_id, medicine_id, price, status, updated_at)
  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(pharmacy_id, medicine_id)
  DO UPDATE SET price = excluded.price, status = excluded.status, updated_at = CURRENT_TIMESTAMP
`);

function validPrice(price) {
  return Number.isInteger(price) && price >= 0 && price <= MAX_PRICE;
}

// ---------------------------------------------------------------- statistika
const statCols = { view: 'views', call: 'calls', route: 'routes', reservation: 'reservations' };
function statInc(pharmacyId, medicineId, type, n = 1) {
  const col = statCols[type];
  if (!col) return;
  db.prepare(`
    INSERT INTO pharmacy_stats (pharmacy_id, medicine_id, day, ${col}) VALUES (?, ?, ?, ?)
    ON CONFLICT(pharmacy_id, medicine_id, day) DO UPDATE SET ${col} = ${col} + excluded.${col}
  `).run(pharmacyId, medicineId || 0, U.dayKey(), n);
}

function recordSearch(term, found) {
  const t = U.cleanStr(term, 60).toLowerCase();
  if (t.length < 2) return;
  db.prepare(`
    INSERT INTO search_stats (term, day, searches, zero_results) VALUES (?, ?, 1, ?)
    ON CONFLICT(term, day) DO UPDATE SET searches = searches + 1, zero_results = zero_results + excluded.zero_results
  `).run(t, U.dayKey(), found ? 0 : 1);
}

// Dorining joriy eng arzon narxi (city = 'all' yoki shahar)
function currentMinPrice(medicineId, city = 'all') {
  const r = db.prepare(`
    SELECT MIN(i.price) AS min_price, COUNT(*) AS offers, CAST(AVG(i.price) AS INTEGER) AS avg_price
    FROM inventory i JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE i.medicine_id = ? AND i.status != 'out' AND (? = 'all' OR p.city = ?)
  `).get(medicineId, city, city);
  return r;
}

module.exports = {
  bus, ROLES, STATUSES, MAX_PRICE, MAX_CSV_ROWS,
  toBool, int, jsonParse, rateLimit, ipKey, audit,
  pharmacyView, validatePharmacy, licenseTaken, canManagePharmacy,
  cleanMedicine, medicineView, uniqueSlug, findExactMedicine, findSimilarMedicines, createMedicine, findOrCreateMedicine,
  buildSearchClause, paging, findUserByRef, adminCount,
  upsertInvStmt, validPrice, statInc, recordSearch, currentMinPrice
};
