'use strict';
// Interfeysdagi har bir T('...') matnining ruscha tarjimasi borligini va server kalitlari to'liqligini tekshiradi
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('frontend: barcha T(...) matnlari ruscha lug‘atda bor, {o‘zgaruvchi}lar mos', () => {
  global.window = {};
  global.localStorage = { getItem: () => 'ru', setItem() {} };
  global.document = { documentElement: {} };
  require(path.join(root, 'public', 'i18n.js'));
  const T = global.window.T;
  const missing = [];
  for (const f of ['app.js', 'cabinet.js', 'admin.js']) {
    const src = fs.readFileSync(path.join(root, 'public', f), 'utf8');
    const re = /\bT\(\s*'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(src))) {
      const key = m[1];
      const ru = T(key);
      if (ru === key && /[a-z]{3}/i.test(key) && !['Admin', 'Audit', 'Import'].includes(key)) missing.push(`${f}: ${key}`);
      const a = (key.match(/\{\w+\}/g) || []).sort().join();
      const b = (ru.match(/\{\w+\}/g) || []).sort().join();
      if (a !== b) missing.push(`placeholder ${f}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('server: har bir xato kaliti ikkala tilda ham bor', () => {
  const { MESSAGES } = require(path.join(root, 'src', 'i18n.js'));
  const keys = new Set();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) {
        const s = fs.readFileSync(p, 'utf8');
        for (const m of s.matchAll(/(?:fail\(\d+,\s*|messageKey:\s*|return \{ error: |error: )'([a-z0-9_]+\.[a-z0-9_]+)'/g)) keys.add(m[1]);
      }
    }
  };
  walk(path.join(root, 'src'));
  assert.ok(keys.size > 50);
  const miss = [...keys].filter(k => !MESSAGES.uz[k] || !MESSAGES.ru[k]);
  assert.deepEqual(miss, []);
  assert.deepEqual(Object.keys(MESSAGES.uz).sort(), Object.keys(MESSAGES.ru).sort());
});
