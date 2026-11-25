'use strict';
// Hodisalarga javoban Telegram xabarnomalari: kuzatuvlar, bronlar, arizalar, eskirgan narx eslatmalari

const db = require('./db');
const config = require('./config');
const U = require('./utils');
const L = require('./lib');
const tg = require('./telegram');

const WATCH_COOLDOWN_HOURS = 12;

function userChat(userId) {
  const u = db.prepare('SELECT telegram_chat_id, lang FROM users WHERE id = ? AND blocked_at IS NULL').get(userId);
  return u && u.telegram_chat_id ? { chat: u.telegram_chat_id, lang: u.lang } : null;
}

function siteLink(path) {
  return config.SITE_URL ? `${config.SITE_URL}${path}` : '';
}

// ---------------------------------------------------------------- kuzatuvlar
async function checkWatches(medicineIds) {
  if (!tg.enabled() || !medicineIds.length) return { sent: 0 };
  const ph = medicineIds.map(() => '?').join(',');
  const watches = db.prepare(`
    SELECT w.*, m.name, m.dosage, m.slug FROM watches w JOIN medicines m ON m.id = w.medicine_id
    WHERE w.medicine_id IN (${ph})
      AND (w.last_notified_at IS NULL OR w.last_notified_at < datetime('now', '-${WATCH_COOLDOWN_HOURS} hours'))
  `).all(...medicineIds);
  let sent = 0;
  for (const w of watches) {
    const target = w.chat_id ? { chat: w.chat_id, lang: tg.chatLang(w.chat_id) } : userChat(w.user_id);
    if (!target) continue;
    const cur = L.currentMinPrice(w.medicine_id, w.city);
    const name = tg.esc(`${w.name}${w.dosage ? ' ' + w.dosage : ''}`);
    const cityTxt = w.city !== 'all' ? ` (${tg.esc(w.city)})` : '';
    const link = w.slug && config.SITE_URL ? `\n${siteLink('/dori/' + w.slug)}` : '';
    if (w.kind === 'available') {
      if (cur.offers > 0) {
        await tg.send(target.chat, tg.text(target.lang, 'alert_available', { name, price: tg.price(cur.min_price, target.lang), city: cityTxt }) + link);
        db.prepare('DELETE FROM watches WHERE id = ?').run(w.id); // bir martalik
        sent++;
      }
    } else if (w.kind === 'price') {
      if (cur.offers === 0) continue;
      if (w.last_min_price === null) {
        db.prepare('UPDATE watches SET last_min_price = ? WHERE id = ?').run(cur.min_price, w.id);
      } else if (cur.min_price < w.last_min_price) {
        await tg.send(target.chat, tg.text(target.lang, 'alert_price', {
          name, price: tg.price(cur.min_price, target.lang), old: tg.price(w.last_min_price, target.lang), city: cityTxt
        }) + link);
        db.prepare('UPDATE watches SET last_min_price = ?, last_notified_at = CURRENT_TIMESTAMP WHERE id = ?').run(cur.min_price, w.id);
        sent++;
      }
    }
  }
  return { sent };
}

// Ko'p o'zgarish ketma-ket kelsa (CSV import) bitta tekshiruvga birlashtiriladi
let pending = new Set();
let timer = null;
L.bus.on('inventory:changed', ({ medicine_ids }) => {
  for (const id of medicine_ids) pending.add(id);
  if (timer) return;
  timer = setTimeout(() => {
    const ids = [...pending];
    pending = new Set();
    timer = null;
    checkWatches(ids).catch(err => console.error('[notify] watches:', err.message));
  }, 20000);
  timer.unref();
});

// ---------------------------------------------------------------- bronlar
function resItemsText(resId) {
  return db.prepare('SELECT name, qty, price FROM reservation_items WHERE reservation_id = ?').all(resId)
    .map(i => `• ${tg.esc(i.name)} × ${i.qty} — ${tg.price(i.price * i.qty)}`).join('\n');
}

L.bus.on('reservation:created', ({ id }) => {
  const r = db.prepare('SELECT r.*, p.name AS pharmacy_name, p.owner_id FROM reservations r JOIN pharmacies p ON p.id = r.pharmacy_id WHERE r.id = ?').get(id);
  if (!r) return;
  const owner = userChat(r.owner_id);
  if (!owner) return;
  tg.send(owner.chat, tg.text(owner.lang, 'res_new', {
    code: r.code, pharmacy: tg.esc(r.pharmacy_name), name: tg.esc(r.customer_name), phone: tg.esc(r.customer_phone),
    items: resItemsText(id), total: tg.price(r.total, owner.lang), note: r.note ? `\n📝 ${tg.esc(r.note)}` : ''
  }), {
    reply_markup: { inline_keyboard: [[
      { text: tg.text(owner.lang, 'res_btn_confirm'), callback_data: `rs:c:${id}` },
      { text: tg.text(owner.lang, 'res_btn_reject'), callback_data: `rs:r:${id}` }
    ]] }
  });
});

L.bus.on('reservation:status', ({ id, status, by }) => {
  const r = db.prepare('SELECT r.*, p.name AS pharmacy_name, p.owner_id FROM reservations r JOIN pharmacies p ON p.id = r.pharmacy_id WHERE r.id = ?').get(id);
  if (!r) return;
  const target = by === 'user' ? userChat(r.owner_id) : userChat(r.user_id);
  if (!target) return;
  const until = r.hold_until ? new Date(r.hold_until.replace(' ', 'T') + 'Z').toLocaleTimeString('ru-RU', { timeZone: config.TZ, hour: '2-digit', minute: '2-digit' }) : '';
  tg.send(target.chat, tg.text(target.lang, 'res_status', {
    code: r.code, pharmacy: tg.esc(r.pharmacy_name),
    status: tg.text(target.lang, 'status_' + status, { until }),
    note: r.owner_note && by !== 'user' ? `\n📝 ${tg.esc(r.owner_note)}` : ''
  }));
});

// ---------------------------------------------------------------- arizalar va xabarlar
L.bus.on('request:created', ({ id }) => {
  if (!config.ADMIN_ALERT_CHAT_ID) return;
  const r = db.prepare('SELECT name, city FROM pharmacy_requests WHERE id = ?').get(id);
  if (r) tg.send(config.ADMIN_ALERT_CHAT_ID, tg.text('uz', 'req_new', { name: tg.esc(r.name), city: tg.esc(r.city) }));
});

L.bus.on('request:reviewed', ({ id, status }) => {
  const r = db.prepare('SELECT user_id, name, admin_note FROM pharmacy_requests WHERE id = ?').get(id);
  const target = r && userChat(r.user_id);
  if (!target) return;
  tg.send(target.chat, tg.text(target.lang, status === 'approved' ? 'req_approved' : 'req_rejected', { name: tg.esc(r.name), note: tg.esc(r.admin_note) }));
});

const reportThrottle = new Map();
L.bus.on('report:created', ({ pharmacy_id, medicine_id }) => {
  const last = reportThrottle.get(pharmacy_id) || 0;
  if (Date.now() - last < 60 * 60 * 1000) return;
  reportThrottle.set(pharmacy_id, Date.now());
  const p = db.prepare('SELECT name, owner_id FROM pharmacies WHERE id = ?').get(pharmacy_id);
  const m = db.prepare('SELECT name FROM medicines WHERE id = ?').get(medicine_id);
  const target = p && userChat(p.owner_id);
  if (target && m) tg.send(target.chat, tg.text(target.lang, 'report_new', { pharmacy: tg.esc(p.name), name: tg.esc(m.name) }));
});

// ---------------------------------------------------------------- eskirgan narx eslatmalari
// rows: admin.staleSql() natijasi. Egasi bo'yicha guruhlanadi, bitta egaga bitta xabar.
async function sendStaleReminders(rows, { force = false } = {}) {
  const result = { sent: 0, no_telegram: 0, skipped_recent: 0, pharmacies: rows.length };
  if (!tg.enabled()) return { ...result, telegram_disabled: true };
  const byOwner = new Map();
  for (const r of rows) {
    if (!force && r.last_reminded_at && U.daysSince(r.last_reminded_at) < config.REMIND_EVERY_DAYS) { result.skipped_recent++; continue; }
    if (!byOwner.has(r.owner_id)) byOwner.set(r.owner_id, []);
    byOwner.get(r.owner_id).push(r);
  }
  for (const [ownerId, list] of byOwner) {
    const target = userChat(ownerId);
    if (!target) { result.no_telegram += list.length; continue; }
    const lines = list.map(r => {
      const d = r.last_update ? U.daysSince(r.last_update) : null;
      return `• <b>${tg.esc(r.name)}</b> (${tg.esc(r.city)}) — ${d === null ? (target.lang === 'ru' ? 'цен нет' : 'narxlar yo‘q') : (target.lang === 'ru' ? `${d} дн.` : `${d} kun`)}`;
    }).join('\n');
    const link = config.SITE_URL ? `\n\n${config.SITE_URL}/?page=pharmacy` : '';
    const ok = await tg.send(target.chat, tg.text(target.lang, 'stale', { list: lines, days: config.STALE_DAYS, link }));
    if (ok) {
      const upd = db.prepare('UPDATE pharmacies SET last_reminded_at = CURRENT_TIMESTAMP WHERE id = ?');
      list.forEach(r => upd.run(r.id));
      result.sent++;
    }
  }
  return result;
}

// ---------------------------------------------------------------- monitoring: xatolarni adminga yuborish
const alertSeen = new Map();
function alertAdmin(title, detail = '') {
  if (!config.ADMIN_ALERT_CHAT_ID || !tg.enabled()) return;
  const key = String(title).slice(0, 120);
  const last = alertSeen.get(key) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return; // bir xil xato 10 daqiqada bir marta
  alertSeen.set(key, Date.now());
  tg.send(config.ADMIN_ALERT_CHAT_ID, `🚨 <b>DORI TOP xatolik</b>\n${tg.esc(title)}\n<pre>${tg.esc(String(detail).slice(0, 1500))}</pre>`);
}

module.exports = { checkWatches, sendStaleReminders, alertAdmin };
