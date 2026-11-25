'use strict';
// Qidiruv tizimlari uchun server tomonida tayyorlanadigan sahifalar: /dori/:slug, /dori, yuridik sahifalar, sitemap.xml, robots.txt

const express = require('express');
const db = require('./db');
const config = require('./config');
const U = require('./utils');
const L = require('./lib');
const { legalPage, LEGAL_SLUGS } = require('./legal');

const router = express.Router();

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function price(n, lang) {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (lang === 'ru' ? '\u00a0сум' : '\u00a0so‘m');
}

function baseUrl(req) {
  return config.SITE_URL || `${req.protocol}://${req.get('host')}`;
}

function langOf(req) {
  return req.query.lang === 'ru' ? 'ru' : 'uz';
}

const S = {
  uz: {
    home: 'Bosh sahifa', catalog: 'Dorilar katalogi', search: 'Dori qidirish',
    ingredient: 'Ta’sir etuvchi modda', manufacturer: 'Ishlab chiqaruvchi', dosage: 'Doza / shakl', category: 'Kategoriya',
    rx: 'Retsept bilan', otc: 'Retseptsiz',
    min: 'Eng arzon', max: 'Eng qimmat', offers: 'dorixonada mavjud', none: 'Hozircha hech bir dorixonada mavjud emas.',
    pharmacy: 'Dorixona', address: 'Manzil', priceCol: 'Narx', status: 'Holat', updated: 'Yangilangan',
    available: 'Mavjud', low: 'Kam qoldi', out: 'Tugagan', verified: 'Tasdiqlangan', daysAgo: 'kun oldin', today: 'bugun',
    open: 'Saytda ochish (xarita, bron, filtrlar)', analogs: 'Muqobil (analog) dorilar',
    disclaimer: 'Sayt shifokor maslahati o‘rnini bosmaydi. Narx va mavjudlikni dorixonadan aniqlashtiring.',
    titleTpl: '{name} — narxi {city}dorixonalarda | DORI TOP',
    descTpl: '{name}: {count} ta dorixonada narxlar {min} dan. Eng arzon va yaqin dorixonani toping, narxlarni taqqoslang.',
    descNone: '{name} ({ingredient}) — dorixonalardagi narx va mavjudlik haqida ma’lumot.',
    privacy: 'Maxfiylik siyosati', terms: 'Foydalanish shartlari', medical: 'Tibbiy ogohlantirish',
    catalogTitle: 'Dorilar katalogi (A–Z) | DORI TOP', catalogDesc: 'O‘zbekiston dorixonalaridagi dorilar ro‘yxati va narxlari.',
    page: 'Sahifa', prev: '← Oldingi', next: 'Keyingi →', from: 'dan', notFound: 'Sahifa topilmadi'
  },
  ru: {
    home: 'Главная', catalog: 'Каталог лекарств', search: 'Поиск лекарств',
    ingredient: 'Действующее вещество', manufacturer: 'Производитель', dosage: 'Дозировка / форма', category: 'Категория',
    rx: 'По рецепту', otc: 'Без рецепта',
    min: 'Самая низкая', max: 'Самая высокая', offers: 'аптеках в наличии', none: 'Пока нет в наличии ни в одной аптеке.',
    pharmacy: 'Аптека', address: 'Адрес', priceCol: 'Цена', status: 'Статус', updated: 'Обновлено',
    available: 'В наличии', low: 'Мало', out: 'Нет', verified: 'Проверена', daysAgo: 'дн. назад', today: 'сегодня',
    open: 'Открыть на сайте (карта, бронь, фильтры)', analogs: 'Аналоги',
    disclaimer: 'Сайт не заменяет консультацию врача. Уточняйте цену и наличие в аптеке.',
    titleTpl: '{name} — цена в аптеках {city}| DORI TOP',
    descTpl: '{name}: цены в {count} аптеках от {min}. Найдите самую дешёвую и ближайшую аптеку.',
    descNone: '{name} ({ingredient}) — цены и наличие в аптеках.',
    privacy: 'Политика конфиденциальности', terms: 'Условия использования', medical: 'Медицинское предупреждение',
    catalogTitle: 'Каталог лекарств (А–Я) | DORI TOP', catalogDesc: 'Список лекарств и цены в аптеках Узбекистана.',
    page: 'Страница', prev: '← Назад', next: 'Далее →', from: 'от', notFound: 'Страница не найдена'
  }
};

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

function layout(req, { title, description, canonicalPath, body, jsonLd, noindex = false }) {
  const lang = langOf(req);
  const s = S[lang];
  const base = baseUrl(req);
  const canonical = base + canonicalPath + (lang === 'ru' ? (canonicalPath.includes('?') ? '&' : '?') + 'lang=ru' : '');
  const alt = (l) => base + canonicalPath + (l === 'ru' ? (canonicalPath.includes('?') ? '&' : '?') + 'lang=ru' : '');
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : '';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" hreflang="uz" href="${esc(alt('uz'))}">
<link rel="alternate" hreflang="ru" href="${esc(alt('ru'))}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta name="theme-color" content="#059669">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css">
${ld}
</head>
<body class="min-h-screen flex flex-col antialiased app-bg">
<header class="glass border-b border-white/80">
  <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
    <a href="/${lang === 'ru' ? '?lang=ru' : ''}" class="text-lg font-extrabold tracking-tight text-slate-900">DORI <span class="text-brand-green">TOP</span></a>
    <nav class="flex items-center gap-3 text-sm font-semibold">
      <a href="/dori${lang === 'ru' ? '?lang=ru' : ''}" class="text-slate-600 hover:text-brand-blue">${s.catalog}</a>
      <a href="${esc(canonicalPath)}${canonicalPath.includes('?') ? '&' : '?'}lang=${lang === 'ru' ? 'uz' : 'ru'}" class="px-2 py-1 rounded-lg bg-white/80 text-slate-700">${lang === 'ru' ? 'O‘zbekcha' : 'Русский'}</a>
    </nav>
  </div>
</header>
<main class="flex-1 max-w-5xl w-full mx-auto px-4 py-6">${body}</main>
<footer class="border-t border-slate-200/70 py-6 text-xs text-slate-500">
  <div class="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row gap-3 justify-between">
    <p>${s.disclaimer}</p>
    <p class="flex gap-3 flex-wrap">
      <a class="hover:underline" href="/maxfiylik${lang === 'ru' ? '?lang=ru' : ''}">${s.privacy}</a>
      <a class="hover:underline" href="/shartlar${lang === 'ru' ? '?lang=ru' : ''}">${s.terms}</a>
      <a class="hover:underline" href="/ogohlantirish${lang === 'ru' ? '?lang=ru' : ''}">${s.medical}</a>
    </p>
  </div>
</footer>
</body>
</html>`;
}

function sendHtml(res, html, status = 200) {
  res.status(status).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(html);
}

// ---------------------------------------------------------------- /dori/:slug
router.get('/dori/:slug', (req, res, next) => {
  const lang = langOf(req);
  const s = S[lang];
  const med = db.prepare('SELECT * FROM medicines WHERE slug = ?').get(String(req.params.slug).slice(0, 120));
  if (!med) return next();

  const offers = db.prepare(`
    SELECT i.id, i.price, i.status, i.updated_at, p.id AS pharmacy_id, p.name, p.city, p.address, p.verified
    FROM inventory i JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE i.medicine_id = ? ORDER BY (i.status = 'out'), i.price ASC LIMIT 100
  `).all(med.id);
  const inStock = offers.filter(o => o.status !== 'out');
  const min = inStock.length ? Math.min(...inStock.map(o => o.price)) : null;
  const max = inStock.length ? Math.max(...inStock.map(o => o.price)) : null;
  const cities = [...new Set(inStock.map(o => o.city))];
  const fullName = `${med.name}${med.dosage ? ' ' + med.dosage : ''}`;

  const analogs = db.prepare(`
    SELECT m.name, m.dosage, m.slug, MIN(CASE WHEN i.status != 'out' THEN i.price END) AS min_price
    FROM medicines m LEFT JOIN inventory i ON i.medicine_id = m.id
    WHERE m.id != ? AND LOWER(TRIM(m.active_ingredient)) = LOWER(TRIM(?)) GROUP BY m.id ORDER BY (min_price IS NULL), min_price LIMIT 12
  `).all(med.id, med.active_ingredient);

  const title = fill(s.titleTpl, { name: fullName, city: cities.length === 1 ? (lang === 'ru' ? `г. ${cities[0]} ` : `${cities[0]} `) : '' });
  const description = inStock.length
    ? fill(s.descTpl, { name: fullName, count: inStock.length, min: price(min, lang) })
    : fill(s.descNone, { name: fullName, ingredient: med.active_ingredient });

  const statusLabel = (st) => ({ available: s.available, low: s.low, out: s.out }[st]);
  const ago = (ts) => { const d = U.daysSince(ts); return d === 0 ? s.today : `${d} ${s.daysAgo}`; };
  const appLink = `/?dori=${encodeURIComponent(med.slug)}${lang === 'ru' ? '&lang=ru' : ''}`;

  const rows = offers.map(o => `
    <tr class="border-t border-slate-200/70">
      <td class="py-2.5 pr-3"><span class="font-semibold text-slate-900">${esc(o.name)}</span>${o.verified ? ` <span class="text-xs font-semibold text-brand-green">✔ ${s.verified}</span>` : ''}</td>
      <td class="py-2.5 pr-3 text-slate-600">${esc(o.city)}, ${esc(o.address)}</td>
      <td class="py-2.5 pr-3 font-bold whitespace-nowrap ${o.status === 'out' ? 'text-slate-400 line-through' : 'text-slate-900'}">${price(o.price, lang)}</td>
      <td class="py-2.5 pr-3 whitespace-nowrap">${statusLabel(o.status)}</td>
      <td class="py-2.5 text-slate-500 whitespace-nowrap">${ago(o.updated_at)}</td>
    </tr>`).join('');

  const body = `
  <nav class="text-xs text-slate-500 mb-3"><a class="hover:underline" href="/${lang === 'ru' ? '?lang=ru' : ''}">${s.home}</a> › <a class="hover:underline" href="/dori${lang === 'ru' ? '?lang=ru' : ''}">${s.catalog}</a> › ${esc(med.name)}</nav>
  <article class="glass-strong rounded-3xl p-5 sm:p-7 mb-5">
    <div class="flex flex-wrap gap-2 mb-2">
      <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-brand-blue">${esc(med.category)}</span>
      <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${med.prescription ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}">${med.prescription ? s.rx : s.otc}</span>
    </div>
    <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900">${esc(fullName)}</h1>
    <dl class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-slate-700">
      <div><dt class="text-xs text-slate-500">${s.ingredient}</dt><dd class="font-semibold">${esc(med.active_ingredient)}</dd></div>
      ${med.manufacturer ? `<div><dt class="text-xs text-slate-500">${s.manufacturer}</dt><dd class="font-semibold">${esc(med.manufacturer)}</dd></div>` : ''}
      ${med.dosage ? `<div><dt class="text-xs text-slate-500">${s.dosage}</dt><dd class="font-semibold">${esc(med.dosage)}</dd></div>` : ''}
    </dl>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      ${inStock.length ? `<div class="px-4 py-2 rounded-2xl bg-emerald-50 border border-emerald-200"><div class="text-[11px] font-semibold text-emerald-700 uppercase">${s.min}</div><div class="text-xl font-extrabold text-brand-green">${price(min, lang)}</div></div>
      <div class="text-sm text-slate-600"><b>${inStock.length}</b> ${s.offers}</div>` : `<div class="text-sm text-slate-600">${s.none}</div>`}
      <a href="${esc(appLink)}" class="ml-auto px-4 py-2.5 rounded-xl bg-brand-green text-white text-sm font-bold">${s.open}</a>
    </div>
    <p class="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">${s.disclaimer}</p>
  </article>
  ${offers.length ? `<section class="glass rounded-3xl p-5 overflow-x-auto mb-5">
    <table class="w-full text-sm text-left">
      <thead><tr class="text-xs text-slate-500"><th class="pb-2 pr-3">${s.pharmacy}</th><th class="pb-2 pr-3">${s.address}</th><th class="pb-2 pr-3">${s.priceCol}</th><th class="pb-2 pr-3">${s.status}</th><th class="pb-2">${s.updated}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>` : ''}
  ${analogs.length ? `<section class="glass rounded-3xl p-5">
    <h2 class="text-base font-extrabold text-slate-900 mb-3">${s.analogs}</h2>
    <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
      ${analogs.map(a => `<li><a class="font-semibold text-brand-blue hover:underline" href="/dori/${esc(a.slug)}${lang === 'ru' ? '?lang=ru' : ''}">${esc(a.name)}${a.dosage ? ' ' + esc(a.dosage) : ''}</a> <span class="text-slate-500">${a.min_price ? price(a.min_price, lang) + ' ' + s.from : ''}</span></li>`).join('')}
    </ul>
  </section>` : ''}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: fullName,
    description: `${med.active_ingredient}${med.manufacturer ? ', ' + med.manufacturer : ''}`,
    category: med.category,
    url: baseUrl(req) + `/dori/${med.slug}`,
    ...(med.manufacturer ? { brand: { '@type': 'Brand', name: med.manufacturer } } : {}),
    ...(inStock.length ? {
      offers: { '@type': 'AggregateOffer', priceCurrency: 'UZS', lowPrice: min, highPrice: max, offerCount: inStock.length, availability: 'https://schema.org/InStock' }
    } : {})
  };

  sendHtml(res, layout(req, { title, description, canonicalPath: `/dori/${med.slug}`, body, jsonLd }));
});

// ---------------------------------------------------------------- /dori (katalog)
const PER_PAGE = 120;
router.get('/dori', (req, res) => {
  const lang = langOf(req);
  const s = S[lang];
  const page = Math.max(L.int(req.query.page) || 1, 1);
  const total = db.prepare('SELECT COUNT(*) AS c FROM medicines').get().c;
  const pages = Math.max(Math.ceil(total / PER_PAGE), 1);
  const rows = db.prepare(`
    SELECT m.name, m.dosage, m.slug, MIN(CASE WHEN i.status != 'out' THEN i.price END) AS min_price
    FROM medicines m LEFT JOIN inventory i ON i.medicine_id = m.id
    GROUP BY m.id ORDER BY m.name COLLATE NOCASE LIMIT ? OFFSET ?
  `).all(PER_PAGE, (page - 1) * PER_PAGE);
  const q = (p) => `/dori?page=${p}${lang === 'ru' ? '&lang=ru' : ''}`;
  const body = `
  <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-4">${s.catalog}</h1>
  <section class="glass rounded-3xl p-5">
    <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2 text-sm">
      ${rows.map(r => `<li><a class="font-semibold text-slate-800 hover:text-brand-blue" href="/dori/${esc(r.slug)}${lang === 'ru' ? '?lang=ru' : ''}">${esc(r.name)}${r.dosage ? ' <span class="font-normal text-slate-500">' + esc(r.dosage) + '</span>' : ''}</a>${r.min_price ? ` <span class="text-brand-green font-semibold">${price(r.min_price, lang)} ${s.from}</span>` : ''}</li>`).join('')}
    </ul>
    ${pages > 1 ? `<div class="mt-5 flex items-center justify-between text-sm font-semibold">
      ${page > 1 ? `<a class="text-brand-blue" href="${q(page - 1)}">${s.prev}</a>` : '<span></span>'}
      <span class="text-slate-500">${s.page} ${page} / ${pages}</span>
      ${page < pages ? `<a class="text-brand-blue" href="${q(page + 1)}">${s.next}</a>` : '<span></span>'}
    </div>` : ''}
  </section>`;
  sendHtml(res, layout(req, { title: s.catalogTitle + (page > 1 ? ` — ${page}` : ''), description: s.catalogDesc, canonicalPath: page > 1 ? `/dori?page=${page}` : '/dori', body }));
});

// ---------------------------------------------------------------- yuridik sahifalar
const LEGAL_PATHS = { maxfiylik: 'maxfiylik', shartlar: 'shartlar', ogohlantirish: 'ogohlantirish' };
for (const slug of LEGAL_SLUGS) {
  router.get(`/${LEGAL_PATHS[slug]}`, (req, res) => {
    const p = legalPage(slug, langOf(req));
    const body = `<article class="glass-strong rounded-3xl p-6 sm:p-8 legal"><h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-4">${esc(p.title)}</h1>${p.html}</article>`;
    sendHtml(res, layout(req, { title: `${p.title} | DORI TOP`, description: p.title, canonicalPath: `/${LEGAL_PATHS[slug]}`, body }));
  });
}

// ---------------------------------------------------------------- sitemap.xml / robots.txt
router.get('/sitemap.xml', (req, res) => {
  const base = baseUrl(req);
  const meds = db.prepare(`
    SELECT m.slug, COALESCE(MAX(i.updated_at), m.updated_at, m.created_at) AS lastmod
    FROM medicines m LEFT JOIN inventory i ON i.medicine_id = m.id
    GROUP BY m.id ORDER BY m.id LIMIT 45000
  `).all();
  const urls = [
    { loc: `${base}/`, priority: '1.0' },
    { loc: `${base}/dori`, priority: '0.8' },
    ...LEGAL_SLUGS.map(s => ({ loc: `${base}/${LEGAL_PATHS[s]}`, priority: '0.2' })),
    ...meds.map(m => ({ loc: `${base}/dori/${encodeURIComponent(m.slug)}`, lastmod: m.lastmod ? String(m.lastmod).slice(0, 10) : null, priority: '0.7' }))
  ];
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n';
  res.set('Content-Type', 'application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(xml);
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /uploads/\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
});

module.exports = router;
module.exports.layout = layout;
module.exports.sendHtml = sendHtml;
module.exports.S = S;
