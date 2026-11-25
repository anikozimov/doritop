'use strict';

const crypto = require('crypto');

const TZ = process.env.APP_TIMEZONE || 'Asia/Tashkent';
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// ---------------------------------------------------------------- vaqt
function parseTime(str) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(str || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function normalizeTime(str) {
  const mins = parseTime(str);
  if (mins === null) return null;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function nowMinutes(date = new Date()) {
  const parts = timeFmt.formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour').value);
  const m = Number(parts.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

function weekdayOf(date = new Date()) {
  return WEEKDAYS[weekdayFmt.format(date)];
}

// Toshkent vaqti bo'yicha "YYYY-MM-DD"
function dayKey(date = new Date()) {
  return dayFmt.format(date);
}

// Haftalik jadval: { "0": {closed:true} | {open:"08:00", close:"22:00"}, ... "6" }  (0 = yakshanba)
function parseSchedule(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch (_) { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (let d = 0; d < 7; d++) {
    const v = obj[d] ?? obj[String(d)];
    if (!v || typeof v !== 'object') return null;
    if (v.closed === true || v.closed === 'true' || v.closed === 1) { out[d] = { closed: true }; continue; }
    const open = normalizeTime(v.open);
    const close = normalizeTime(v.close);
    if (!open || !close) return null;
    out[d] = { open, close };
  }
  return out;
}

function dayDef(pharmacy, sched, d) {
  if (sched) return sched[d];
  return { open: pharmacy.open_time, close: pharmacy.close_time };
}

// Server qaysi vaqt zonasida ishlashidan qat'i nazar, O'zbekiston vaqti bo'yicha hisoblaydi.
// Haftalik jadval (yakshanba boshqacha bo'lishi mumkin) va tungi smena (22:00-06:00) qo'llanadi.
function isOpenNow(pharmacy, date = new Date()) {
  if (pharmacy.is_247) return true;
  const sched = parseSchedule(pharmacy.schedule);
  const d = weekdayOf(date);
  const now = nowMinutes(date);

  const today = dayDef(pharmacy, sched, d);
  if (today && !today.closed) {
    const open = parseTime(today.open);
    const close = parseTime(today.close);
    if (open !== null && close !== null && open !== close) {
      if (close > open && now >= open && now < close) return true;
      if (close < open && now >= open) return true;
    }
  }
  const prev = dayDef(pharmacy, sched, (d + 6) % 7);
  if (prev && !prev.closed) {
    const open = parseTime(prev.open);
    const close = parseTime(prev.close);
    if (open !== null && close !== null && close < open && now < close) return true;
  }
  return false;
}

// Bugungi ish vaqti: { is_247 } | { closed } | { open, close }
function todayHours(pharmacy, date = new Date()) {
  if (pharmacy.is_247) return { is_247: true };
  const sched = parseSchedule(pharmacy.schedule);
  const t = dayDef(pharmacy, sched, weekdayOf(date));
  if (!t || t.closed) return { closed: true };
  return { open: t.open, close: t.close };
}

// ---------------------------------------------------------------- telefon
function legacyNormalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').trim();
}

// 901234567 / 998901234567 / +998 90 123 45 67  ->  +998901234567
function normalizePhone(phone) {
  const cleaned = legacyNormalizePhone(phone);
  const hasPlus = cleaned.startsWith('+');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 9) return '+998' + digits;
  if (digits.length === 12 && digits.startsWith('998')) return '+' + digits;
  return (hasPlus ? '+' : '') + digits;
}

function isValidUserPhone(p) {
  return /^\+?\d{9,15}$/.test(p);
}

// ---------------------------------------------------------------- matn
function cleanStr(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, ch => '\\' + ch);
}

// ---------------------------------------------------------------- kirill -> lotin
const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya',
  ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h'
};

function hasCyrillic(s) {
  return /[\u0400-\u04FF]/.test(s);
}

function transliterate(s, cAsTs = true) {
  return String(s).toLowerCase().replace(/[\u0400-\u04FF]/g, ch => {
    if (ch === 'ц' && !cAsTs) return 'c';
    return CYR[ch] ?? ch;
  });
}

// Qidiruv so'zining variantlari: kirill yozilsa lotin ko'rinishlari ham qidiriladi.
function searchVariants(q) {
  const base = cleanStr(q, 100);
  if (!base) return [];
  const set = new Set([base]);
  if (hasCyrillic(base)) {
    set.add(transliterate(base, true));
    set.add(transliterate(base, false));
  }
  return [...set].filter(Boolean);
}

// ---------------------------------------------------------------- CSV
function detectDelimiter(headerLine) {
  const semi = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  return semi > comma ? ';' : ',';
}

function parseCsvLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { result.push(current.trim()); current = ''; }
    else current += ch;
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------- geo
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// SQLite CURRENT_TIMESTAMP (UTC, "YYYY-MM-DD HH:MM:SS") -> necha kun oldin
function daysSince(sqliteTs) {
  const t = Date.parse(String(sqliteTs || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// ---------------------------------------------------------------- slug / normallashtirish
function slugify(s) {
  return transliterate(String(s || ''), true)
    .replace(/['ʻʼ‘’`]/g, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

// "Paratsetamol", "Paracetamol", "Парацетамол" -> bir xil kalit (dublikatlarni topish uchun)
function normKey(s) {
  let k = transliterate(String(s || ''), true)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  k = k.replace(/sh/g, '$').replace(/ch/g, '%').replace(/ts/g, 'c').replace(/ph/g, 'f')
    .replace(/x/g, 'ks').replace(/y/g, 'i').replace(/w/g, 'v').replace(/[cq]/g, 'k')
    .replace(/(.)\1+/g, '$1');
  return k.replace(/\$/g, 'sh').replace(/%/g, 'ch');
}

// ---------------------------------------------------------------- CSV eksport
// Excel formula injection'dan himoya: =, +, -, @ bilan boshlangan matnga ' qo'shiladi
function csvEscape(value, delimiter = ',') {
  let s = value === null || value === undefined ? '' : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(delimiter) || s.includes('"') || /[\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------------------------------------------------------------- telefonlar ro'yxati
function parsePhones(input, max = 3) {
  const arr = Array.isArray(input) ? input : String(input || '').split(/[,;\n]/);
  const out = [];
  for (const raw of arr) {
    const p = cleanStr(raw, 30);
    const digits = p.replace(/\D/g, '');
    if (!p) continue;
    if (digits.length < 5 || digits.length > 15) return null;
    if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, max);
}

function randomCode(len = 6, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

module.exports = {
  parseTime, normalizeTime, isOpenNow, todayHours, parseSchedule, weekdayOf, dayKey,
  legacyNormalizePhone, normalizePhone, isValidUserPhone, parsePhones,
  cleanStr, escapeLike, searchVariants, transliterate, slugify, normKey,
  detectDelimiter, parseCsvLine, csvEscape,
  haversineKm, validCoords, daysSince, randomCode, sha256
};
