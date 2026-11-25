'use strict';
// Lucide va Leaflet fayllarini node_modules'dan public/vendor ga nusxalaydi (CDN'siz, CSP 'self').
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'vendor');
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.cpSync(path.join(root, 'node_modules', from), path.join(out, to), { recursive: true });
};
copy('lucide/dist/umd/lucide.min.js', 'lucide.min.js');
copy('leaflet/dist/leaflet.js', 'leaflet/leaflet.js');
copy('leaflet/dist/leaflet.css', 'leaflet/leaflet.css');
copy('leaflet/dist/images', 'leaflet/images');
console.log('vendor fayllari nusxalandi ->', out);
