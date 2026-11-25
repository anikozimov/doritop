'use strict';
// Telegram bot: dori qidirish, "kelganda xabar ber", hisobni ulash, bronlarni tasdiqlash, parol tiklash kodi.
// Long polling ishlatiladi (webhook/HTTPS shart emas). TELEGRAM_BOT_TOKEN berilmasa o'chiq.

const config = require('./config');

let transport = null; // testlarda almashtirish uchun
let db = null;
let L = null;
let U = null;
let running = false;
let offset = 0;

function lazy() {
  if (!db) { db = require('./db'); L = require('./lib'); U = require('./utils'); }
}

function enabled() {
  return Boolean(config.TELEGRAM_BOT_TOKEN) || Boolean(transport);
}

function setTransport(fn) { transport = fn; }

async function callApi(method, payload = {}, timeoutMs = 15000) {
  if (transport) return transport(method, payload);
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error('telegram disabled');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const err = new Error(`telegram ${method}: ${data.description || res.status}`);
      err.code = data.error_code;
      throw err;
    }
    return data.result;
  } finally {
    clearTimeout(t);
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function send(chatId, text, extra = {}) {
  if (!enabled() || !chatId) return null;
  try {
    return await callApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  } catch (err) {
    // Foydalanuvchi botni bloklagan bo'lsa (403) ulanish bekor qilinadi
    if (err.code === 403) {
      lazy();
      try {
        db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?').run(String(chatId));
        db.prepare('DELETE FROM watches WHERE chat_id = ?').run(String(chatId));
      } catch (_) {}
    }
    console.warn('[telegram] yuborilmadi:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------- matnlar
const T = {
  uz: {
    welcome: '👋 <b>DORI TOP</b> botiga xush kelibsiz!\n\nDori nomini yozing (masalan: <i>paratsetamol</i>) — eng arzon dorixonalarni ko‘rsataman.\n\n/city — shaharni tanlash\n/my — kuzatuvlarim\n/lang — tilni o‘zgartirish',
    linked: '✅ Telegram hisobingiz DORI TOP profilingizga ulandi ({name}). Endi bronlar, eslatmalar va parol tiklash kodlari shu yerga keladi.',
    link_bad: '❌ Havola eskirgan yoki noto‘g‘ri. Saytdagi profil sahifasidan qayta urinib ko‘ring.',
    not_found: '😔 “{q}” bo‘yicha dori topilmadi. Boshqacha yozib ko‘ring.',
    choose: '🔎 Topilgan dorilar:',
    from: 'dan',
    unavailable: 'mavjud emas',
    offers_title: '💊 <b>{name}</b>{rx}\n📍 {city}\n',
    rx: ' (retsept bilan)',
    no_offers: 'Hozircha hech bir dorixonada mavjud emas.',
    open: 'ochiq', closed: 'yopiq',
    btn_watch_available: '🔔 Kelganda xabar ber',
    btn_watch_price: '📉 Narx tushsa xabar ber',
    btn_site: '🌐 Saytda ochish',
    watch_ok: '✅ Kuzatuvga olindi. Xabar beraman.',
    watch_exists: 'ℹ️ Bu dori allaqachon kuzatilmoqda.',
    watch_limit: 'Kuzatuvlar soni chegarasiga yetdingiz (20). /my orqali keraksizlarini o‘chiring.',
    my_empty: 'Sizda kuzatuvlar yo‘q.',
    my_title: '🔔 Kuzatuvlaringiz (o‘chirish uchun bosing):',
    removed: '🗑 O‘chirildi.',
    city_choose: '📍 Shaharni tanlang:',
    city_all: 'Barcha shaharlar',
    city_set: '📍 Shahar: {city}',
    lang_set: '✅ Til: o‘zbekcha',
    disclaimer: '\n<i>Narx va mavjudlikni dorixonadan aniqlashtiring. Sayt shifokor maslahati o‘rnini bosmaydi.</i>',
    alert_available: '🔔 <b>{name}</b> dorixonalarda paydo bo‘ldi! Eng arzon narx: <b>{price}</b>{city}.',
    alert_price: '📉 <b>{name}</b> narxi tushdi: <b>{price}</b> (avval {old}){city}.',
    reset_code: '🔐 DORI TOP parolni tiklash kodi: <b>{code}</b>\nKod 10 daqiqa amal qiladi. Agar siz so‘ramagan bo‘lsangiz, bu xabarni e’tiborsiz qoldiring.',
    res_new: '🆕 <b>Yangi bron</b> #{code}\n🏥 {pharmacy}\n👤 {name}, {phone}\n{items}\n💰 Jami: <b>{total}</b>{note}',
    res_btn_confirm: '✅ Tasdiqlash (3 soat)',
    res_btn_reject: '❌ Rad etish',
    res_status: '📦 Bron #{code} ({pharmacy}): <b>{status}</b>{note}',
    res_done: 'Bajarildi: {status}',
    res_forbidden: 'Bu bronni boshqarishga ruxsatingiz yo‘q yoki u allaqachon ko‘rib chiqilgan.',
    status_confirmed: 'tasdiqlandi — {until} gacha ushlab turiladi',
    status_rejected: 'rad etildi',
    status_cancelled: 'bekor qilindi',
    status_completed: 'yakunlandi',
    status_expired: 'muddati o‘tdi',
    stale: '⏰ <b>Narxlarni yangilash vaqti keldi</b>\n\n{list}\n\nNarxi {days}+ kun yangilanmagan dorixonalar qidiruvda “eskirgan” deb ko‘rsatiladi. Narxlar o‘zgarmagan bo‘lsa, kabinetda “Narxlarni tasdiqlash” tugmasini bosing.{link}',
    report_new: '⚠️ Foydalanuvchi <b>{pharmacy}</b> dagi <b>{name}</b> narxi/mavjudligi noto‘g‘ri ekanini xabar qildi. Kabinetda tekshiring.',
    req_new: '📝 Yangi dorixona arizasi: <b>{name}</b> ({city}).',
    req_approved: '🎉 “{name}” dorixonasi bo‘yicha arizangiz tasdiqlandi! Endi kabinetga dori va narx qo‘shishingiz mumkin.',
    req_rejected: '❌ “{name}” bo‘yicha arizangiz rad etildi. Izoh: {note}',
    too_fast: 'Biroz sekinroq 🙂',
    help: 'Dori nomini yozing. /city — shahar, /my — kuzatuvlar, /lang — til.'
  },
  ru: {
    welcome: '👋 Добро пожаловать в <b>DORI TOP</b>!\n\nНапишите название лекарства (например: <i>парацетамол</i>) — покажу самые дешёвые аптеки.\n\n/city — выбрать город\n/my — мои подписки\n/lang — сменить язык',
    linked: '✅ Telegram привязан к вашему профилю DORI TOP ({name}). Брони, напоминания и коды восстановления будут приходить сюда.',
    link_bad: '❌ Ссылка устарела или неверна. Попробуйте снова со страницы профиля на сайте.',
    not_found: '😔 По запросу «{q}» ничего не найдено. Попробуйте написать иначе.',
    choose: '🔎 Найденные лекарства:',
    from: 'от',
    unavailable: 'нет в наличии',
    offers_title: '💊 <b>{name}</b>{rx}\n📍 {city}\n',
    rx: ' (по рецепту)',
    no_offers: 'Пока нет ни в одной аптеке.',
    open: 'открыто', closed: 'закрыто',
    btn_watch_available: '🔔 Сообщить о поступлении',
    btn_watch_price: '📉 Сообщить о снижении цены',
    btn_site: '🌐 Открыть на сайте',
    watch_ok: '✅ Подписка оформлена. Я сообщу.',
    watch_exists: 'ℹ️ Вы уже следите за этим лекарством.',
    watch_limit: 'Достигнут лимит подписок (20). Удалите лишние через /my.',
    my_empty: 'У вас нет подписок.',
    my_title: '🔔 Ваши подписки (нажмите, чтобы удалить):',
    removed: '🗑 Удалено.',
    city_choose: '📍 Выберите город:',
    city_all: 'Все города',
    city_set: '📍 Город: {city}',
    lang_set: '✅ Язык: русский',
    disclaimer: '\n<i>Уточняйте цену и наличие в аптеке. Сайт не заменяет консультацию врача.</i>',
    alert_available: '🔔 <b>{name}</b> появился в аптеках! Самая низкая цена: <b>{price}</b>{city}.',
    alert_price: '📉 Цена на <b>{name}</b> снизилась: <b>{price}</b> (было {old}){city}.',
    reset_code: '🔐 Код восстановления пароля DORI TOP: <b>{code}</b>\nДействует 10 минут. Если вы не запрашивали код, просто проигнорируйте сообщение.',
    res_new: '🆕 <b>Новая бронь</b> #{code}\n🏥 {pharmacy}\n👤 {name}, {phone}\n{items}\n💰 Итого: <b>{total}</b>{note}',
    res_btn_confirm: '✅ Подтвердить (3 часа)',
    res_btn_reject: '❌ Отклонить',
    res_status: '📦 Бронь #{code} ({pharmacy}): <b>{status}</b>{note}',
    res_done: 'Готово: {status}',
    res_forbidden: 'Нет прав на эту бронь или она уже обработана.',
    status_confirmed: 'подтверждена — держим до {until}',
    status_rejected: 'отклонена',
    status_cancelled: 'отменена',
    status_completed: 'выполнена',
    status_expired: 'истекла',
    stale: '⏰ <b>Пора обновить цены</b>\n\n{list}\n\nАптеки, где цены не обновлялись {days}+ дней, помечаются в поиске как «устаревшие». Если цены не изменились, нажмите «Подтвердить цены» в кабинете.{link}',
    report_new: '⚠️ Пользователь сообщил, что цена/наличие <b>{name}</b> в <b>{pharmacy}</b> неверны. Проверьте в кабинете.',
    req_new: '📝 Новая заявка аптеки: <b>{name}</b> ({city}).',
    req_approved: '🎉 Ваша заявка на аптеку «{name}» одобрена! Теперь можно добавлять лекарства и цены в кабинете.',
    req_rejected: '❌ Заявка «{name}» отклонена. Комментарий: {note}',
    too_fast: 'Помедленнее, пожалуйста 🙂',
    help: 'Напишите название лекарства. /city — город, /my — подписки, /lang — язык.'
  }
};

function text(lang, key, vars = {}) {
  const dict = T[lang] || T.uz;
  const tpl = dict[key] ?? T.uz[key] ?? key;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
}

function price(n, lang = 'uz') {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (lang === 'ru' ? ' сум' : ' so‘m');
}

// ---------------------------------------------------------------- chat sozlamalari
function chatPrefs(chatId, from) {
  lazy();
  let row = db.prepare('SELECT * FROM telegram_chats WHERE chat_id = ?').get(String(chatId));
  if (!row) {
    const linked = db.prepare('SELECT lang FROM users WHERE telegram_chat_id = ?').get(String(chatId));
    const lang = linked ? linked.lang : (from && /^ru|^uk|^be|^kk/.test(from.language_code || '') ? 'ru' : 'uz');
    db.prepare('INSERT OR IGNORE INTO telegram_chats (chat_id, lang) VALUES (?, ?)').run(String(chatId), lang);
    row = { chat_id: String(chatId), lang, city: 'all' };
  }
  return row;
}

function chatLang(chatId) {
  lazy();
  const u = db.prepare('SELECT lang FROM users WHERE telegram_chat_id = ?').get(String(chatId));
  if (u) return u.lang;
  const c = db.prepare('SELECT lang FROM telegram_chats WHERE chat_id = ?').get(String(chatId));
  return c ? c.lang : 'uz';
}

// ---------------------------------------------------------------- yangilanishlarni qayta ishlash
const chatHits = new Map();
function tooFast(chatId) {
  const now = Date.now();
  const r = chatHits.get(chatId) || { n: 0, reset: now + 60000 };
  if (r.reset < now) { r.n = 0; r.reset = now + 60000; }
  r.n++;
  chatHits.set(chatId, r);
  return r.n > 30;
}

function searchMedicines(q, city) {
  const clause = L.buildSearchClause(q, ['m.name', 'm.active_ingredient']);
  return db.prepare(`
    SELECT m.id, m.name, m.dosage,
           MIN(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN i.price END) AS min_price
    FROM medicines m LEFT JOIN inventory i ON i.medicine_id = m.id LEFT JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE ${clause.sql} GROUP BY m.id ORDER BY (min_price IS NULL), m.name LIMIT 8
  `).all(city, city, ...clause.params);
}

function offersMessage(medId, prefs) {
  const lang = prefs.lang;
  const med = db.prepare('SELECT * FROM medicines WHERE id = ?').get(medId);
  if (!med) return null;
  const rows = db.prepare(`
    SELECT i.price, i.status, p.id, p.name, p.address, p.city, p.phone, p.is_247, p.open_time, p.close_time, p.schedule, p.verified
    FROM inventory i JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE i.medicine_id = ? AND i.status != 'out' AND (? = 'all' OR p.city = ?)
    ORDER BY i.price ASC LIMIT 6
  `).all(medId, prefs.city, prefs.city);
  let msg = text(lang, 'offers_title', {
    name: esc(`${med.name}${med.dosage ? ' ' + med.dosage : ''}`),
    rx: med.prescription ? text(lang, 'rx') : '',
    city: esc(prefs.city === 'all' ? text(lang, 'city_all') : prefs.city)
  });
  if (!rows.length) msg += '\n' + text(lang, 'no_offers');
  rows.forEach((r, i) => {
    const open = U.isOpenNow(r);
    msg += `\n${i + 1}. <b>${price(r.price, lang)}</b> — ${esc(r.name)}${r.verified ? ' ✔️' : ''}\n   ${esc(r.city)}, ${esc(r.address)}\n   📞 ${esc(r.phone)} • ${open ? '🟢 ' + text(lang, 'open') : '🔴 ' + text(lang, 'closed')}`;
  });
  msg += '\n' + text(lang, 'disclaimer');
  const kb = [
    [{ text: text(lang, 'btn_watch_available'), callback_data: `w:a:${medId}` }],
    [{ text: text(lang, 'btn_watch_price'), callback_data: `w:p:${medId}` }]
  ];
  if (config.SITE_URL && med.slug) kb.push([{ text: text(lang, 'btn_site'), url: `${config.SITE_URL}/dori/${med.slug}` }]);
  return { text: msg, reply_markup: { inline_keyboard: kb } };
}

function citiesList() {
  return db.prepare('SELECT DISTINCT city FROM pharmacies ORDER BY city ASC LIMIT 30').all().map(r => r.city);
}

async function handleMessage(msg) {
  const chatId = String(msg.chat.id);
  if (msg.chat.type !== 'private') return;
  if (tooFast(chatId)) return send(chatId, text(chatLang(chatId), 'too_fast'));
  const prefs = chatPrefs(chatId, msg.from);
  const lang = chatLang(chatId);
  const body = String(msg.text || '').trim();
  if (!body) return null;

  if (body.startsWith('/start')) {
    const arg = body.split(/\s+/)[1] || '';
    if (arg.startsWith('link_')) return linkAccount(chatId, arg.slice(5), lang);
    if (/^m_\d+$/.test(arg)) {
      const m = offersMessage(parseInt(arg.slice(2), 10), prefs);
      if (m) return send(chatId, m.text, { reply_markup: m.reply_markup });
    }
    return send(chatId, text(lang, 'welcome'));
  }
  if (body === '/help') return send(chatId, text(lang, 'help'));
  if (body === '/lang') {
    return send(chatId, 'Til / Язык:', { reply_markup: { inline_keyboard: [[{ text: 'O‘zbekcha', callback_data: 'l:uz' }, { text: 'Русский', callback_data: 'l:ru' }]] } });
  }
  if (body === '/city') {
    const cities = citiesList();
    const kb = [[{ text: text(lang, 'city_all'), callback_data: 'c:all' }]];
    for (let i = 0; i < cities.length; i += 2) {
      kb.push(cities.slice(i, i + 2).map((c, j) => ({ text: c, callback_data: `c:${i + j}` })));
    }
    return send(chatId, text(lang, 'city_choose'), { reply_markup: { inline_keyboard: kb } });
  }
  if (body === '/my') return sendWatches(chatId, lang);
  if (body.startsWith('/')) return send(chatId, text(lang, 'help'));

  const q = U.cleanStr(body, 80);
  if (q.length < 2) return send(chatId, text(lang, 'help'));
  const rows = searchMedicines(q, prefs.city);
  try { L.recordSearch(q, rows.some(r => r.min_price !== null)); } catch (_) {}
  if (!rows.length) return send(chatId, text(lang, 'not_found', { q: esc(q) }));
  if (rows.length === 1) {
    const m = offersMessage(rows[0].id, prefs);
    return send(chatId, m.text, { reply_markup: m.reply_markup });
  }
  const kb = rows.map(r => [{
    text: `${r.name}${r.dosage ? ' ' + r.dosage : ''} — ${r.min_price !== null ? price(r.min_price, lang) + ' ' + text(lang, 'from') : text(lang, 'unavailable')}`.slice(0, 60),
    callback_data: `m:${r.id}`
  }]);
  return send(chatId, text(lang, 'choose'), { reply_markup: { inline_keyboard: kb } });
}

function linkAccount(chatId, code, lang) {
  const row = db.prepare('SELECT * FROM telegram_links WHERE code = ?').get(String(code).slice(0, 64));
  if (!row || row.expires_at < Date.now()) return send(chatId, text(lang, 'link_bad'));
  const user = db.prepare('SELECT id, full_name, lang FROM users WHERE id = ?').get(row.user_id);
  if (!user) return send(chatId, text(lang, 'link_bad'));
  db.transaction(() => {
    db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?').run(chatId);
    db.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?').run(chatId, user.id);
    db.prepare('DELETE FROM telegram_links WHERE code = ?').run(row.code);
    db.prepare('UPDATE telegram_chats SET lang = ? WHERE chat_id = ?').run(user.lang, chatId);
  })();
  return send(chatId, text(user.lang, 'linked', { name: esc(user.full_name) }));
}

function sendWatches(chatId, lang) {
  const user = db.prepare('SELECT id FROM users WHERE telegram_chat_id = ?').get(chatId);
  const rows = db.prepare(`
    SELECT w.id, w.kind, m.name, m.dosage FROM watches w JOIN medicines m ON m.id = w.medicine_id
    WHERE w.chat_id = ? OR (w.user_id IS NOT NULL AND w.user_id = ?) ORDER BY w.id DESC LIMIT 20
  `).all(chatId, user ? user.id : -1);
  if (!rows.length) return send(chatId, text(lang, 'my_empty'));
  const kb = rows.map(r => [{ text: `${r.kind === 'price' ? '📉' : '🔔'} ${r.name}${r.dosage ? ' ' + r.dosage : ''} ✖`.slice(0, 60), callback_data: `uw:${r.id}` }]);
  return send(chatId, text(lang, 'my_title'), { reply_markup: { inline_keyboard: kb } });
}

async function handleCallback(cb) {
  const chatId = String(cb.message && cb.message.chat ? cb.message.chat.id : cb.from.id);
  const data = String(cb.data || '');
  const prefs = chatPrefs(chatId, cb.from);
  const lang = chatLang(chatId);
  const answer = (t) => callApi('answerCallbackQuery', { callback_query_id: cb.id, text: t || '' }).catch(() => {});
  if (tooFast(chatId)) return answer(text(lang, 'too_fast'));

  let m;
  if ((m = /^m:(\d+)$/.exec(data))) {
    const msg = offersMessage(parseInt(m[1], 10), prefs);
    await answer();
    if (msg) return send(chatId, msg.text, { reply_markup: msg.reply_markup });
    return null;
  }
  if ((m = /^w:([ap]):(\d+)$/.exec(data))) {
    const kind = m[1] === 'a' ? 'available' : 'price';
    const medId = parseInt(m[2], 10);
    if (!db.prepare('SELECT id FROM medicines WHERE id = ?').get(medId)) return answer();
    const count = db.prepare('SELECT COUNT(*) AS c FROM watches WHERE chat_id = ?').get(chatId).c;
    if (count >= 20) return answer(text(lang, 'watch_limit'));
    const cur = L.currentMinPrice(medId, prefs.city);
    const info = db.prepare('INSERT INTO watches (chat_id, medicine_id, city, kind, last_min_price) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(chatId, medId, prefs.city, kind, cur.min_price ?? null);
    return answer(text(lang, info.changes ? 'watch_ok' : 'watch_exists'));
  }
  if ((m = /^uw:(\d+)$/.exec(data))) {
    const user = db.prepare('SELECT id FROM users WHERE telegram_chat_id = ?').get(chatId);
    db.prepare('DELETE FROM watches WHERE id = ? AND (chat_id = ? OR (user_id IS NOT NULL AND user_id = ?))').run(parseInt(m[1], 10), chatId, user ? user.id : -1);
    return answer(text(lang, 'removed'));
  }
  if ((m = /^c:(all|\d+)$/.exec(data))) {
    const city = m[1] === 'all' ? 'all' : citiesList()[parseInt(m[1], 10)];
    if (!city) return answer();
    db.prepare('UPDATE telegram_chats SET city = ? WHERE chat_id = ?').run(city, chatId);
    await answer();
    return send(chatId, text(lang, 'city_set', { city: esc(city === 'all' ? text(lang, 'city_all') : city) }));
  }
  if ((m = /^l:(uz|ru)$/.exec(data))) {
    db.prepare('UPDATE telegram_chats SET lang = ? WHERE chat_id = ?').run(m[1], chatId);
    db.prepare('UPDATE users SET lang = ? WHERE telegram_chat_id = ?').run(m[1], chatId);
    await answer();
    return send(chatId, text(m[1], 'lang_set'));
  }
  if ((m = /^rs:([cr]):(\d+)$/.exec(data))) {
    return reservationAction(chatId, lang, m[1] === 'c' ? 'confirmed' : 'rejected', parseInt(m[2], 10), answer);
  }
  return answer();
}

// Bronni Telegram tugmasi orqali tasdiqlash/rad etish — faqat dorixona egasi (yoki admin)
async function reservationAction(chatId, lang, status, resId, answer) {
  const user = db.prepare('SELECT id, role FROM users WHERE telegram_chat_id = ? AND blocked_at IS NULL').get(chatId);
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(resId);
  if (!user || !r || r.status !== 'pending' || !L.canManagePharmacy(user, r.pharmacy_id)) return answer(text(lang, 'res_forbidden'));
  if (status === 'confirmed') {
    db.prepare("UPDATE reservations SET status = 'confirmed', hold_until = datetime('now', '+180 minutes'), updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(resId);
  } else {
    db.prepare("UPDATE reservations SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(resId);
  }
  L.audit({ user, ip: 'telegram' }, 'reservation_' + status, 'reservation', resId, { pharmacy_id: r.pharmacy_id, via: 'telegram' });
  L.bus.emit('reservation:status', { id: resId, status, by: 'pharmacy' });
  return answer(text(lang, 'res_done', { status: text(lang, 'status_' + status, { until: '' }).replace(/ — .*$/, '') }));
}

async function handleUpdate(update) {
  lazy();
  try {
    if (update.message) return await handleMessage(update.message);
    if (update.callback_query) return await handleCallback(update.callback_query);
  } catch (err) {
    console.error('[telegram] update xatosi:', err);
  }
  return null;
}

// ---------------------------------------------------------------- polling
async function startPolling() {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_POLLING || running) return;
  running = true;
  try { await callApi('deleteWebhook', { drop_pending_updates: false }); } catch (err) { console.warn('[telegram]', err.message); }
  try {
    const me = await callApi('getMe');
    if (!config.TELEGRAM_BOT_USERNAME) config.TELEGRAM_BOT_USERNAME = me.username;
    console.log(`[telegram] bot ishga tushdi: @${me.username}`);
  } catch (err) {
    console.error('[telegram] getMe xatosi (token to‘g‘rimi?):', err.message);
  }
  let backoff = 1000;
  while (running) {
    try {
      const updates = await callApi('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35000);
      backoff = 1000;
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u);
      }
    } catch (err) {
      if (!running) break;
      console.warn('[telegram] polling xatosi:', err.message);
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

function stopPolling() { running = false; }

module.exports = { enabled, send, text, esc, price, callApi, setTransport, handleUpdate, startPolling, stopPolling, chatLang };
