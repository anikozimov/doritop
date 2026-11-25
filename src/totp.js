'use strict';
// RFC 6238 TOTP (Google Authenticator, Authy va h.k. bilan mos), tashqi kutubxonasiz.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1e6).padStart(6, '0');
}

// Muvaffaqiyatli bo'lsa ishlatilgan qadamni (step) qaytaradi, aks holda null.
// lastStep: shu kod qayta ishlatilmasligi uchun (replay himoyasi).
function verify(secret, code, { lastStep = 0, window = 1, now = Date.now() } = {}) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const step = Math.floor(now / 30000);
  for (let w = -window; w <= window; w++) {
    const s = step + w;
    if (s <= lastStep) continue;
    const expected = hotp(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return s;
  }
  return null;
}

function otpauthUrl(secret, label, issuer = 'DORI TOP') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { generateSecret, verify, otpauthUrl, hotp, base32Encode, base32Decode };
