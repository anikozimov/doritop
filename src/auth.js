'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');
const config = require('./config');

// env.example dagi namunaviy kalitlar hech qachon ishlatilmasligi kerak.
const KNOWN_WEAK = new Set([
  'dori_top_dev_secret_change_in_prod',
  'dori_top_super_secret_key_ozgartiring_2026',
  'CHANGE_ME'
]);

let JWT_SECRET = config.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32 || KNOWN_WEAK.has(JWT_SECRET)) {
  if (config.isProd) {
    console.error(
      '[XAVFSIZLIK] JWT_SECRET o‘rnatilmagan yoki juda zaif. Productionda server ishga tushmaydi.\n' +
      'Yangi kalit yarating:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
    process.exit(1);
  }
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[OGOHLANTIRISH] JWT_SECRET zaif/yo‘q: vaqtinchalik kalit ishlatilmoqda (server qayta ishga tushsa, hamma qayta kiradi).');
  }
}

// Boshqa maqsadlar uchun (masalan, IP xeshlash) JWT kalitidan ajratilgan kalit
const SERVER_KEY = crypto.createHmac('sha256', JWT_SECRET).update('dori-top-server-key').digest();

const USER_COLS = 'id, full_name, phone, role, token_version, blocked_at, telegram_chat_id, totp_enabled, must_change_password, lang';

function signToken(user) {
  return jwt.sign(
    { id: user.id, tv: user.token_version || 0 },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: config.TOKEN_TTL }
  );
}

// 2FA bosqichi uchun qisqa muddatli chipta (faqat /api/auth/2fa da qabul qilinadi)
function signTicket(user) {
  return jwt.sign({ id: user.id, tv: user.token_version || 0, purpose: '2fa' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
}

function verifyTicket(ticket) {
  try {
    const p = jwt.verify(String(ticket || ''), JWT_SECRET, { algorithms: ['HS256'] });
    return p.purpose === '2fa' ? p : null;
  } catch (_) { return null; }
}

function loadUserFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return { error: 'auth.session_expired' };
  }
  if (payload.purpose) return { error: 'auth.session_expired' };
  const u = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(payload.id);
  if (!u) return { error: 'auth.user_not_found' };
  // Parol o'zgarsa / "hamma qurilmalardan chiqish" / bloklansa token_version oshadi -> eski tokenlar yaroqsiz
  if ((payload.tv || 0) !== u.token_version) return { error: 'auth.session_expired' };
  if (u.blocked_at) return { error: 'auth.blocked' };
  return { user: u };
}

function publicUser(u) {
  return {
    id: u.id,
    full_name: u.full_name,
    phone: u.phone,
    role: u.role,
    lang: u.lang || 'uz',
    telegram_linked: Boolean(u.telegram_chat_id),
    totp_enabled: Boolean(u.totp_enabled),
    must_change_password: Boolean(u.must_change_password)
  };
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) return res.fail(401, 'auth.required');
  const r = loadUserFromToken(token);
  if (r.error) return res.fail(r.error === 'auth.blocked' ? 403 : 401, r.error);
  req.user = r.user; // rol har doim bazadan olinadi (tokendagi rolga ishonilmaydi)
  return next();
}

// Token bo'lsa foydalanuvchini aniqlaydi, bo'lmasa mehmon sifatida davom etadi
function optionalAuth(req, res, next) {
  const token = bearer(req);
  if (token) {
    const r = loadUserFromToken(token);
    if (r.user) req.user = r.user;
  }
  return next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.fail(403, 'auth.forbidden');
    }
    // Productionda adminlar ikki bosqichli kirishni yoqmaguncha admin amallarini bajara olmaydi
    if (req.user.role === 'admin' && allowedRoles.includes('admin') && config.ADMIN_2FA_REQUIRED && !req.user.totp_enabled) {
      return res.fail(403, 'auth.2fa_setup_required');
    }
    return next();
  };
}

module.exports = {
  signToken, signTicket, verifyTicket, requireAuth, optionalAuth, requireRole,
  publicUser, SERVER_KEY, USER_COLS
};
