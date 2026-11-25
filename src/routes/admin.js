'use strict';
// ADMIN PANEL ('admin')

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const U = require('../utils');
const L = require('../lib');
const notify = require('../notify');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin')];

function staleSql() {
  return `
    SELECT p.id, p.name, p.city, p.address, p.verified, p.last_reminded_at, p.owner_id,
           u.full_name AS owner_name, u.phone AS owner_phone, (u.telegram_chat_id IS NOT NULL) AS owner_telegram,
           COUNT(i.id) AS inventory_count, MAX(i.updated_at) AS last_update
    FROM pharmacies p JOIN users u ON u.id = p.owner_id
    LEFT JOIN inventory i ON i.pharmacy_id = p.id
    GROUP BY p.id
    HAVING last_update IS NULL OR last_update < datetime('now', ?)
    ORDER BY (last_update IS NULL) DESC, last_update ASC`;
}

router.get('/overview', ...adminOnly, (req, res) => {
  const count = (sql, ...p) => db.prepare(sql).get(...p).c;
  const stats = {
    users: count('SELECT COUNT(*) AS c FROM users'),
    blocked_users: count('SELECT COUNT(*) AS c FROM users WHERE blocked_at IS NOT NULL'),
    pharmacies: count('SELECT COUNT(*) AS c FROM pharmacies'),
    verified_pharmacies: count('SELECT COUNT(*) AS c FROM pharmacies WHERE verified = 1'),
    pending_requests: count("SELECT COUNT(*) AS c FROM pharmacy_requests WHERE status = 'pending'"),
    medicines: count('SELECT COUNT(*) AS c FROM medicines'),
    unverified_medicines: count('SELECT COUNT(*) AS c FROM medicines WHERE verified = 0'),
    inventory: count('SELECT COUNT(*) AS c FROM inventory'),
    open_reports: count("SELECT COUNT(*) AS c FROM price_reports WHERE status = 'open'"),
    stale_pharmacies: db.prepare(`SELECT COUNT(*) AS c FROM (${staleSql()})`).get(`-${config.STALE_DAYS} days`).c,
    active_reservations: count("SELECT COUNT(*) AS c FROM reservations WHERE status IN ('pending', 'confirmed')")
  };
  const requests = db.prepare(`
    SELECT r.*, u.full_name AS owner_name, u.phone AS owner_phone
    FROM pharmacy_requests r JOIN users u ON u.id = r.user_id
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.id DESC LIMIT 100
  `).all();
  res.json({ stats, requests, stale_days: config.STALE_DAYS, telegram_enabled: require('../telegram').enabled() });
});

// =========================================================================
// ARIZALAR
// =========================================================================
router.post('/requests/:id/approve', ...adminOnly, (req, res) => {
  const reqId = L.int(req.params.id);
  const appReq = reqId && db.prepare('SELECT * FROM pharmacy_requests WHERE id = ?').get(reqId);
  if (!appReq) return res.fail(404, 'request.not_found');
  if (appReq.status !== 'pending') return res.fail(400, 'request.already_reviewed');
  if (db.prepare('SELECT id FROM pharmacies WHERE LOWER(license_number) = LOWER(?)').get(appReq.license_number)) {
    return res.fail(409, 'request.license_exists');
  }
  // Litsenziya tekshirilgan bo'lsa "tasdiqlangan" belgisi darhol qo'yiladi (standart: ha)
  const verified = req.body.verified === undefined ? 1 : (L.toBool(req.body.verified) ? 1 : 0);
  const pid = db.transaction(() => {
    db.prepare("UPDATE pharmacy_requests SET status = 'approved', admin_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(U.cleanStr(req.body.admin_note, 300) || 'Tasdiqlandi', reqId);
    const id = Number(db.prepare(`
      INSERT INTO pharmacies (owner_id, name, license_number, city, address, phone, lat, lng, is_247, open_time, close_time, verified, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP END)
    `).run(appReq.user_id, appReq.name, appReq.license_number, appReq.city, appReq.address, appReq.phone, appReq.lat, appReq.lng,
      appReq.is_247, appReq.open_time, appReq.close_time, verified, verified).lastInsertRowid);
    db.prepare("UPDATE users SET role = 'pharmacy_owner' WHERE id = ? AND role = 'user'").run(appReq.user_id);
    return id;
  })();
  L.audit(req, 'approve', 'pharmacy_request', reqId, { pharmacy_id: pid, verified });
  L.bus.emit('request:reviewed', { id: reqId, status: 'approved' });
  return res.json({ approved: true, pharmacy_id: pid });
});

router.post('/requests/:id/reject', ...adminOnly, (req, res) => {
  const reqId = L.int(req.params.id);
  const note = U.cleanStr(req.body.admin_note, 300) || 'Litsenziya yoki ma\'lumotlar tasdiqlanmadi.';
  const info = db.prepare(`
    UPDATE pharmacy_requests SET status = 'rejected', admin_note = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `).run(note, reqId);
  if (!info.changes) return res.fail(404, 'request.pending_not_found');
  L.audit(req, 'reject', 'pharmacy_request', reqId, { note });
  L.bus.emit('request:reviewed', { id: reqId, status: 'rejected' });
  return res.json({ rejected: true });
});

// =========================================================================
// FOYDALANUVCHILAR
// =========================================================================
router.get('/users', ...adminOnly, (req, res) => {
  const { limit, offset } = L.paging(req, 50, 200);
  const conds = ['1 = 1'];
  const params = [];
  const q = U.cleanStr(req.query.q, 60);
  if (q) {
    conds.push("(LOWER(u.full_name) LIKE LOWER(?) ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')");
    params.push(`%${U.escapeLike(q)}%`, `%${U.escapeLike(q.replace(/[^\d+]/g, '') || q)}%`);
  }
  if (L.ROLES.includes(req.query.role)) { conds.push('u.role = ?'); params.push(req.query.role); }
  if (req.query.blocked === '1') conds.push('u.blocked_at IS NOT NULL');
  const where = conds.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM users u WHERE ${where}`).get(...params).c;
  const users = db.prepare(`
    SELECT u.id, u.full_name, u.phone, u.role, u.created_at, u.last_login_at, u.blocked_at, u.blocked_reason,
           (u.telegram_chat_id IS NOT NULL) AS telegram_linked, u.totp_enabled,
           (SELECT COUNT(*) FROM pharmacies p WHERE p.owner_id = u.id) AS pharmacy_count
    FROM users u WHERE ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset).map(u => ({ ...u, telegram_linked: Boolean(u.telegram_linked), totp_enabled: Boolean(u.totp_enabled) }));
  res.json({ users, total, limit, offset });
});

function guardTarget(req, res, targetId, { allowSelf = false } = {}) {
  const target = db.prepare('SELECT id, role, full_name, blocked_at FROM users WHERE id = ?').get(targetId);
  if (!target) { res.fail(404, 'user.not_found'); return null; }
  if (!allowSelf && target.id === req.user.id) { res.fail(400, 'user.not_self'); return null; }
  return target;
}

// Egasi tushirilganda / o'chirilganda dorixonalar taqdiri: keep | delete | transfer
function handlePharmacies(req, res, targetId, { forDelete }) {
  const pharmacyCount = db.prepare('SELECT COUNT(*) AS c FROM pharmacies WHERE owner_id = ?').get(targetId).c;
  if (!pharmacyCount) return { ok: true, pharmacyCount };
  const action = req.body.pharmacy_action;
  const allowed = forDelete ? ['delete', 'transfer'] : ['keep', 'delete', 'transfer'];
  if (!allowed.includes(action)) {
    res.fail(409, 'user.pharmacies_decision', { n: pharmacyCount }, { needs_decision: true, pharmacy_count: pharmacyCount, allowed });
    return null;
  }
  let newOwner = null;
  if (action === 'transfer') {
    newOwner = L.findUserByRef({ id: req.body.transfer_to_id, phone: req.body.transfer_to_phone });
    if (!newOwner) { res.fail(404, 'user.transfer_target_not_found'); return null; }
    if (newOwner.id === targetId) { res.fail(400, 'user.transfer_other'); return null; }
  }
  return { ok: true, pharmacyCount, action, newOwner };
}

function applyPharmacyAction(targetId, decision) {
  if (decision.action === 'delete') {
    db.prepare('DELETE FROM pharmacies WHERE owner_id = ?').run(targetId);
  } else if (decision.action === 'transfer' && decision.newOwner) {
    db.prepare('UPDATE pharmacies SET owner_id = ?, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?').run(decision.newOwner.id, targetId);
    db.prepare("UPDATE users SET role = 'pharmacy_owner' WHERE id = ? AND role = 'user'").run(decision.newOwner.id);
  }
}

router.patch('/users/:id/role', ...adminOnly, (req, res) => {
  const targetId = L.int(req.params.id);
  const role = req.body.role;
  if (!L.ROLES.includes(role)) return res.fail(400, 'user.bad_role');
  const target = guardTarget(req, res, targetId, { allowSelf: true }); if (!target) return;
  if (targetId === req.user.id && role !== 'admin') return res.fail(400, 'user.not_self_demote');
  if (target.role === 'admin' && role !== 'admin' && L.adminCount() <= 1) return res.fail(400, 'user.last_admin');

  let decision = { ok: true, pharmacyCount: db.prepare('SELECT COUNT(*) AS c FROM pharmacies WHERE owner_id = ?').get(targetId).c };
  if (role === 'user') { decision = handlePharmacies(req, res, targetId, { forDelete: false }); if (!decision) return; }

  db.transaction(() => {
    applyPharmacyAction(targetId, decision);
    // Rol har so'rovda bazadan o'qiladi, shuning uchun o'zgarish darhol kuchga kiradi
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  })();
  L.audit(req, 'role_change', 'user', targetId, { from: target.role, to: role, pharmacy_action: decision.action || null, transfer_to: decision.newOwner ? decision.newOwner.id : null });

  const body = { updated: true };
  if (role === 'pharmacy_owner' && decision.pharmacyCount === 0) body.warning = 'no_pharmacy';
  return res.json(body);
});

router.post('/users/:id/block', ...adminOnly, (req, res) => {
  const targetId = L.int(req.params.id);
  const target = guardTarget(req, res, targetId); if (!target) return;
  if (target.role === 'admin' && L.adminCount() <= 1) return res.fail(400, 'user.last_admin');
  const reason = U.cleanStr(req.body.reason, 300);
  db.prepare('UPDATE users SET blocked_at = CURRENT_TIMESTAMP, blocked_reason = ?, token_version = token_version + 1 WHERE id = ?').run(reason, targetId);
  // Bloklangan foydalanuvchining faol bronlari bekor qilinadi
  db.prepare("UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status IN ('pending', 'confirmed')").run(targetId);
  L.audit(req, 'block', 'user', targetId, { reason });
  res.json({ blocked: true });
});

router.post('/users/:id/unblock', ...adminOnly, (req, res) => {
  const targetId = L.int(req.params.id);
  const target = guardTarget(req, res, targetId); if (!target) return;
  db.prepare("UPDATE users SET blocked_at = NULL, blocked_reason = '' WHERE id = ?").run(targetId);
  L.audit(req, 'unblock', 'user', targetId);
  res.json({ blocked: false });
});

router.delete('/users/:id', ...adminOnly, (req, res) => {
  const targetId = L.int(req.params.id);
  const target = guardTarget(req, res, targetId); if (!target) return;
  if (target.role === 'admin' && L.adminCount() <= 1) return res.fail(400, 'user.last_admin');
  const decision = handlePharmacies(req, res, targetId, { forDelete: true }); if (!decision) return;
  db.transaction(() => {
    applyPharmacyAction(targetId, decision);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  })();
  L.audit(req, 'delete', 'user', targetId, { name: target.full_name, pharmacy_action: decision.action || null });
  res.json({ deleted: true });
});

// Vaqtinchalik parol (bir marta ko'rsatiladi; foydalanuvchi kirgach o'zgartirishi so'raladi)
router.post('/users/:id/reset-password', ...adminOnly, async (req, res) => {
  const targetId = L.int(req.params.id);
  const target = guardTarget(req, res, targetId); if (!target) return;
  const temp = crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(temp, 11);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?').run(hash, targetId);
  L.audit(req, 'password_reset_admin', 'user', targetId);
  res.json({ temp_password: temp });
});

router.post('/users/:id/reset-2fa', ...adminOnly, (req, res) => {
  const targetId = L.int(req.params.id);
  const target = guardTarget(req, res, targetId); if (!target) return;
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, token_version = token_version + 1 WHERE id = ?').run(targetId);
  L.audit(req, '2fa_reset_admin', 'user', targetId);
  res.json({ ok: true });
});

// =========================================================================
// DORIXONALAR
// =========================================================================
router.get('/pharmacies', ...adminOnly, (req, res) => {
  const { limit, offset } = L.paging(req, 50, 200);
  const q = U.cleanStr(req.query.q, 80);
  const conds = ['1 = 1'];
  const params = [];
  if (q) {
    conds.push("(LOWER(p.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(p.city) LIKE LOWER(?) ESCAPE '\\' OR LOWER(p.license_number) LIKE LOWER(?) ESCAPE '\\')");
    const pat = `%${U.escapeLike(q)}%`;
    params.push(pat, pat, pat);
  }
  if (req.query.verified === '0') conds.push('p.verified = 0');
  if (L.int(req.query.id)) { conds.push('p.id = ?'); params.push(L.int(req.query.id)); }
  const where = conds.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM pharmacies p WHERE ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT p.*, u.full_name AS owner_name, u.phone AS owner_phone,
           (SELECT COUNT(*) FROM inventory i WHERE i.pharmacy_id = p.id) AS inventory_count,
           (SELECT MAX(updated_at) FROM inventory i WHERE i.pharmacy_id = p.id) AS last_update
    FROM pharmacies p JOIN users u ON u.id = p.owner_id
    WHERE ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ pharmacies: rows.map(L.pharmacyView), total, limit, offset });
});

router.post('/pharmacies/:id/verify', ...adminOnly, (req, res) => {
  const pid = L.int(req.params.id);
  const verified = L.toBool(req.body.verified) ? 1 : 0;
  const info = db.prepare(`UPDATE pharmacies SET verified = ?, verified_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP END WHERE id = ?`).run(verified, verified, pid);
  if (!info.changes) return res.fail(404, 'pharmacy.not_found');
  L.audit(req, verified ? 'verify' : 'unverify', 'pharmacy', pid);
  res.json({ verified: Boolean(verified) });
});

router.post('/pharmacies/:id/owner', ...adminOnly, (req, res) => {
  const pharmacyId = L.int(req.params.id);
  const ph = pharmacyId && db.prepare('SELECT id, owner_id FROM pharmacies WHERE id = ?').get(pharmacyId);
  if (!ph) return res.fail(404, 'pharmacy.not_found');
  const user = L.findUserByRef({ id: req.body.owner_id, phone: req.body.owner_phone });
  if (!user) return res.fail(404, 'user.not_found');
  db.transaction(() => {
    db.prepare('UPDATE pharmacies SET owner_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id, pharmacyId);
    db.prepare("UPDATE users SET role = 'pharmacy_owner' WHERE id = ? AND role = 'user'").run(user.id);
  })();
  L.audit(req, 'owner_change', 'pharmacy', pharmacyId, { from: ph.owner_id, to: user.id });
  return res.json({ ok: true, owner: { id: user.id, full_name: user.full_name } });
});

router.post('/pharmacies', ...adminOnly, (req, res) => {
  const owner = L.findUserByRef({ id: req.body.owner_id || req.user.id, phone: req.body.owner_phone });
  if (!owner) return res.fail(400, 'user.owner_not_found');
  const v = L.validatePharmacy(req.body, { requireLicense: false });
  if (v.error) return res.fail(400, v.error);
  const d = v.value;
  if (d.license_number && L.licenseTaken(d.license_number)) return res.fail(409, 'request.license_taken');
  const verified = L.toBool(req.body.verified) && d.license_number ? 1 : 0;

  const id = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO pharmacies (owner_id, name, license_number, city, address, phone, lat, lng, is_247, open_time, close_time, phones, schedule, verified, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP END)
    `).run(owner.id, d.name, d.license_number, d.city, d.address, d.phone, d.lat, d.lng, d.is_247, d.open_time, d.close_time,
      d.phones || '[]', d.schedule || '', verified, verified);
    db.prepare("UPDATE users SET role = 'pharmacy_owner' WHERE id = ? AND role = 'user'").run(owner.id);
    return Number(info.lastInsertRowid);
  })();
  L.audit(req, 'create', 'pharmacy', id, { name: d.name, owner_id: owner.id });
  return res.status(201).json({ id });
});

router.delete('/pharmacies/:id', ...adminOnly, (req, res) => {
  const pid = L.int(req.params.id);
  const ph = pid && db.prepare('SELECT name, owner_id FROM pharmacies WHERE id = ?').get(pid);
  if (!ph) return res.fail(404, 'pharmacy.not_found');
  db.prepare('DELETE FROM pharmacies WHERE id = ?').run(pid);
  L.audit(req, 'delete', 'pharmacy', pid, ph);
  return res.json({ deleted: true });
});

// =========================================================================
// DORILAR (tahrirlash, tasdiqlash, o'chirish, birlashtirish, katalog importi)
// =========================================================================
router.put('/medicines/:id', ...adminOnly, (req, res) => {
  const id = L.int(req.params.id);
  const existing = id && db.prepare('SELECT * FROM medicines WHERE id = ?').get(id);
  if (!existing) return res.fail(404, 'medicine.not_found');
  const m = L.cleanMedicine({ ...existing, ...req.body });
  if (!m.name || !m.active_ingredient) return res.fail(400, 'medicine.name_required');
  const clash = L.findExactMedicine(m, id);
  if (clash) return res.fail(409, 'medicine.duplicate', { id: clash.id }, { existing_id: clash.id });
  const verified = req.body.verified === undefined ? existing.verified : (L.toBool(req.body.verified) ? 1 : 0);
  const slug = (m.name !== existing.name || m.dosage !== existing.dosage) ? L.uniqueSlug(m.name, m.dosage, id) : existing.slug;
  db.prepare(`
    UPDATE medicines SET name = ?, active_ingredient = ?, manufacturer = ?, dosage = ?, category = ?, prescription = ?,
      verified = ?, slug = ?, name_norm = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(m.name, m.active_ingredient, m.manufacturer, m.dosage, m.category, m.prescription, verified, slug, U.normKey(m.name), id);
  L.audit(req, 'update', 'medicine', id, { from: { name: existing.name, dosage: existing.dosage, prescription: existing.prescription }, to: { name: m.name, dosage: m.dosage, prescription: m.prescription } });
  return res.json({ ok: true, slug });
});

router.post('/medicines/:id/verify', ...adminOnly, (req, res) => {
  const id = L.int(req.params.id);
  const info = db.prepare('UPDATE medicines SET verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (!info.changes) return res.fail(404, 'medicine.not_found');
  L.audit(req, 'verify', 'medicine', id);
  res.json({ ok: true });
});

router.delete('/medicines/:id', ...adminOnly, (req, res) => {
  const id = L.int(req.params.id);
  const m = id && db.prepare('SELECT name, dosage FROM medicines WHERE id = ?').get(id);
  if (!m) return res.fail(404, 'medicine.not_found');
  db.prepare('DELETE FROM medicines WHERE id = ?').run(id);
  L.audit(req, 'delete', 'medicine', id, m);
  return res.json({ deleted: true });
});

// from_id dorining barcha narxlarini to_id ga ko'chiradi (bir dorixonada ikkalasi bo'lsa, yangirog'i qoladi)
router.post('/medicines/merge', ...adminOnly, (req, res) => {
  const fromId = L.int(req.body.from_id);
  const toId = L.int(req.body.to_id);
  if (!fromId || !toId || fromId === toId) return res.fail(400, 'medicine.merge_ids');
  if (!db.prepare('SELECT id FROM medicines WHERE id = ?').get(fromId) || !db.prepare('SELECT id FROM medicines WHERE id = ?').get(toId)) {
    return res.fail(404, 'medicine.merge_not_found');
  }
  const moved = db.transaction(() => {
    let n = 0;
    for (const inv of db.prepare('SELECT * FROM inventory WHERE medicine_id = ?').all(fromId)) {
      const dup = db.prepare('SELECT * FROM inventory WHERE pharmacy_id = ? AND medicine_id = ?').get(inv.pharmacy_id, toId);
      if (dup) {
        if (inv.updated_at > dup.updated_at) {
          db.prepare('UPDATE inventory SET price = ?, status = ?, updated_at = ? WHERE id = ?').run(inv.price, inv.status, inv.updated_at, dup.id);
        }
        db.prepare('UPDATE price_reports SET inventory_id = ? WHERE inventory_id = ?').run(dup.id, inv.id);
        db.prepare('DELETE FROM inventory WHERE id = ?').run(inv.id);
      } else {
        db.prepare('UPDATE inventory SET medicine_id = ? WHERE id = ?').run(toId, inv.id);
      }
      n++;
    }
    db.prepare('UPDATE price_reports SET medicine_id = ? WHERE medicine_id = ?').run(toId, fromId);
    db.prepare('UPDATE reservation_items SET medicine_id = ? WHERE medicine_id = ?').run(toId, fromId);
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, medicine_id, created_at) SELECT user_id, ?, created_at FROM favorites WHERE medicine_id = ?').run(toId, fromId);
    db.prepare('UPDATE OR IGNORE watches SET medicine_id = ? WHERE medicine_id = ?').run(toId, fromId);
    db.prepare('UPDATE pharmacy_stats SET medicine_id = ? WHERE medicine_id = ? AND NOT EXISTS (SELECT 1 FROM pharmacy_stats s2 WHERE s2.pharmacy_id = pharmacy_stats.pharmacy_id AND s2.medicine_id = ? AND s2.day = pharmacy_stats.day)').run(toId, fromId, toId);
    db.prepare('DELETE FROM medicines WHERE id = ?').run(fromId);
    return n;
  })();
  L.audit(req, 'merge', 'medicine', toId, { from_id: fromId, moved });
  return res.json({ merged: true, moved_offers: moved });
});

// Katalogni oldindan to'ldirish: name,active_ingredient,manufacturer,dosage,category,prescription (narxsiz)
router.post('/medicines/import-csv', ...adminOnly, (req, res) => {
  const text = String(req.body.csv || '').replace(/^﻿/, '').trim();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return res.fail(400, 'csv.too_short');
  if (lines.length - 1 > 20000) return res.fail(400, 'csv.too_many', { n: 20000 });
  const delimiter = U.detectDelimiter(lines[0]);
  const header = U.parseCsvLine(lines[0], delimiter).map(h => h.toLowerCase().trim());
  const col = (name, def) => { const i = header.indexOf(name); return i === -1 ? def : i; };
  const idx = {
    name: col('name', 0), active: col('active_ingredient', 1), mfr: col('manufacturer', 2),
    dosage: col('dosage', 3), category: col('category', 4), rx: col('prescription', 5)
  };
  const r = db.transaction(() => {
    let created = 0, existed = 0, skipped = 0;
    for (const line of lines.slice(1)) {
      const c = U.parseCsvLine(line, delimiter);
      const m = L.cleanMedicine({
        name: c[idx.name], active_ingredient: c[idx.active] || c[idx.name], manufacturer: c[idx.mfr],
        dosage: c[idx.dosage], category: c[idx.category],
        prescription: ['1', 'true', 'ha', 'yes', 'rx', 'да'].includes(String(c[idx.rx] || '').trim().toLowerCase())
      });
      if (!m.name) { skipped++; continue; }
      if (L.findExactMedicine(m)) { existed++; continue; }
      L.createMedicine(m, req.user.id, { verified: 1 });
      created++;
    }
    return { created, existed, skipped };
  })();
  L.audit(req, 'catalog_import', 'medicine', null, r);
  res.json(r);
});

// =========================================================================
// ESKIRGAN NARXLAR va ESLATMALAR
// =========================================================================
router.get('/stale', ...adminOnly, (req, res) => {
  const days = Math.min(Math.max(L.int(req.query.days) || config.STALE_DAYS, 1), 365);
  const rows = db.prepare(staleSql() + ' LIMIT 500').all(`-${days} days`).map(r => ({
    ...r, owner_telegram: Boolean(r.owner_telegram), verified: Boolean(r.verified),
    stale_days: r.last_update ? U.daysSince(r.last_update) : null
  }));
  res.json({ days, pharmacies: rows });
});

router.post('/stale/remind', ...adminOnly, async (req, res) => {
  const days = Math.min(Math.max(L.int(req.body.days) || config.STALE_DAYS, 1), 365);
  const ids = Array.isArray(req.body.pharmacy_ids) ? req.body.pharmacy_ids.map(L.int).filter(Boolean) : null;
  let rows = db.prepare(staleSql()).all(`-${days} days`);
  if (ids && ids.length) rows = rows.filter(r => ids.includes(r.id));
  const result = await notify.sendStaleReminders(rows, { force: true });
  L.audit(req, 'stale_remind', 'pharmacy', null, { days, ...result });
  res.json(result);
});

// =========================================================================
// "NOTO'G'RI NARX" XABARLARI
// =========================================================================
router.get('/reports', ...adminOnly, (req, res) => {
  const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  const rows = db.prepare(`
    SELECT r.*, m.name, m.dosage, p.name AS pharmacy_name, p.city, i.price AS current_price, i.status AS current_status
    FROM price_reports r JOIN medicines m ON m.id = r.medicine_id JOIN pharmacies p ON p.id = r.pharmacy_id
    LEFT JOIN inventory i ON i.id = r.inventory_id
    WHERE r.status = ? ORDER BY r.id DESC LIMIT 200
  `).all(status).map(r => { delete r.reporter_key; return r; });
  res.json({ reports: rows });
});

// =========================================================================
// QIDIRUV STATISTIKASI
// =========================================================================
router.get('/search-stats', ...adminOnly, (req, res) => {
  const days = Math.min(Math.max(L.int(req.query.days) || 30, 1), 365);
  const since = U.dayKey(new Date(Date.now() - (days - 1) * 86400000));
  const top = db.prepare(`
    SELECT term, SUM(searches) AS searches, SUM(zero_results) AS zero_results FROM search_stats
    WHERE day >= ? GROUP BY term ORDER BY searches DESC LIMIT 50
  `).all(since);
  const notFound = db.prepare(`
    SELECT term, SUM(zero_results) AS zero_results, SUM(searches) AS searches FROM search_stats
    WHERE day >= ? GROUP BY term HAVING SUM(zero_results) > 0 ORDER BY zero_results DESC LIMIT 50
  `).all(since);
  const totals = db.prepare('SELECT COALESCE(SUM(searches),0) AS searches, COALESCE(SUM(zero_results),0) AS zero_results FROM search_stats WHERE day >= ?').get(since);
  res.json({ days, totals, top, not_found: notFound });
});

// =========================================================================
// AUDIT LOG
// =========================================================================
router.get('/audit', ...adminOnly, (req, res) => {
  const { limit, offset } = L.paging(req, 50, 200);
  const conds = ['1 = 1'];
  const params = [];
  if (req.query.entity) { conds.push('a.entity = ?'); params.push(U.cleanStr(req.query.entity, 40)); }
  if (req.query.action) { conds.push('a.action = ?'); params.push(U.cleanStr(req.query.action, 40)); }
  if (L.int(req.query.user_id)) { conds.push('a.user_id = ?'); params.push(L.int(req.query.user_id)); }
  if (L.int(req.query.entity_id)) { conds.push('a.entity_id = ?'); params.push(L.int(req.query.entity_id)); }
  if (L.int(req.query.pharmacy_id)) {
    conds.push("((a.entity = 'pharmacy' AND a.entity_id = ?) OR json_extract(a.details, '$.pharmacy_id') = ?)");
    params.push(L.int(req.query.pharmacy_id), L.int(req.query.pharmacy_id));
  }
  const where = conds.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log a WHERE ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT a.*, u.full_name AS user_name, u.phone AS user_phone FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset).map(r => ({ ...r, details: L.jsonParse(r.details, {}) }));
  res.json({ entries: rows, total, limit, offset });
});

module.exports = router;
