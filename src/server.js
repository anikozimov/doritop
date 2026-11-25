'use strict';

const config = require('./config');
const db = require('./db');
const U = require('./utils');
const app = require('./app');
const jobs = require('./jobs');
const tg = require('./telegram');
const notify = require('./notify');

// Development'da ADMIN_PHONE egasi avtomatik admin bo'ladi.
// Productionda bu xavfli (raqamni bilgan begona odam avval ro'yxatdan o'tib olishi mumkin) — `npm run admin:create` ishlating.
if (config.ADMIN_PHONE && !config.isProd) {
  db.prepare("UPDATE users SET role = 'admin' WHERE (phone = ? OR phone = ?) AND role != 'admin'")
    .run(U.normalizePhone(config.ADMIN_PHONE), U.legacyNormalizePhone(config.ADMIN_PHONE));
}
if (config.isProd && db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c === 0) {
  console.error('[OGOHLANTIRISH] Tizimda admin yo‘q. Admin yaratish: npm run admin:create -- --phone +998... --name "Ism"');
}
if (config.isProd && !config.SITE_URL) {
  console.warn('[OGOHLANTIRISH] SITE_URL berilmagan: sitemap.xml va Telegram havolalari so‘rov domenidan olinadi.');
}

process.on('unhandledRejection', (r) => {
  console.error('[unhandledRejection]', r);
  notify.alertAdmin('unhandledRejection', r && r.stack ? r.stack : String(r));
});

const server = app.listen(config.PORT, () => {
  console.log(`DORI TOP serveri ishga tushdi: http://localhost:${config.PORT}`);
  if (config.JOBS_ENABLED) jobs.start();
  if (tg.enabled()) tg.startPolling();
});

function shutdown() {
  tg.stopPolling();
  server.close(() => { try { db.close(); } catch (_) {} process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = server;
