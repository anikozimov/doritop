'use strict';
// Admin hisobini xavfsiz yaratish/tayinlash (productionda ro'yxatdan o'tish orqali admin bo'lib bo'lmaydi).
//   npm run admin:create -- --phone +998901234567 --name "Ism Familiya" [--password "..."]
//   npm run admin:create -- --phone +998901234567 --reset-2fa
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const U = require('../src/utils');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? undefined : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true);
}

const phone = U.normalizePhone(arg('phone') || '');
if (!U.isValidUserPhone(phone)) {
  console.error('Telefon raqamini kiriting: --phone +998901234567');
  process.exit(1);
}
const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

if (arg('reset-2fa')) {
  if (!existing) { console.error('Foydalanuvchi topilmadi.'); process.exit(1); }
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, token_version = token_version + 1 WHERE id = ?').run(existing.id);
  console.log('2FA o‘chirildi. Foydalanuvchi qayta kirib, uni yangidan yoqishi kerak.');
  process.exit(0);
}

let password = typeof arg('password') === 'string' ? arg('password') : '';
const generated = !password;
if (generated) password = crypto.randomBytes(12).toString('base64url');
if (password.length < 8 || password.length > 72) { console.error('Parol 8–72 belgi bo‘lishi kerak.'); process.exit(1); }
const hash = bcrypt.hashSync(password, 11);

if (existing) {
  const setPw = typeof arg('password') === 'string' || arg('new-password');
  db.prepare(`UPDATE users SET role = 'admin', blocked_at = NULL ${setPw ? ', password_hash = ?, token_version = token_version + 1' : ''} WHERE id = ?`)
    .run(...(setPw ? [hash, existing.id] : [existing.id]));
  console.log(`✔ ${existing.full_name} (${phone}) endi administrator.` + (setPw ? '' : ' Paroli o‘zgarmadi (yangi parol uchun --new-password qo‘shing).'));
  if (setPw && generated) console.log(`  Yangi vaqtinchalik parol: ${password}`);
} else {
  const name = U.cleanStr(typeof arg('name') === 'string' ? arg('name') : 'Administrator', 100);
  db.prepare("INSERT INTO users (full_name, phone, password_hash, role, terms_accepted_at, must_change_password) VALUES (?, ?, ?, 'admin', CURRENT_TIMESTAMP, ?)")
    .run(name, phone, hash, generated ? 1 : 0);
  console.log(`✔ Administrator yaratildi: ${name} (${phone})`);
  if (generated) console.log(`  Vaqtinchalik parol: ${password}  (birinchi kirishda o‘zgartirish so‘raladi)`);
}
console.log('Eslatma: productionda admin panelga kirish uchun Profil sahifasida 2FA yoqilishi shart.');
