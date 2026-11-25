'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const U = require('../utils');
const L = require('../lib');
const totp = require('../totp');
const tg = require('../telegram');
const {
  signToken, signTicket, verifyTicket, requireAuth, publicUser, USER_COLS
} = require('../auth');

const router = express.Router();

const ADMIN_PHONE = config.ADMIN_PHONE ? U.normalizePhone(config.ADMIN_PHONE) : '';
const DUMMY_HASH = bcrypt.hashSync('dori-top-dummy-password', 10);
const BCRYPT_ROUNDS = 11;

const loginLimiter = L.rateLimit({ windowMs: 15 * 60 * 1000, max: 30, messageKey: 'auth.too_many_logins' });
const registerLimiter = L.rateLimit({ windowMs: 60 * 60 * 1000, max: 10, messageKey: 'auth.too_many_registers' });
const resetLimiter = L.rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const twofaLimiter = L.rateLimit({ windowMs: 15 * 60 * 1000, max: 20, messageKey: 'auth.too_many_logins' });

// Telefon raqami bo'yicha bloklash (IP almashtirib parol tanlashga qarshi): 15 daqiqada 10 xato -> 15 daqiqa blok
const failedByPhone = new Map();
const LOCK_MAX = 10;
const LOCK_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failedByPhone) if (v.until <= now && v.first + LOCK_MS <= now) failedByPhone.delete(k);
}, 60000).unref();

function phoneLocked(phone) {
  const r = failedByPhone.get(phone);
  return Boolean(r && r.until > Date.now());
}
function phoneFailed(phone) {
  const now = Date.now();
  let r = failedByPhone.get(phone);
  if (!r || r.first + LOCK_MS <= now) r = { count: 0, first: now, until: 0 };
  r.count++;
  if (r.count >= LOCK_MAX) r.until = now + LOCK_MS;
  failedByPhone.set(phone, r);
}

function adminCount() { return L.adminCount(); }

// Birinchi foydalanuvchini avtomatik admin qilish faqat ADMIN_PHONE berilmagan va production bo'lmaganda ishlaydi.
function bootstrapOpen() {
  return !config.isProd && !ADMIN_PHONE && adminCount() === 0;
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 72;
}

function issue(res, row, extra = {}) {
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  const fresh = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(row.id);
  return res.json({ user: publicUser(fresh), token: signToken(fresh), ...extra });
}

function timingSafeEq(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// =========================================================================
router.get('/bootstrap-status', (req, res) => {
  res.json({
    hasAdmin: adminCount() > 0,
    bootstrapOpen: bootstrapOpen(),
    telegram: { enabled: tg.enabled(), bot: config.TELEGRAM_BOT_USERNAME }
  });
});

router.post('/register', registerLimiter, async (req, res) => {
  const fullName = U.cleanStr(req.body.full_name, 100);
  const phone = U.normalizePhone(req.body.phone);
  const password = req.body.password;

  if (fullName.length < 2) return res.fail(400, 'auth.name_short');
  if (!U.isValidUserPhone(phone)) return res.fail(400, 'auth.bad_phone');
  if (!validPassword(password)) return res.fail(400, 'auth.password_rules');
  if (!L.toBool(req.body.accept_terms)) return res.fail(400, 'auth.accept_terms');

  // ADMIN_PHONE bilan ro'yxatdan o'tish uchun maxfiy kod talab qilinadi (raqamni bilgan begona odam admin bo'lib olmasligi uchun)
  const isAdminPhone = ADMIN_PHONE && phone === ADMIN_PHONE;
  if (isAdminPhone) {
    if (!config.ADMIN_SETUP_CODE) {
      if (config.isProd) return res.fail(403, 'auth.admin_use_cli');
    } else if (!timingSafeEq(String(req.body.setup_code || ''), config.ADMIN_SETUP_CODE)) {
      return res.fail(403, 'auth.admin_setup_code');
    }
  }

  const existing = db.prepare('SELECT id FROM users WHERE phone = ? OR phone = ?').get(phone, U.legacyNormalizePhone(req.body.phone));
  if (existing) return res.fail(409, 'auth.phone_taken');

  const role = isAdminPhone || bootstrapOpen() ? 'admin' : 'user';
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let id;
  try {
    id = Number(db.prepare(
      "INSERT INTO users (full_name, phone, password_hash, role, terms_accepted_at, lang) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)"
    ).run(fullName, phone, hash, role, req.lang).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return res.fail(409, 'auth.phone_taken');
    throw err;
  }
  L.audit(req, 'register', 'user', id, { role }, id);
  res.status(201);
  return issue(res, { id });
});

router.post('/login', loginLimiter, async (req, res) => {
  const phone = U.normalizePhone(req.body.phone);
  const password = String(req.body.password || '').slice(0, 200);
  if (phoneLocked(phone)) return res.fail(429, 'auth.phone_locked');

  const row = db.prepare('SELECT * FROM users WHERE phone = ? OR phone = ? ORDER BY (phone = ?) DESC LIMIT 1')
    .get(phone, U.legacyNormalizePhone(req.body.phone), phone);
  // Foydalanuvchi topilmasa ham bcrypt ishlatiladi (vaqt bo'yicha farqlab bo'lmasligi uchun)
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) {
    phoneFailed(phone);
    return res.fail(401, 'auth.bad_credentials');
  }
  if (row.blocked_at) return res.fail(403, 'auth.blocked');
  failedByPhone.delete(phone);

  if (row.totp_enabled) {
    return res.json({ need_2fa: true, ticket: signTicket(row) });
  }
  return issue(res, row);
});

router.post('/2fa', twofaLimiter, (req, res) => {
  const p = verifyTicket(req.body.ticket);
  if (!p) return res.fail(401, 'auth.ticket_expired');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(p.id);
  if (!row || row.blocked_at || row.token_version !== p.tv || !row.totp_enabled) return res.fail(401, 'auth.ticket_expired');
  const step = totp.verify(row.totp_secret, req.body.code, { lastStep: row.totp_last_step });
  if (!step) {
    phoneFailed(row.phone);
    return res.fail(401, 'auth.bad_2fa');
  }
  db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, row.id);
  return issue(res, row);
});

// ---- Parolni tiklash (Telegram orqali kod)
router.post('/reset/request', resetLimiter, async (req, res) => {
  const phone = U.normalizePhone(req.body.phone);
  const generic = { ok: true, telegram: tg.enabled() };
  if (!U.isValidUserPhone(phone)) return res.json(generic);
  const user = db.prepare('SELECT id, telegram_chat_id, blocked_at, lang FROM users WHERE phone = ? OR phone = ?')
    .get(phone, U.legacyNormalizePhone(req.body.phone));
  // Javob har doim bir xil: raqam ro'yxatdan o'tganmi-yo'qmi oshkor qilinmaydi
  if (!user || !user.telegram_chat_id || user.blocked_at || !tg.enabled()) return res.json(generic);
  const recent = db.prepare("SELECT COUNT(*) AS c FROM password_resets WHERE user_id = ? AND created_at > datetime('now', '-1 hour')").get(user.id).c;
  if (recent >= 3) return res.json(generic);

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);
  db.prepare('INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, ?)')
    .run(user.id, U.sha256(`${user.id}:${code}`), Date.now() + 10 * 60 * 1000);
  tg.send(user.telegram_chat_id, tg.text(user.lang, 'reset_code', { code })).catch(() => {});
  return res.json(generic);
});

router.post('/reset/confirm', resetLimiter, async (req, res) => {
  const phone = U.normalizePhone(req.body.phone);
  const code = String(req.body.code || '').trim();
  if (!validPassword(req.body.password)) return res.fail(400, 'auth.password_rules');
  const user = db.prepare('SELECT id FROM users WHERE phone = ? OR phone = ?').get(phone, U.legacyNormalizePhone(req.body.phone));
  const reset = user && db.prepare('SELECT * FROM password_resets WHERE user_id = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(user.id);
  if (!reset || reset.expires_at < Date.now() || reset.attempts >= 5) return res.fail(400, 'auth.reset_invalid');
  if (!timingSafeEq(U.sha256(`${user.id}:${code}`), reset.code_hash)) {
    db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(reset.id);
    return res.fail(400, 'auth.reset_invalid');
  }
  const hash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
  db.transaction(() => {
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = 0 WHERE id = ?').run(hash, user.id);
  })();
  failedByPhone.delete(phone);
  L.audit(req, 'password_reset', 'user', user.id, { via: 'telegram' }, user.id);
  return res.json({ ok: true });
});

// =========================================================================
// PROFIL
// =========================================================================
router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me', requireAuth, (req, res) => {
  const name = req.body.full_name !== undefined ? U.cleanStr(req.body.full_name, 100) : req.user.full_name;
  const lang = ['uz', 'ru'].includes(req.body.lang) ? req.body.lang : req.user.lang;
  if (name.length < 2) return res.fail(400, 'auth.name_short');
  db.prepare('UPDATE users SET full_name = ?, lang = ? WHERE id = ?').run(name, lang, req.user.id);
  return res.json({ user: publicUser({ ...req.user, full_name: name, lang }) });
});

router.post('/me/password', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(String(req.body.current_password || ''), row.password_hash))) {
    return res.fail(400, 'auth.current_password_wrong');
  }
  if (!validPassword(req.body.new_password)) return res.fail(400, 'auth.password_rules');
  const hash = await bcrypt.hash(req.body.new_password, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = 0 WHERE id = ?').run(hash, req.user.id);
  L.audit(req, 'password_change', 'user', req.user.id);
  const fresh = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user.id);
  return res.json({ user: publicUser(fresh), token: signToken(fresh) });
});

// Barcha qurilmalardan chiqish
router.post('/me/logout-all', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
  return res.json({ ok: true });
});

// ---- Telegram ulash
router.post('/me/telegram/link', requireAuth, (req, res) => {
  if (!tg.enabled() || !config.TELEGRAM_BOT_USERNAME) return res.fail(400, 'tg.disabled');
  const code = crypto.randomBytes(12).toString('hex');
  db.prepare('DELETE FROM telegram_links WHERE user_id = ? OR expires_at < ?').run(req.user.id, Date.now());
  db.prepare('INSERT INTO telegram_links (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, req.user.id, Date.now() + 15 * 60 * 1000);
  return res.json({ url: `https://t.me/${config.TELEGRAM_BOT_USERNAME}?start=link_${code}` });
});

router.delete('/me/telegram', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE id = ?').run(req.user.id);
  return res.json({ ok: true });
});

// ---- Ikki bosqichli kirish (TOTP)
router.post('/me/2fa/setup', requireAuth, async (req, res) => {
  if (req.user.totp_enabled) return res.fail(400, 'auth.2fa_already');
  const secret = totp.generateSecret();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, req.user.id);
  const url = totp.otpauthUrl(secret, req.user.phone);
  let qr = '';
  try { qr = await require('qrcode').toString(url, { type: 'svg', margin: 1, width: 200 }); } catch (_) {}
  return res.json({ secret, otpauth_url: url, qr_svg: qr });
});

router.post('/me/2fa/enable', requireAuth, (req, res) => {
  const row = db.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').get(req.user.id);
  if (row.totp_enabled) return res.fail(400, 'auth.2fa_already');
  const step = totp.verify(row.totp_secret, req.body.code);
  if (!step) return res.fail(400, 'auth.bad_2fa');
  db.prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ?, token_version = token_version + 1 WHERE id = ?').run(step, req.user.id);
  L.audit(req, '2fa_enable', 'user', req.user.id);
  const fresh = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user.id);
  return res.json({ user: publicUser(fresh), token: signToken(fresh) });
});

router.post('/me/2fa/disable', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT password_hash, totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?').get(req.user.id);
  if (!row.totp_enabled) return res.fail(400, 'auth.2fa_not_enabled');
  if (config.ADMIN_2FA_REQUIRED && req.user.role === 'admin') return res.fail(400, 'auth.2fa_required_admin');
  if (!(await bcrypt.compare(String(req.body.password || ''), row.password_hash))) return res.fail(400, 'auth.current_password_wrong');
  if (!totp.verify(row.totp_secret, req.body.code, { lastStep: row.totp_last_step })) return res.fail(400, 'auth.bad_2fa');
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, token_version = token_version + 1 WHERE id = ?').run(req.user.id);
  L.audit(req, '2fa_disable', 'user', req.user.id);
  const fresh = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user.id);
  return res.json({ user: publicUser(fresh), token: signToken(fresh) });
});

router._resetLimits = () => { failedByPhone.clear(); [loginLimiter, registerLimiter, resetLimiter, twofaLimiter].forEach(l => l.reset()); };

module.exports = router;
