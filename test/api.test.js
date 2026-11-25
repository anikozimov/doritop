'use strict';
// To'liq API integratsiya testlari: haqiqiy HTTP server + vaqtinchalik SQLite baza
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dori-api-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmp, 'api.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.ADMIN_PHONE = '+998900000001';
process.env.ADMIN_SETUP_CODE = 'setup-secret-123';
process.env.ADMIN_2FA_REQUIRED = 'false';
process.env.JWT_SECRET = 'x'.repeat(48);

const tg = require('../src/telegram');
const sent = [];
tg.setTransport(async (method, payload) => {
  sent.push({ method, payload });
  return method === 'sendMessage' ? { message_id: sent.length } : true;
});

const app = require('../src/app');
const db = require('../src/db');
const config = require('../src/config');
const totp = require('../src/totp');
const notify = require('../src/notify');
const jobs = require('../src/jobs');
const authRoutes = require('../src/routes/auth');

let base;
let server;

async function req(method, p, { token, body, lang, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  if (lang) headers['X-Lang'] = lang;
  const res = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function register(name, phone, extra = {}) {
  const r = await req('POST', '/api/auth/register', { body: { full_name: name, phone, password: 'parol12345', accept_terms: true, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

const S = {}; // testlar orasida umumiy holat

test.before(async () => {
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { tg.setTransport(null); server.close(); });
test.beforeEach(() => authRoutes._resetLimits());

// =========================================================================
test('ro‘yxatdan o‘tish: shartlarga rozilik, ADMIN_PHONE uchun sozlash kodi', async () => {
  let r = await req('POST', '/api/auth/register', { body: { full_name: 'Ali', phone: '901112233', password: 'parol12345' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'auth.accept_terms');

  // Admin raqami kodsiz — rad etiladi (begona odam admin bo'lib olmasligi kerak)
  r = await req('POST', '/api/auth/register', { body: { full_name: 'Hacker', phone: '+998900000001', password: 'parol12345', accept_terms: true } });
  assert.equal(r.status, 403);
  r = await req('POST', '/api/auth/register', { body: { full_name: 'Hacker', phone: '+998900000001', password: 'parol12345', accept_terms: true, setup_code: 'wrong' } });
  assert.equal(r.status, 403);

  const admin = await register('Admin', '+998900000001', { setup_code: 'setup-secret-123' });
  assert.equal(admin.user.role, 'admin');
  S.admin = admin.token;

  const u = await register('Ali Valiyev', '90 111 22 33');
  assert.equal(u.user.role, 'user');
  assert.equal(u.user.phone, '+998901112233');
  S.user = u.token;
  S.userId = u.user.id;

  r = await req('POST', '/api/auth/register', { body: { full_name: 'Dup', phone: '+998901112233', password: 'parol12345', accept_terms: true } });
  assert.equal(r.status, 409);
});

test('server xabarlari rus tilida (X-Lang: ru)', async () => {
  const r = await req('POST', '/api/auth/login', { body: { phone: '+998901112233', password: 'xato-parol' }, lang: 'ru' });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /Неверный/);
});

test('telefon bo‘yicha bloklash: 10 ta xato urinishdan keyin to‘g‘ri parol ham qabul qilinmaydi', async () => {
  await register('Lock', '+998905550000');
  for (let i = 0; i < 10; i++) await req('POST', '/api/auth/login', { body: { phone: '+998905550000', password: 'xato' + i } });
  const r = await req('POST', '/api/auth/login', { body: { phone: '+998905550000', password: 'parol12345' } });
  assert.equal(r.status, 429);
  assert.equal(r.data.code, 'auth.phone_locked');
});

test('parol o‘zgarsa eski tokenlar yaroqsiz bo‘ladi (token_version)', async () => {
  const u = await register('Tok', '+998905551111');
  let r = await req('POST', '/api/auth/me/password', { token: u.token, body: { current_password: 'parol12345', new_password: 'yangiParol99' } });
  assert.equal(r.status, 200);
  const old = await req('GET', '/api/auth/me', { token: u.token });
  assert.equal(old.status, 401);
  const fresh = await req('GET', '/api/auth/me', { token: r.data.token });
  assert.equal(fresh.status, 200);
  // logout-all
  await req('POST', '/api/auth/me/logout-all', { token: r.data.token });
  assert.equal((await req('GET', '/api/auth/me', { token: r.data.token })).status, 401);
});

test('2FA (TOTP): yoqish, login 2 bosqichda, kodni qayta ishlatib bo‘lmaydi', async () => {
  const u = await register('Twofa', '+998905552222');
  const setup = await req('POST', '/api/auth/me/2fa/setup', { token: u.token });
  assert.equal(setup.status, 200);
  assert.ok(setup.data.secret && setup.data.qr_svg.includes('<svg'));
  const code = totp.hotp(setup.data.secret, Math.floor(Date.now() / 30000));
  const en = await req('POST', '/api/auth/me/2fa/enable', { token: u.token, body: { code } });
  assert.equal(en.status, 200);
  assert.equal(en.data.user.totp_enabled, true);

  const login = await req('POST', '/api/auth/login', { body: { phone: '+998905552222', password: 'parol12345' } });
  assert.equal(login.data.need_2fa, true);
  assert.ok(!login.data.token);
  // xuddi shu kod (yoqishda ishlatilgan) qayta qabul qilinmaydi
  let r = await req('POST', '/api/auth/2fa', { body: { ticket: login.data.ticket, code } });
  assert.equal(r.status, 401);
  const next = totp.hotp(setup.data.secret, Math.floor(Date.now() / 30000) + 1);
  r = await req('POST', '/api/auth/2fa', { body: { ticket: login.data.ticket, code: next } });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  // chipta oddiy token sifatida ishlamaydi
  assert.equal((await req('GET', '/api/auth/me', { token: login.data.ticket })).status, 401);
});

test('admin 2FA majburiy bo‘lsa, admin amallari 2FA yoqilmaguncha yopiq', async () => {
  config.ADMIN_2FA_REQUIRED = true;
  const r = await req('GET', '/api/admin/overview', { token: S.admin });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'auth.2fa_setup_required');
  config.ADMIN_2FA_REQUIRED = false;
  assert.equal((await req('GET', '/api/admin/overview', { token: S.admin })).status, 200);
});

// =========================================================================
test('dorixona arizasi -> admin tasdiqlaydi -> ega, tasdiqlangan belgi, Telegram xabari', async () => {
  const owner = await register('Ega Bir', '+998907770001');
  S.owner = owner.token;
  S.ownerId = owner.user.id;
  let r = await req('POST', '/api/pharmacy-requests', { token: S.owner, body: { name: 'Shifo Farm', license_number: 'LIC-1', city: 'Andijon', address: 'Navoiy 1', phone: '+998742230000', lat: 40.78, lng: 72.34 } });
  assert.equal(r.status, 201);
  r = await req('POST', '/api/pharmacy-requests', { token: S.owner, body: { name: 'Ikkinchi', license_number: 'LIC-2', city: 'Andijon', address: 'Navoiy 2', phone: '+998742230001', lat: 40.78, lng: 72.34 } });
  assert.equal(r.status, 409);

  const ov = await req('GET', '/api/admin/overview', { token: S.admin });
  const reqId = ov.data.requests.find(x => x.license_number === 'LIC-1').id;
  r = await req('POST', `/api/admin/requests/${reqId}/approve`, { token: S.admin, body: { verified: true } });
  assert.equal(r.status, 200);
  S.ph1 = r.data.pharmacy_id;
  const me = await req('GET', '/api/auth/me', { token: S.owner });
  assert.equal(me.data.user.role, 'pharmacy_owner');
  const mine = await req('GET', '/api/my/pharmacies', { token: S.owner });
  assert.equal(mine.data.pharmacies[0].verified, true);

  // ikkinchi ega (IDOR tekshiruvi uchun)
  const o2 = await register('Ega Ikki', '+998907770002');
  S.owner2 = o2.token;
  await req('POST', '/api/pharmacy-requests', { token: S.owner2, body: { name: 'Dori Plus', license_number: 'LIC-9', city: 'Toshkent', address: 'Amir Temur 5', phone: '+998712000000', lat: 41.3, lng: 69.2 } });
  const ov2 = await req('GET', '/api/admin/overview', { token: S.admin });
  const r2 = await req('POST', `/api/admin/requests/${ov2.data.requests.find(x => x.license_number === 'LIC-9').id}/approve`, { token: S.admin, body: { verified: false } });
  S.ph2 = r2.data.pharmacy_id;
});

test('katalog: o‘xshash nom dublikat sifatida aniqlanadi (paracetamol ~ paratsetamol)', async () => {
  let r = await req('POST', '/api/medicines', { token: S.admin, body: { name: 'Paratsetamol', active_ingredient: 'Paratsetamol', dosage: '500 mg', category: 'Og‘riq' } });
  assert.equal(r.status, 201);
  S.medPara = r.data.medicine.id;
  assert.equal(r.data.medicine.slug, 'paratsetamol-500-mg');
  r = await req('POST', '/api/medicines', { token: S.owner, body: { name: 'Paracetamol', active_ingredient: 'Paracetamol', dosage: '500 mg' } });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'medicine.similar_exists');
  assert.equal(r.data.similar[0].id, S.medPara);
  r = await req('POST', '/api/medicines', { token: S.owner, body: { name: 'Amoksitsillin', active_ingredient: 'Amoksitsillin', dosage: '500 mg', prescription: true } });
  assert.equal(r.status, 201);
  assert.equal(r.data.medicine.verified, false); // ega qo'shgan dori admin tekshiruvini kutadi
  S.medAmox = r.data.medicine.id;
  // kirillcha qidiruv
  const ac = await req('GET', '/api/medicines/autocomplete?q=' + encodeURIComponent('парацетамол'));
  assert.ok(ac.data.medicines.some(m => m.id === S.medPara));
  const sug = await req('GET', `/api/medicines/suggest?q=paracetamol&pharmacy_id=${S.ph1}`, { token: S.owner });
  assert.ok(sug.data.medicines.some(m => m.id === S.medPara));
});

test('ombor: qo‘shish, IDOR himoyasi, audit log', async () => {
  let r = await req('POST', `/api/pharmacies/${S.ph1}/inventory`, { token: S.owner, body: { medicine_id: S.medPara, price: 3500, status: 'available' } });
  assert.equal(r.status, 201);
  r = await req('POST', `/api/pharmacies/${S.ph2}/inventory`, { token: S.owner2, body: { medicine_id: S.medPara, price: 3000, status: 'available' } });
  assert.equal(r.status, 201);
  // Boshqa egadagi dorixonaga yozib bo'lmaydi
  r = await req('POST', `/api/pharmacies/${S.ph2}/inventory`, { token: S.owner, body: { medicine_id: S.medPara, price: 1, status: 'available' } });
  assert.equal(r.status, 403);
  const inv = await req('GET', `/api/pharmacies/${S.ph1}/inventory`, { token: S.owner });
  S.inv1 = inv.data.inventory[0].id;
  const inv2 = await req('GET', `/api/pharmacies/${S.ph2}/inventory`, { token: S.owner2 });
  S.inv2 = inv2.data.inventory[0].id;
  r = await req('PATCH', `/api/inventory/${S.inv2}`, { token: S.owner, body: { price: 1 } });
  assert.equal(r.status, 403);
  r = await req('DELETE', `/api/inventory/${S.inv2}`, { token: S.owner });
  assert.equal(r.status, 403);
  r = await req('GET', `/api/pharmacies/${S.ph2}/stats`, { token: S.owner });
  assert.equal(r.status, 403);
  // oddiy foydalanuvchi ega route'lariga kira olmaydi
  assert.equal((await req('GET', '/api/medicines', { token: S.user })).status, 403);

  r = await req('PATCH', `/api/inventory/${S.inv1}`, { token: S.owner, body: { price: 4000, status: 'low' } });
  assert.equal(r.status, 200);
  const audit = await req('GET', `/api/admin/audit?entity=inventory&pharmacy_id=${S.ph1}`, { token: S.admin });
  const upd = audit.data.entries.find(e => e.action === 'price_update');
  assert.deepEqual(upd.details.from, { price: 3500, status: 'available' });
  assert.deepEqual(upd.details.to, { price: 4000, status: 'low' });
});

test('ommaviy narx: +5% (oldindan ko‘rish va qo‘llash), noto‘g‘ri foiz rad etiladi', async () => {
  let r = await req('POST', `/api/pharmacies/${S.ph1}/inventory/bulk-price`, { token: S.owner, body: { percent: 5, round_to: 100, dry_run: true } });
  assert.equal(r.data.affected, 1);
  assert.equal(r.data.sample[0].to, 4200);
  r = await req('POST', `/api/pharmacies/${S.ph1}/inventory/bulk-price`, { token: S.owner, body: { percent: 5, round_to: 100 } });
  assert.equal(r.data.updated, 1);
  r = await req('POST', `/api/pharmacies/${S.ph1}/inventory/bulk-price`, { token: S.owner, body: { percent: 1000 } });
  assert.equal(r.status, 400);
  const inv = await req('GET', `/api/pharmacies/${S.ph1}/inventory`, { token: S.owner });
  assert.equal(inv.data.inventory[0].price, 4200);
});

test('CSV import: ustun nomlari (ruscha), narx formatlari, xatolar ro‘yxati, missing_as_out', async () => {
  const csv = '﻿Название;Цена;Наличие;Дозировка\n' +
    'Paracetamol;"3 900";есть;500 mg\n' + // o'xshash nom -> mavjud doriga ulanadi
    'Ibuprofen;6000,00;мало;200 mg\n' +
    'Analgin;abc;есть;500 mg\n' +
    ';5000;есть;\n';
  const r = await req('POST', `/api/pharmacies/${S.ph1}/inventory/import-csv`, { token: S.owner, body: { csv } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.imported, 2);
  assert.equal(r.data.created_medicines, 1);
  assert.deepEqual(r.data.errors.map(e => [e.line, e.error]), [[4, 'price'], [5, 'name']]);
  const inv = await req('GET', `/api/pharmacies/${S.ph1}/inventory?q=paratsetamol`, { token: S.owner });
  assert.equal(inv.data.inventory[0].price, 3900);

  await req('POST', `/api/pharmacies/${S.ph1}/inventory`, { token: S.owner, body: { medicine_id: S.medAmox, price: 18000 } });
  const r2 = await req('POST', `/api/pharmacies/${S.ph1}/inventory/import-csv`, { token: S.owner, body: { csv: 'name,dosage,price\nParatsetamol,500 mg,3900\n', missing_as_out: true } });
  assert.equal(r2.data.marked_out >= 1, true);
});

test('CSV eksport: Excel formula injection’dan himoya', async () => {
  await req('POST', '/api/medicines', { token: S.admin, body: { name: '=HYPERLINK("http://evil")', active_ingredient: 'x', force: true } });
  const m = db.prepare("SELECT id FROM medicines WHERE name LIKE '=HYPER%'").get();
  await req('POST', `/api/pharmacies/${S.ph1}/inventory`, { token: S.owner, body: { medicine_id: m.id, price: 100 } });
  const r = await req('GET', `/api/pharmacies/${S.ph1}/inventory/export`, { token: S.owner, raw: true });
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(!/\n=HYPERLINK/.test(r.text));
});

test('qidiruv natijalari: tasdiqlangan belgi, narx filtri, ko‘rishlar statistikasi', async () => {
  let r = await req('GET', `/api/medicines/${S.medPara}/offers?city=all`);
  assert.equal(r.status, 200);
  assert.equal(r.data.offers.length, 2);
  const verified = r.data.offers.find(o => o.pharmacy_id === S.ph1);
  assert.equal(verified.verified, true);
  assert.ok(verified.inventory_id && verified.today);
  r = await req('GET', `/api/medicines/${S.medPara}/offers?verified=true`);
  assert.equal(r.data.offers.length, 1);
  r = await req('GET', `/api/medicines/${S.medPara}/offers?priceMax=3500`);
  assert.deepEqual(r.data.offers.map(o => o.price), [3000]);
  const st = await req('GET', `/api/pharmacies/${S.ph1}/stats`, { token: S.owner });
  assert.ok(st.data.totals.views >= 1);
  await req('POST', '/api/events', { body: { type: 'call', pharmacy_id: S.ph1, medicine_id: S.medPara } });
  const st2 = await req('GET', `/api/pharmacies/${S.ph1}/stats`, { token: S.owner });
  assert.equal(st2.data.totals.calls, 1);
});

test('dorixona profili: jadval (yakshanba dam), telefonlar, noto‘g‘ri jadval rad etiladi', async () => {
  const schedule = { 0: { closed: true } };
  for (let d = 1; d <= 6; d++) schedule[d] = { open: '09:00', close: '21:00' };
  let r = await req('PUT', `/api/pharmacies/${S.ph1}`, { token: S.owner, body: { schedule, phones: ['+998 90 111 11 11', '+998 91 222 22 22'], name: 'Hack nomi' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.pharmacy.schedule[0].closed, true);
  assert.equal(r.data.pharmacy.phones.length, 2);
  assert.equal(r.data.pharmacy.name, 'Shifo Farm'); // ega nomni o'zgartira olmaydi
  r = await req('PUT', `/api/pharmacies/${S.ph1}`, { token: S.owner, body: { schedule: { 0: { open: '25:00', close: '1' } } } });
  assert.equal(r.status, 400);
});

test('logotip: faqat haqiqiy PNG/JPEG/WEBP; SVG va soxta rasm rad etiladi', async () => {
  const svg = 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)></svg>').toString('base64');
  let r = await req('POST', `/api/pharmacies/${S.ph1}/logo`, { token: S.owner, body: { data_url: svg } });
  assert.equal(r.status, 400);
  r = await req('POST', `/api/pharmacies/${S.ph1}/logo`, { token: S.owner, body: { data_url: 'data:image/svg+xml;base64,PHN2Zz4=' } });
  assert.equal(r.status, 400);
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  r = await req('POST', `/api/pharmacies/${S.ph1}/logo`, { token: S.owner, body: { data_url: 'data:image/png;base64,' + png.toString('base64') } });
  assert.equal(r.status, 200);
  const file = await req('GET', r.data.logo_url, { raw: true });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await req('GET', '/uploads/../api.db', { raw: true })).status, 404);
});

// =========================================================================
test('bron: yaratish, cheklovlar, ega tasdiqlaydi, Telegram tugmasi orqali tasdiqlash', async () => {
  // ega Telegram'ni ulaydi
  const link = await req('POST', '/api/auth/me/telegram/link', { token: S.owner });
  assert.equal(link.status, 400); // bot nomi yo'q
  config.TELEGRAM_BOT_USERNAME = 'doritop_test_bot';
  const link2 = await req('POST', '/api/auth/me/telegram/link', { token: S.owner });
  const code = link2.data.url.split('start=')[1];
  await tg.handleUpdate({ update_id: 1, message: { chat: { id: 5001, type: 'private' }, from: { id: 5001 }, text: '/start ' + code } });
  assert.ok((await req('GET', '/api/auth/me', { token: S.owner })).data.user.telegram_linked);
  // havola bir martalik
  await tg.handleUpdate({ update_id: 2, message: { chat: { id: 6666, type: 'private' }, from: { id: 6666 }, text: '/start ' + code } });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE telegram_chat_id = '6666'").get().c, 0);

  sent.length = 0;
  let r = await req('POST', '/api/reservations', { token: S.user, body: { pharmacy_id: S.ph1, items: [{ medicine_id: S.medPara, qty: 2 }], note: 'kechqurun' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const resv = r.data.reservation;
  assert.equal(resv.total, 3900 * 2);
  assert.match(resv.code, /^[A-Z2-9]{6}$/);
  const ownerMsg = sent.find(s => s.payload.chat_id === '5001');
  assert.ok(ownerMsg && ownerMsg.payload.reply_markup.inline_keyboard[0][0].callback_data === `rs:c:${resv.id}`);

  // tugagan dorini bron qilib bo'lmaydi
  r = await req('POST', '/api/reservations', { token: S.user, body: { pharmacy_id: S.ph1, items: [{ medicine_id: S.medAmox, qty: 1 }] } });
  assert.equal(r.status, 409);
  // ega o'z dorixonasida bron qila olmaydi
  r = await req('POST', '/api/reservations', { token: S.owner, body: { pharmacy_id: S.ph1, items: [{ medicine_id: S.medPara, qty: 1 }] } });
  assert.equal(r.status, 400);

  // begona chat tasdiqlay olmaydi
  await tg.handleUpdate({ update_id: 3, callback_query: { id: 'cb1', from: { id: 7777 }, message: { chat: { id: 7777 } }, data: `rs:c:${resv.id}` } });
  assert.equal(db.prepare('SELECT status FROM reservations WHERE id = ?').get(resv.id).status, 'pending');
  // ikkinchi ega ham API orqali tasdiqlay olmaydi
  r = await req('POST', `/api/reservations/${resv.id}/status`, { token: S.owner2, body: { status: 'confirmed' } });
  assert.equal(r.status, 404);
  // haqiqiy ega Telegram tugmasi orqali
  await tg.handleUpdate({ update_id: 4, callback_query: { id: 'cb2', from: { id: 5001 }, message: { chat: { id: 5001 } }, data: `rs:c:${resv.id}` } });
  const after = db.prepare('SELECT status, hold_until FROM reservations WHERE id = ?').get(resv.id);
  assert.equal(after.status, 'confirmed');
  assert.ok(after.hold_until);
  r = await req('POST', `/api/reservations/${resv.id}/status`, { token: S.owner, body: { status: 'completed' } });
  assert.equal(r.status, 200);
  r = await req('POST', `/api/reservations/${resv.id}/status`, { token: S.owner, body: { status: 'confirmed' } });
  assert.equal(r.status, 400); // yakunlangan bronni qayta tasdiqlab bo'lmaydi

  // faol bronlar chegarasi (3)
  for (let i = 0; i < 3; i++) {
    assert.equal((await req('POST', '/api/reservations', { token: S.user, body: { pharmacy_id: S.ph2, items: [{ medicine_id: S.medPara, qty: 1 }] } })).status, 201);
  }
  r = await req('POST', '/api/reservations', { token: S.user, body: { pharmacy_id: S.ph2, items: [{ medicine_id: S.medPara, qty: 1 }] } });
  assert.equal(r.status, 429);
  const my = await req('GET', '/api/my/reservations', { token: S.user });
  assert.equal(my.data.reservations.length, 4);
  r = await req('POST', `/api/reservations/${my.data.reservations[0].id}/cancel`, { token: S.user });
  assert.equal(r.status, 200);
});

test('bronlar muddati: 24 soatdan eski kutilayotganlar "expired" bo‘ladi', () => {
  db.prepare("UPDATE reservations SET created_at = datetime('now', '-2 days') WHERE status = 'pending'").run();
  const n = jobs.expireReservations();
  assert.ok(n >= 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservations WHERE status = 'pending'").get().c, 0);
});

test('savat: bir nechta dori, dorixona bo‘yicha jami', async () => {
  const r = await req('POST', '/api/cart/compare', { body: { items: [{ medicine_id: S.medPara, qty: 2 }, { medicine_id: S.medAmox, qty: 1 }] } });
  assert.equal(r.status, 200);
  assert.equal(r.data.requested, 2);
  const p1 = r.data.pharmacies.find(p => p.pharmacy_id === S.ph1);
  assert.equal(p1.total, 3900 * 2); // amoksitsillin "out"
  assert.equal(p1.missing, 1);
});

test('sevimlilar va kuzatuv (Telegram kerak); "kelganda xabar ber" ishlaydi', async () => {
  let r = await req('PUT', `/api/my/favorites/${S.medAmox}`, { token: S.user });
  assert.equal(r.status, 200);
  r = await req('PUT', '/api/my/watches', { token: S.user, body: { medicine_id: S.medAmox, kind: 'available' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'watch.need_telegram');
  // Telegram'dan to'g'ridan-to'g'ri kuzatuv
  await tg.handleUpdate({ update_id: 10, callback_query: { id: 'cb3', from: { id: 9001 }, message: { chat: { id: 9001 } }, data: `w:a:${S.medAmox}` } });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM watches WHERE chat_id = '9001'").get().c, 1);
  sent.length = 0;
  await req('POST', `/api/pharmacies/${S.ph1}/inventory`, { token: S.owner, body: { medicine_id: S.medAmox, price: 17000, status: 'available' } });
  const res = await notify.checkWatches([S.medAmox]);
  assert.equal(res.sent, 1);
  assert.ok(sent.some(s => s.payload.chat_id === '9001' && /17 000/.test(s.payload.text)));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM watches WHERE chat_id = '9001'").get().c, 0); // bir martalik
  const fav = await req('GET', '/api/my/favorites', { token: S.user });
  assert.equal(fav.data.favorites[0].min_price, 17000);
});

test('Telegram bot: qidiruv natijasi va HTML ekranlash', async () => {
  sent.length = 0;
  await tg.handleUpdate({ update_id: 20, message: { chat: { id: 8001, type: 'private' }, from: { id: 8001, language_code: 'ru' }, text: 'парацетамол' } });
  const msg = sent.find(s => s.method === 'sendMessage');
  assert.ok(msg, 'javob yuborilmadi');
  assert.match(msg.payload.text, /Paratsetamol/);
  assert.match(msg.payload.text, /3 000 сум/); // eng arzon birinchi, ruscha
  // dorixona nomidagi HTML ekranlanadi
  db.prepare("UPDATE pharmacies SET name = '<b>X</b>' WHERE id = ?").run(S.ph2);
  sent.length = 0;
  await tg.handleUpdate({ update_id: 21, callback_query: { id: 'cb9', from: { id: 8001 }, message: { chat: { id: 8001 } }, data: `m:${S.medPara}` } });
  const m2 = sent.find(s => s.method === 'sendMessage');
  assert.ok(m2.payload.text.includes('&lt;b&gt;X&lt;/b&gt;'));
  db.prepare("UPDATE pharmacies SET name = 'Dori Plus' WHERE id = ?").run(S.ph2);
});

test('parolni tiklash Telegram orqali: kod, 5 urinish chegarasi', async () => {
  sent.length = 0;
  let r = await req('POST', '/api/auth/reset/request', { body: { phone: '+998907770001' } });
  assert.equal(r.status, 200);
  const msg = sent.find(s => s.payload.chat_id === '5001');
  const code = /<b>(\d{6})<\/b>/.exec(msg.payload.text)[1];
  // mavjud bo'lmagan raqam uchun ham bir xil javob
  const r0 = await req('POST', '/api/auth/reset/request', { body: { phone: '+998999999999' } });
  assert.deepEqual(r0.data, r.data);
  r = await req('POST', '/api/auth/reset/confirm', { body: { phone: '+998907770001', code: '000000', password: 'yangiParol123' } });
  assert.equal(r.status, 400);
  r = await req('POST', '/api/auth/reset/confirm', { body: { phone: '+998907770001', code, password: 'yangiParol123' } });
  assert.equal(r.status, 200);
  assert.equal((await req('GET', '/api/auth/me', { token: S.owner })).status, 401); // eski sessiya yopildi
  r = await req('POST', '/api/auth/login', { body: { phone: '+998907770001', password: 'yangiParol123' } });
  S.owner = r.data.token;
  // kod qayta ishlamaydi
  r = await req('POST', '/api/auth/reset/confirm', { body: { phone: '+998907770001', code, password: 'boshqaParol123' } });
  assert.equal(r.status, 400);
});

test('"noto‘g‘ri narx" xabari: mehmon yuboradi, ega ko‘radi, narx yangilansa yopiladi', async () => {
  let r = await req('POST', '/api/reports', { body: { inventory_id: S.inv1, reason: 'wrong_price', reported_price: 3000, comment: 'kassada boshqa' } });
  assert.equal(r.status, 201);
  r = await req('POST', '/api/reports', { body: { inventory_id: S.inv1, reason: 'wrong_price' } });
  assert.equal(r.data.duplicate, true);
  r = await req('POST', '/api/reports', { body: { inventory_id: S.inv1, reason: 'hack' } });
  assert.equal(r.status, 400);
  let list = await req('GET', `/api/pharmacies/${S.ph1}/reports`, { token: S.owner });
  assert.equal(list.data.reports.length, 1);
  assert.equal((await req('GET', `/api/pharmacies/${S.ph1}/reports`, { token: S.owner2 })).status, 403);
  await req('PATCH', `/api/inventory/${S.inv1}`, { token: S.owner, body: { price: 3100 } });
  list = await req('GET', `/api/pharmacies/${S.ph1}/reports`, { token: S.owner });
  assert.equal(list.data.reports.length, 0);
});

test('eskirgan narxlar: admin ro‘yxati va Telegram eslatmasi', async () => {
  db.prepare("UPDATE inventory SET updated_at = datetime('now', '-10 days') WHERE pharmacy_id = ?").run(S.ph1);
  let r = await req('GET', '/api/admin/stale?days=7', { token: S.admin });
  const row = r.data.pharmacies.find(p => p.id === S.ph1);
  assert.ok(row && row.stale_days >= 10 && row.owner_telegram);
  sent.length = 0;
  r = await req('POST', '/api/admin/stale/remind', { token: S.admin, body: { days: 7, pharmacy_ids: [S.ph1] } });
  assert.equal(r.data.sent, 1);
  assert.ok(sent.some(s => s.payload.chat_id === '5001' && /Shifo Farm/.test(s.payload.text)));
  // ega "narxlarni tasdiqlash" bosadi
  r = await req('POST', `/api/pharmacies/${S.ph1}/inventory/confirm`, { token: S.owner, body: {} });
  assert.ok(r.data.confirmed >= 1);
  r = await req('GET', '/api/admin/stale?days=7', { token: S.admin });
  assert.ok(!r.data.pharmacies.some(p => p.id === S.ph1));
});

test('qidiruv statistikasi: topilmagan so‘zlar', async () => {
  await req('GET', '/api/medicines/autocomplete?q=noyobdori&final=1');
  await req('GET', '/api/medicines/autocomplete?q=paratsetamol&final=1');
  const r = await req('GET', '/api/admin/search-stats?days=7', { token: S.admin });
  assert.ok(r.data.not_found.some(x => x.term === 'noyobdori'));
  assert.ok(r.data.top.some(x => x.term === 'paratsetamol'));
});

test('admin: bloklash sessiyani yopadi, o‘chirishda dorixonalar uchun qaror talab qilinadi', async () => {
  let r = await req('POST', `/api/admin/users/${S.userId}/block`, { token: S.admin, body: { reason: 'spam' } });
  assert.equal(r.status, 200);
  assert.equal((await req('GET', '/api/auth/me', { token: S.user })).status, 401);
  r = await req('POST', '/api/auth/login', { body: { phone: '+998901112233', password: 'parol12345' } });
  assert.equal(r.status, 403);
  await req('POST', `/api/admin/users/${S.userId}/unblock`, { token: S.admin });
  assert.equal((await req('POST', '/api/auth/login', { body: { phone: '+998901112233', password: 'parol12345' } })).status, 200);

  const o2 = db.prepare("SELECT id FROM users WHERE phone = '+998907770002'").get().id;
  r = await req('DELETE', `/api/admin/users/${o2}`, { token: S.admin });
  assert.equal(r.status, 409);
  assert.deepEqual(r.data.allowed, ['delete', 'transfer']);
  r = await req('DELETE', `/api/admin/users/${o2}`, { token: S.admin, body: { pharmacy_action: 'transfer', transfer_to_phone: '+998907770001' } });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT owner_id FROM pharmacies WHERE id = ?').get(S.ph2).owner_id, S.ownerId);

  // vaqtinchalik parol
  r = await req('POST', `/api/admin/users/${S.userId}/reset-password`, { token: S.admin });
  const login = await req('POST', '/api/auth/login', { body: { phone: '+998901112233', password: r.data.temp_password } });
  assert.equal(login.data.user.must_change_password, true);

  // o'zini bloklay olmaydi, oxirgi adminni tushirib bo'lmaydi
  const adminId = db.prepare("SELECT id FROM users WHERE phone = '+998900000001'").get().id;
  assert.equal((await req('POST', `/api/admin/users/${adminId}/block`, { token: S.admin })).status, 400);
  assert.equal((await req('PATCH', `/api/admin/users/${adminId}/role`, { token: S.admin, body: { role: 'user' } })).status, 400);
});

test('dorilarni birlashtirish: narxlar, sevimlilar ko‘chadi', async () => {
  const dup = await req('POST', '/api/medicines', { token: S.admin, body: { name: 'Paratsetamol', active_ingredient: 'Paratsetamol', dosage: '500mg', force: true } });
  await req('POST', `/api/pharmacies/${S.ph2}/inventory`, { token: S.owner, body: { medicine_id: dup.data.medicine.id, price: 2900 } });
  const r = await req('POST', '/api/admin/medicines/merge', { token: S.admin, body: { from_id: dup.data.medicine.id, to_id: S.medPara } });
  assert.equal(r.status, 200);
  const offers = await req('GET', `/api/medicines/${S.medPara}/offers`);
  assert.equal(offers.data.offers.find(o => o.pharmacy_id === S.ph2).price, 2900);
});

test('narx tarixi: kunlik snapshot', async () => {
  jobs.snapshotPrices();
  const r = await req('GET', `/api/medicines/${S.medPara}/price-history?days=30`);
  assert.equal(r.status, 200);
  assert.ok(r.data.points.length >= 1);
  assert.ok(r.data.points[r.data.points.length - 1].min_price > 0);
});

// =========================================================================
test('SEO: /dori/:slug sahifasi, JSON-LD, sitemap, robots, yuridik sahifalar', async () => {
  let r = await req('GET', '/dori/paratsetamol-500-mg', { raw: true });
  assert.equal(r.status, 200);
  assert.match(r.text, /<title>Paratsetamol 500 mg/);
  assert.match(r.text, /"@type":"Product"/);
  assert.match(r.text, /"lowPrice":2900/);
  assert.match(r.text, /shifokor maslahati/);
  r = await req('GET', '/dori/paratsetamol-500-mg?lang=ru', { raw: true });
  assert.match(r.text, /lang="ru"/);
  assert.match(r.text, /Самая низкая/);
  r = await req('GET', '/sitemap.xml', { raw: true });
  assert.match(r.text, /\/dori\/paratsetamol-500-mg/);
  r = await req('GET', '/robots.txt', { raw: true });
  assert.match(r.text, /Sitemap: .*\/sitemap\.xml/);
  for (const p of ['/maxfiylik', '/shartlar', '/ogohlantirish', '/dori']) assert.equal((await req('GET', p, { raw: true })).status, 200);
  assert.equal((await req('GET', '/dori/yoq-dori', { raw: true })).status, 200); // SPA ga tushadi
  assert.equal((await req('GET', '/wp-login.php', { raw: true })).status, 404);
});

test('XSS: dori nomi SEO sahifada ekranlanadi, JSON-LD </script> ni buzmaydi', async () => {
  const r0 = await req('POST', '/api/medicines', { token: S.admin, body: { name: '</script><script>alert(1)</script>', active_ingredient: 'x', force: true } });
  const page = await req('GET', '/dori/' + r0.data.medicine.slug, { raw: true });
  assert.ok(!page.text.includes('<script>alert(1)</script>'));
  assert.ok(!/<\/script><script>/.test(page.text.split('application/ld+json')[1].split('</head>')[0].replace(/<\/script>\s*$/, '')));
});

test('xavfsizlik sarlavhalari: CSP inline skriptlarga ruxsat bermaydi', async () => {
  const r = await req('GET', '/', { raw: true });
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.ok(!/<script>(?!\s*<\/script>)/.test(r.text), 'index.html da inline skript bo‘lmasligi kerak');
});

test('katta JSON so‘rov rad etiladi (CSV/logo’dan tashqari joylarda)', async () => {
  const r = await req('POST', '/api/auth/login', { body: { phone: 'x'.repeat(300 * 1024), password: 'y' } });
  assert.equal(r.status, 413);
});
