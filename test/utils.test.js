'use strict';
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/utils');

test('isOpenNow: O‘zbekiston vaqti bo‘yicha hisoblaydi (UTC serverda ham)', () => {
  // 2026-11-25 05:00 UTC = 10:00 Toshkent
  const t = new Date('2026-11-25T05:00:00Z');
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '08:00', close_time: '22:00' }, t), true);
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '11:00', close_time: '22:00' }, t), false);
  // 18:00 UTC = 23:00 Toshkent -> 22:00 da yopiladi
  const late = new Date('2026-11-25T18:00:00Z');
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '08:00', close_time: '22:00' }, late), false);
});

test('isOpenNow: tungi smena, 24/7 va noto‘g‘ri format', () => {
  const night = new Date('2026-11-25T20:00:00Z'); // 01:00 Toshkent
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '20:00', close_time: '06:00' }, night), true);
  assert.equal(U.isOpenNow({ is_247: 1, open_time: '', close_time: '' }, night), true);
  assert.equal(U.isOpenNow({ is_247: 0, open_time: 'abc', close_time: '22:00' }, night), false);
  // yopilish vaqtining o'zida yopiq
  const exact = new Date('2026-11-25T17:00:00Z'); // 22:00 Toshkent
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '08:00', close_time: '22:00' }, exact), false);
});

test('normalizePhone', () => {
  assert.equal(U.normalizePhone('90 123 45 67'), '+998901234567');
  assert.equal(U.normalizePhone('+998 (90) 123-45-67'), '+998901234567');
  assert.equal(U.normalizePhone('998901234567'), '+998901234567');
  assert.equal(U.isValidUserPhone(U.normalizePhone('abc')), false);
});

test('parseCsvLine: qo‘shtirnoq, "" va ; ajratgich', () => {
  assert.deepEqual(U.parseCsvLine('Aspirin,"Atsetilsalitsil, kislota",Bayer'), ['Aspirin', 'Atsetilsalitsil, kislota', 'Bayer']);
  assert.deepEqual(U.parseCsvLine('A,"5"" kattalik",B'), ['A', '5" kattalik', 'B']);
  assert.deepEqual(U.parseCsvLine('a;b;c', ';'), ['a', 'b', 'c']);
  assert.equal(U.detectDelimiter('name;active;price'), ';');
  assert.equal(U.detectDelimiter('name,active,price'), ',');
});

test('searchVariants: kirill -> lotin', () => {
  const v = U.searchVariants('Парацетамол');
  assert.ok(v.includes('paratsetamol') && v.includes('paracetamol'));
  assert.deepEqual(U.searchVariants('Analgin'), ['Analgin']);
  assert.deepEqual(U.searchVariants('   '), []);
});

test('escapeLike', () => {
  assert.equal(U.escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

test('validCoords / normalizeTime / daysSince', () => {
  assert.equal(U.validCoords(40.78, 72.34), true);
  assert.equal(U.validCoords(95, 10), false);
  assert.equal(U.validCoords(NaN, 10), false);
  assert.equal(U.normalizeTime('8:05'), '08:05');
  assert.equal(U.normalizeTime('25:00'), null);
  const twoDaysAgo = new Date(Date.now() - 2.5 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  assert.equal(U.daysSince(twoDaysAgo), 2);
});

test('isOpenNow: haftalik jadval (yakshanba dam) va tunggi smena kun chegarasida', () => {
  const s = { 0: { closed: true } };
  for (let d = 1; d <= 6; d++) s[d] = { open: '09:00', close: '21:00' };
  s[3] = { open: '20:00', close: '06:00' }; // chorshanba tungi smena
  const sunday10 = new Date('2026-11-29T05:00:00Z'); // yakshanba 10:00 Toshkent
  assert.equal(U.isOpenNow({ schedule: JSON.stringify(s) }, sunday10), false);
  assert.deepEqual(U.todayHours({ schedule: s }, sunday10), { closed: true });
  const thu01 = new Date('2026-11-25T20:00:00Z'); // payshanba 01:00 — chorshanba smenasi davom etadi
  assert.equal(U.isOpenNow({ schedule: s }, thu01), true);
  assert.equal(U.parseSchedule({ 0: { open: '25:00', close: '1' } }), null);
});

test('normKey / slugify / csvEscape / parsePhones', () => {
  assert.equal(U.normKey('Paracetamol'), U.normKey('Парацетамол'));
  assert.equal(U.normKey('Amoxicillin'), U.normKey('Amoksitsillin'));
  assert.notEqual(U.normKey('Analgin'), U.normKey('Aspirin'));
  assert.equal(U.slugify('No-shpa 40 mg'), 'no-shpa-40-mg');
  assert.equal(U.slugify("Ko‘mir"), 'komir');
  assert.equal(U.csvEscape('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(U.csvEscape('@cmd'), "'@cmd");
  assert.equal(U.csvEscape(-5), '-5');
  assert.equal(U.csvEscape('a"b,c'), '"a""b,c"');
  assert.deepEqual(U.parsePhones('+998 90 111 11 11, +998901111111'), ['+998 90 111 11 11', '+998901111111']);
  assert.equal(U.parsePhones(['12']), null);
});

test('TOTP: RFC 6238 test vektori', () => {
  const totp = require('../src/totp');
  // RFC 6238, SHA1, kalit "12345678901234567890", T=59 -> 94287082 (8 raqam) -> oxirgi 6: 287082
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.hotp(secret, 1), '287082');
  assert.equal(totp.verify(secret, '287082', { now: 59 * 1000 }), 1);
  assert.equal(totp.verify(secret, '287082', { now: 59 * 1000, lastStep: 1 }), null);
  assert.equal(totp.verify(secret, 'abc'), null);
});
