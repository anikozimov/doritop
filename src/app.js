'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const db = require('./db');
const { t, pickLang } = require('./i18n');
const notify = require('./notify');

const app = express();
app.disable('x-powered-by');

if (config.TRUST_PROXY) {
  const v = config.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}

// =========================================================================
// XAVFSIZLIK SARLAVHALARI
// =========================================================================
// Tailwind endi build qilinadi, Lucide/Leaflet lokal -> skriptlar faqat o'z domenimizdan (inline skript yo'q)
app.use(helmet({
  contentSecurityPolicy: config.CSP_ENABLED ? {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://server.arcgisonline.com', 'https://*.tile.openstreetmap.org'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      ...(config.isProd ? { 'upgrade-insecure-requests': [] } : {})
    }
  } : false,
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  next();
});

if (config.FORCE_HTTPS) {
  app.use((req, res, next) => {
    if (req.secure || req.path === '/healthz') return next();
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  });
}

// =========================================================================
// LOG, TIL, JAVOB YORDAMCHILARI
// =========================================================================
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  req.id = crypto.randomBytes(6).toString('hex');
  res.set('X-Request-Id', req.id);
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    if (!req.path.startsWith('/api') && res.statusCode < 400) return; // statik fayllar shovqin qilmasin
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (config.LOG_FORMAT === 'json') {
      console.log(JSON.stringify({ t: new Date().toISOString(), id: req.id, m: req.method, p: req.path, s: res.statusCode, ms: Math.round(ms), ip: req.ip, u: req.user ? req.user.id : undefined }));
    } else {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`);
    }
  });
  next();
});

app.use((req, res, next) => {
  req.lang = pickLang(req);
  res.fail = (status, key, vars, extra) => res.status(status).json({ error: t(req.lang, key, vars), code: key, ...(extra || {}) });
  next();
});

if (config.CORS_ORIGIN) {
  app.use('/api', cors({ origin: config.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) }));
}

// Katta so'rovlar faqat kerakli joylarda (CSV import va logotip)
app.use(/^\/api\/(pharmacies\/\d+\/(inventory\/import-csv|logo)|admin\/medicines\/import-csv)$/, express.json({ limit: '3mb' }));
app.use(express.json({ limit: '256kb' }));

// =========================================================================
// STATIK FAYLLAR
// =========================================================================
app.use('/uploads', express.static(config.UPLOAD_DIR, {
  fallthrough: false,
  index: false,
  dotfiles: 'deny',
  maxAge: '7d',
  setHeaders(res) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}));
app.use(express.static(config.PUBLIC_DIR, {
  index: false,
  setHeaders(res, file) {
    if (/[\\/](assets|vendor)[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=86400');
  }
}));

app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ status: 'db_error' });
  }
});

// =========================================================================
// API
// =========================================================================
const apiLimiter = require('./lib').rateLimit({ windowMs: 60 * 1000, max: 300 });
app.use('/api', apiLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/public'));
app.use('/api', require('./routes/user'));
app.use('/api', require('./routes/owner'));
app.use('/api', (req, res) => res.fail(404, 'common.api_not_found'));

// =========================================================================
// SEO SAHIFALAR va SPA
// =========================================================================
app.use(require('./seo'));

const INDEX = path.join(config.PUBLIC_DIR, 'index.html');
app.get('*', (req, res) => {
  // Mavjud bo'lmagan fayllar (masalan /wp-login.php) uchun index.html emas, 404 qaytariladi
  if (path.extname(req.path)) return res.status(404).type('text/plain').send('Not found');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(INDEX);
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (!res.fail) res.fail = (s, k) => res.status(s).json({ error: k });
  if (err.type === 'entity.parse.failed') return res.fail(400, 'common.bad_json');
  if (err.type === 'entity.too.large') return res.fail(413, 'common.too_large');
  if (err.status === 404 || err.statusCode === 404) return res.status(404).type('text/plain').send('Not found');
  if (err.status === 403 || err.statusCode === 403) return res.status(403).type('text/plain').send('Forbidden');
  console.error('[xato]', req.id, req.method, req.originalUrl, err);
  notify.alertAdmin(`${req.method} ${req.path}: ${err.message}`, err.stack);
  return res.fail(500, 'common.server_error', null, { request_id: req.id });
});

module.exports = app;
