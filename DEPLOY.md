# DORI TOP — serverga joylash (Docker + HTTPS)

## 0. Muhim: shaxsga doir ma’lumotlar
Saytda foydalanuvchilarning ismi va telefon raqami saqlanadi. “Shaxsga doir ma’lumotlar to‘g‘risida”gi Qonunning 27¹-moddasi O‘zbekiston fuqarolarining shaxsga doir ma’lumotlarini O‘zbekiston hududidagi serverlarda saqlashni talab qiladi (2026-yilda qonunga o‘zgartirishlar kiritilgan). Serverni tanlashdan oldin huquqshunos bilan aniqlashtiring; odatda mahalliy hosting (UZ data-markaz) tanlanadi.

## 1. Server tayyorlash
Ubuntu 22.04/24.04, kamida 1 GB RAM. Domen (`doritop.uz`) A-yozuvi server IP manziliga yo‘naltirilgan bo‘lsin.
```bash
curl -fsSL https://get.docker.com | sh
git clone <repo> dori-top && cd dori-top
```

## 2. Sozlamalar
```bash
cp .env.example .env
nano .env
```
Kamida quyidagilarni to‘ldiring:
- `NODE_ENV=production`
- `JWT_SECRET=` — `openssl rand -hex 48` natijasi
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` — @BotFather’dan
- `ADMIN_ALERT_CHAT_ID` — xatolar va arizalar keladigan chat (o‘z chat ID’ingizni @userinfobot orqali bilish mumkin)
- `OPERATOR_NAME`, `CONTACT_EMAIL`, `CONTACT_PHONE` — yuridik sahifalar uchun

`SITE_URL` va `TRUST_PROXY` docker-compose’da avtomatik beriladi.

## 3. Ishga tushirish
```bash
DOMAIN=doritop.uz docker compose up -d --build
docker compose logs -f app
```
Caddy Let’s Encrypt sertifikatini avtomatik oladi — sayt `https://doritop.uz` da ochiladi, HTTP avtomatik HTTPS’ga yo‘naltiriladi.

## 4. Admin va katalog
```bash
docker compose exec app node scripts/create-admin.js --phone +998901234567 --name "Ism Familiya"
docker compose exec app node scripts/seed-catalog.js
```
Chiqarilgan vaqtinchalik parol bilan kiring → parolni o‘zgartiring → **Profil** sahifasida 2FA ni yoqing (admin panel shundan keyin ochiladi).

## 5. Zaxira nusxa
Baza har kuni `/data/backups` ga saqlanadi (7 ta nusxa). Serverdan tashqariga ko‘chirish:
```bash
docker compose cp app:/data/backups ./backups-$(date +%F)
```
Tiklash: konteynerni to‘xtating, kerakli `.db` faylni `/data/dori_top.db` o‘rniga qo‘ying va qayta ishga tushiring.

## 6. Yangilash
```bash
git pull && DOMAIN=doritop.uz docker compose up -d --build
```
Baza migratsiyalari ishga tushganda avtomatik bajariladi.

## 7. Monitoring
- `GET /healthz` — baza bilan aloqa tekshiruvi (Docker HEALTHCHECK ham shuni ishlatadi). Tashqi monitoring (UptimeRobot va h.k.) shu manzilni kuzatsin.
- 500 xatolar va fon vazifalari xatolari `ADMIN_ALERT_CHAT_ID` ga Telegram orqali keladi (bir xil xato 10 daqiqada bir marta).
- Loglar JSON formatda: `docker compose logs app`.

## Docker’siz (systemd)
```bash
npm ci && npm run build && npm prune --omit=dev
NODE_ENV=production node src/server.js
```
Oldiga Nginx yoki Caddy qo‘ying (`TRUST_PROXY=1`), HTTPS sertifikatini Certbot/Caddy bilan oling.
