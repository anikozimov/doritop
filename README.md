# DORI TOP 2.0 — dorilarni qidirish va narxlarni taqqoslash platformasi

O‘zbekiston bo‘ylab dorilarni qidirish, narxlarni taqqoslash, bron qilish va dorixona omborini boshqarish tizimi. O‘zbek va rus tillarida.

## Imkoniyatlar

**Foydalanuvchi uchun**
- Qidiruv lotin va kirill yozuvida, yozilishdagi farqlarga chidamli (*paracetamol* ≈ *paratsetamol* ≈ *парацетамол*).
- Filtrlar: faqat mavjud, hozir ochiq, 24/7, tasdiqlangan dorixona, narx oralig‘i, retseptli/retseptsiz.
- Xarita, “Yaqinimdagi” (masofa faqat ruxsat berilganda), yo‘nalish, analoglar.
- **Bron qilish**: dorixona tasdiqlaydi va dorini belgilangan muddatgacha ushlab turadi.
- **Savat**: bir nechta dorining qaysi dorixonada hammasi borligi va jami narxi.
- **Sevimlilar**, **narx tarixi grafigi**, Telegram orqali **“kelganda xabar ber”** va **“narx tushsa xabar ber”**.
- “Noto‘g‘ri narx” tugmasi (mehmon ham yubora oladi).
- Har bir dori uchun alohida sahifa (`/dori/paratsetamol-500-mg-tabletka`), katalog (`/dori`), `sitemap.xml`.

**Dorixona egasi uchun**
- Katalogdan tanlab qo‘shish (dublikatlar kamayadi), katalogda yo‘q bo‘lsa — o‘xshash nomlar tekshiriladi.
- CSV: shablon yuklab olish, fayldan import (ustun nomlari o‘zbekcha/ruscha ham bo‘ladi, xatolar qator raqami bilan), eksport, “faylda yo‘qlarni tugagan deb belgilash”.
- Ommaviy narx o‘zgartirish (“hammasi +5%”, kategoriya yoki tanlanganlar bo‘yicha, oldindan ko‘rish bilan).
- “Narxlarni tasdiqlash” — narx o‘zgarmagan bo‘lsa ham yangilangan sanani bugungi qilish.
- Ombor paneli: tugayotgan/tugagan, eskirgan narxlar filtrlari, qidiruv, sahifalash.
- Profil: logotip, 3 tagacha telefon, haftalik ish jadvali (yakshanba boshqacha, tungi smena).
- Bronlar (tasdiqlash/rad etish/olib ketildi/kelmadi), statistika (ko‘rishlar, qo‘ng‘iroqlar, yo‘nalishlar, bronlar), foydalanuvchi xabarlari.

**Administrator uchun**
- Arizalar, “tasdiqlangan” (litsenziya tekshirilgan) belgisi.
- Foydalanuvchilar: qidiruv, rol, bloklash, o‘chirish, vaqtinchalik parol, 2FA ni tiklash.
- Dorilar: tahrirlash, tasdiqlash, dublikatlarni birlashtirish, katalog importi.
- Narxi 7+ kun yangilanmagan dorixonalar ro‘yxati va Telegram eslatma (avtomatik ham).
- “Noto‘g‘ri narx” xabarlari, eng ko‘p qidirilgan va **topilmagan** dorilar statistikasi, **audit log** (kim qaysi narxni qachon o‘zgartirgan).

## Texnologiyalar
- **Backend:** Node.js 22.13+ (ichki `node:sqlite`, C++ build kerak emas), Express, JWT, bcrypt, helmet.
- **Frontend:** oddiy JS + Tailwind (build qilinadi), Lucide, Leaflet — barchasi o‘z serverdan beriladi (CDN yo‘q).
- **Telegram bot:** long polling (webhook/HTTPS shart emas), tashqi kutubxonasiz.
- **PostgreSQL / Supabase:** `src/supabase_schema.sql`.

## Ishga tushirish (lokal)
```bash
cp .env.example .env          # JWT_SECRET va boshqalarni to'ldiring
npm install
npm run build                 # Tailwind CSS va vendor fayllar
npm run seed:catalog          # 167 ta keng tarqalgan dori bilan katalogni to'ldirish (ixtiyoriy)
npm start                     # http://localhost:3000
npm test                      # 48 ta test (API, xavfsizlik, Telegram, SEO, tarjimalar)
```
Development rejimida `ADMIN_PHONE` bo‘sh bo‘lsa, birinchi ro‘yxatdan o‘tgan foydalanuvchi admin bo‘ladi.

**Productionda admin yaratish:**
```bash
npm run admin:create -- --phone +998901234567 --name "Ism Familiya"
# vaqtinchalik parol chiqariladi; birinchi kirishda o'zgartirish va 2FA yoqish so'raladi
npm run admin:create -- --phone +998901234567 --reset-2fa     # telefon yo'qolganda
```

Serverga joylash: **[DEPLOY.md](DEPLOY.md)** (Docker + avtomatik HTTPS).

## Rollar
- **Mehmon:** qidiruv, narxlar, xarita, savat, “noto‘g‘ri narx” xabari.
- **Foydalanuvchi:** + bron, sevimlilar, kuzatuv, dorixona ochish arizasi.
- **Dorixona egasi:** + o‘z dorixonasi kabineti.
- **Administrator:** + admin panel (productionda 2FA majburiy).

## CSV formati
Ombor: `name,active_ingredient,manufacturer,dosage,category,price,status,prescription`
- Ajratgich `,` yoki `;`. Excel’da “CSV UTF-8” sifatida saqlang.
- Ustunlar nomi bo‘yicha aniqlanadi: `nomi/название`, `narx/цена`, `holat/наличие`, `doza/дозировка` ...
- `status`: `available/mavjud/есть`, `low/kam/мало`, `out/tugagan/нет`. Narx: `3500`, `3 500`, `3500,00`.
- Bir martada 2000 qatorgacha. Shablon: kabinetdagi “CSV shablon” tugmasi yoki `/api/csv-template`.

Katalog (admin): `name,active_ingredient,manufacturer,dosage,category,prescription`. Namuna: `data/catalog.csv`.

> ⚠️ `data/catalog.csv` dagi “retsept bilan” belgilari umumiy amaliyot asosida qo‘yilgan. Ishga tushirishdan oldin farmatsevt bilan tekshirib chiqing.

## Xavfsizlik
- Qattiq CSP (`script-src 'self'`, inline skript yo‘q), HSTS, `frame-ancestors 'none'`.
- Parol: bcrypt; xato urinishlar IP va telefon raqami bo‘yicha cheklanadi.
- Parol o‘zgarsa / bloklansa / “hamma qurilmalardan chiqish” — eski tokenlar darhol yaroqsiz (`token_version`).
- Admin uchun TOTP 2FA (Google Authenticator), kodni qayta ishlatishdan himoya.
- `ADMIN_PHONE` raqamini egallab olishdan himoya (sozlash kodi yoki CLI).
- Har bir dorixona amali egalik bo‘yicha tekshiriladi (IDOR), audit log.
- Logotip: faqat haqiqiy PNG/JPEG/WEBP (SVG yo‘q), `nosniff` + `sandbox` sarlavhalari.
- CSV eksportda Excel formula injection’dan himoya.
- Telegram xabarlarida HTML ekranlanadi; bron tugmalari faqat dorixona egasining chatida ishlaydi.
- Xatolar Telegram orqali adminga yuboriladi (`ADMIN_ALERT_CHAT_ID`), JSON log.

## Yuridik sahifalar
`/maxfiylik`, `/shartlar`, `/ogohlantirish` (uz/ru). Matn **namunaviy** — ishga tushirishdan oldin huquqshunos bilan tekshiring va `.env` da `OPERATOR_NAME`, `CONTACT_EMAIL`, `CONTACT_PHONE` ni to‘ldiring.
