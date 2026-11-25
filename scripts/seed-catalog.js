'use strict';
// Dorilar katalogini CSV'dan oldindan to'ldirish (narxsiz). Takroriy ishga tushirish xavfsiz.
//   npm run seed:catalog [-- data/catalog.csv]
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const U = require('../src/utils');
const L = require('../src/lib');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'catalog.csv'));
const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
const delim = U.detectDelimiter(lines[0]);
const header = U.parseCsvLine(lines[0], delim).map(h => h.toLowerCase());
const col = (n) => header.indexOf(n);
let created = 0, existed = 0;
db.transaction(() => {
  for (const line of lines.slice(1)) {
    const c = U.parseCsvLine(line, delim);
    const m = L.cleanMedicine({
      name: c[col('name')], active_ingredient: c[col('active_ingredient')], manufacturer: c[col('manufacturer')] || '',
      dosage: c[col('dosage')], category: c[col('category')], prescription: c[col('prescription')] === '1'
    });
    if (!m.name || !m.active_ingredient) continue;
    if (L.findExactMedicine(m)) { existed++; continue; }
    L.createMedicine(m, null, { verified: 1 });
    created++;
  }
})();
console.log(`Katalog: ${created} ta dori qo‘shildi, ${existed} tasi allaqachon bor edi.`);
