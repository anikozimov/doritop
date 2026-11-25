'use strict';
// Fon vazifalari: narx tarixi, bronlar muddati, eslatmalar, tozalash, zaxira nusxa

const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const U = require('./utils');
const notify = require('./notify');

// Kunlik narx ko'rsatkichlari (grafik uchun). Bugungi qator har soatda yangilanadi.
function snapshotPrices(day = U.dayKey()) {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO price_daily (medicine_id, city, day, min_price, avg_price, offers)
      SELECT i.medicine_id, 'all', ?, MIN(i.price), CAST(AVG(i.price) AS INTEGER), COUNT(*)
      FROM inventory i WHERE i.status != 'out' GROUP BY i.medicine_id
      ON CONFLICT(medicine_id, city, day) DO UPDATE SET min_price = excluded.min_price, avg_price = excluded.avg_price, offers = excluded.offers
    `).run(day);
    db.prepare(`
      INSERT INTO price_daily (medicine_id, city, day, min_price, avg_price, offers)
      SELECT i.medicine_id, p.city, ?, MIN(i.price), CAST(AVG(i.price) AS INTEGER), COUNT(*)
      FROM inventory i JOIN pharmacies p ON p.id = i.pharmacy_id WHERE i.status != 'out' GROUP BY i.medicine_id, p.city
      ON CONFLICT(medicine_id, city, day) DO UPDATE SET min_price = excluded.min_price, avg_price = excluded.avg_price, offers = excluded.offers
    `).run(day);
  })();
}

function expireReservations() {
  const ids = db.prepare(`
    SELECT id, status FROM reservations
    WHERE (status = 'pending' AND created_at < datetime('now', '-24 hours'))
       OR (status = 'confirmed' AND hold_until IS NOT NULL AND hold_until < datetime('now'))
  `).all();
  const upd = db.prepare("UPDATE reservations SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  for (const r of ids) upd.run(r.id);
  return ids.length;
}

function cleanup() {
  db.prepare('DELETE FROM telegram_links WHERE expires_at < ?').run(Date.now());
  db.prepare("DELETE FROM password_resets WHERE created_at < datetime('now', '-2 days')").run();
  db.prepare("DELETE FROM search_stats WHERE day < ?").run(U.dayKey(new Date(Date.now() - 400 * 86400000)));
  db.prepare("DELETE FROM price_daily WHERE day < ?").run(U.dayKey(new Date(Date.now() - 400 * 86400000)));
}

async function autoRemind() {
  if (!config.AUTO_REMIND) return;
  const hour = Math.floor(U.parseTime(new Intl.DateTimeFormat('en-GB', { timeZone: config.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())) / 60);
  if (hour < 10 || hour >= 19) return; // kechasi bezovta qilinmaydi
  const rows = db.prepare(`
    SELECT p.id, p.name, p.city, p.owner_id, p.last_reminded_at, MAX(i.updated_at) AS last_update
    FROM pharmacies p LEFT JOIN inventory i ON i.pharmacy_id = p.id
    GROUP BY p.id HAVING last_update IS NOT NULL AND last_update < datetime('now', ?)
  `).all(`-${config.STALE_DAYS} days`);
  if (rows.length) {
    const r = await notify.sendStaleReminders(rows, { force: false });
    if (r.sent) console.log('[jobs] eslatma yuborildi:', r);
  }
}

function backup() {
  if (!config.BACKUP_DIR) return;
  const dir = config.BACKUP_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.resolve(dir, `dori_top_${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(dir).filter(f => /^dori_top_.*\.db$/.test(f)).sort().reverse().slice(config.BACKUP_KEEP);
  old.forEach(f => fs.unlinkSync(path.join(dir, f)));
  console.log('[backup] saqlandi:', file);
}

function safe(name, fn) {
  return async () => {
    try { await fn(); } catch (err) {
      console.error(`[jobs] ${name} xatosi:`, err);
      notify.alertAdmin(`Fon vazifasi xatosi: ${name}`, err.stack || err.message);
    }
  };
}

function start() {
  const hourly = safe('hourly', () => { snapshotPrices(); expireReservations(); cleanup(); });
  const remind = safe('remind', autoRemind);
  const doBackup = safe('backup', backup);
  setTimeout(hourly, 5000).unref();
  setInterval(hourly, 60 * 60 * 1000).unref();
  setInterval(safe('expire', expireReservations), 5 * 60 * 1000).unref();
  setInterval(remind, 2 * 60 * 60 * 1000).unref();
  if (config.BACKUP_DIR) {
    doBackup();
    setInterval(doBackup, config.BACKUP_EVERY_HOURS * 3600 * 1000).unref();
  }
}

module.exports = { start, snapshotPrices, expireReservations, cleanup, backup };
