'use strict';
// Yuridik sahifalar matni (uz / ru). DIQQAT: bu namunaviy matn — ishga tushirishdan oldin huquqshunos bilan tekshiring.

const config = require('./config');

function operator() {
  return {
    name: process.env.OPERATOR_NAME || 'DORI TOP',
    email: process.env.CONTACT_EMAIL || '',
    phone: process.env.CONTACT_PHONE || '',
    updated: process.env.LEGAL_UPDATED || '2026-11-25'
  };
}

function contacts(lang) {
  const o = operator();
  const parts = [];
  if (o.email) parts.push(`E-mail: <a href="mailto:${o.email}">${o.email}</a>`);
  if (o.phone) parts.push((lang === 'ru' ? 'Телефон: ' : 'Telefon: ') + o.phone);
  if (config.TELEGRAM_BOT_USERNAME) parts.push(`Telegram: @${config.TELEGRAM_BOT_USERNAME}`);
  return parts.length ? parts.join('<br>') : (lang === 'ru' ? 'Контакты указаны на главной странице.' : 'Aloqa ma’lumotlari bosh sahifada ko‘rsatilgan.');
}

const PAGES = {
  maxfiylik: {
    uz: {
      title: 'Maxfiylik siyosati',
      body: (o) => `
<p>Ushbu siyosat ${o.name} platformasi (keyingi o‘rinlarda — “Platforma”) foydalanuvchilarining shaxsga doir ma’lumotlari qanday yig‘ilishi, ishlatilishi va himoya qilinishini tushuntiradi. Ma’lumotlarga ishlov berish O‘zbekiston Respublikasining “Shaxsga doir ma’lumotlar to‘g‘risida”gi Qonuni talablariga muvofiq amalga oshiriladi.</p>
<h2>1. Qanday ma’lumotlar yig‘iladi</h2>
<ul>
<li><b>Ro‘yxatdan o‘tishda:</b> ism-familiya, telefon raqami, parol (faqat shifrlangan xesh ko‘rinishida saqlanadi).</li>
<li><b>Bron qilishda:</b> ism, telefon raqami, tanlangan dorilar va izoh — faqat bron qilingan dorixonaga ko‘rsatiladi.</li>
<li><b>Telegram ulansa:</b> Telegram chat identifikatori (xabarnomalar va parolni tiklash kodi uchun).</li>
<li><b>Dorixona egalaridan:</b> dorixona nomi, litsenziya raqami, manzil, telefonlar, ish vaqti, logotip.</li>
<li><b>Texnik ma’lumotlar:</b> xavfsizlik uchun IP manzil (xatolik va suiiste’mollarni aniqlash maqsadida qisqa muddat), qidiruv so‘zlari (shaxssiz statistika ko‘rinishida).</li>
<li><b>Joylashuv:</b> “Yaqinimdagi” tugmasi bosilganda brauzer joylashuvni faqat masofani hisoblash uchun yuboradi; u serverda saqlanmaydi.</li>
</ul>
<h2>2. Ma’lumotlar nima uchun ishlatiladi</h2>
<ul>
<li>hisobga kirish, bron va xabarnomalarni yetkazish;</li>
<li>dorixonalarga bron bo‘yicha mijoz bilan bog‘lanish imkonini berish;</li>
<li>Platformani suiiste’mollikdan himoya qilish va xizmat sifatini yaxshilash.</li>
</ul>
<p>Ma’lumotlar sotilmaydi va reklama maqsadida uchinchi shaxslarga berilmaydi. Qonunda nazarda tutilgan hollarda vakolatli davlat organlariga taqdim etilishi mumkin.</p>
<h2>3. Saqlash va himoya</h2>
<p>Parollar bcrypt algoritmi bilan xeshlanadi, ulanish HTTPS orqali shifrlanadi, ma’lumotlar bazasiga kirish cheklangan. Ma’lumotlar hisob faol bo‘lgan muddatda saqlanadi; hisob o‘chirilganda shaxsga doir ma’lumotlar o‘chiriladi (qonun bo‘yicha saqlanishi shart bo‘lgan yozuvlar bundan mustasno).</p>
<h2>4. Sizning huquqlaringiz</h2>
<p>Siz o‘z ma’lumotlaringiz bilan tanishish, ularni tuzatish, ishlov berishga roziligingizni qaytarib olish va hisobingizni o‘chirishni talab qilishingiz mumkin. Buning uchun quyidagi manzilga murojaat qiling.</p>
<h2>5. Aloqa</h2>
<p>${contacts('uz')}</p>
<p class="muted">Oxirgi yangilanish: ${o.updated}</p>`
    },
    ru: {
      title: 'Политика конфиденциальности',
      body: (o) => `
<p>Настоящая политика описывает, как платформа ${o.name} (далее — «Платформа») собирает, использует и защищает персональные данные пользователей. Обработка данных осуществляется в соответствии с Законом Республики Узбекистан «О персональных данных».</p>
<h2>1. Какие данные собираются</h2>
<ul>
<li><b>При регистрации:</b> имя, номер телефона, пароль (хранится только в виде хеша).</li>
<li><b>При бронировании:</b> имя, телефон, выбранные лекарства и комментарий — видны только выбранной аптеке.</li>
<li><b>При привязке Telegram:</b> идентификатор чата (для уведомлений и кодов восстановления пароля).</li>
<li><b>От владельцев аптек:</b> название, номер лицензии, адрес, телефоны, режим работы, логотип.</li>
<li><b>Технические данные:</b> IP-адрес для безопасности (краткосрочно), поисковые запросы (в обезличенной статистике).</li>
<li><b>Геолокация:</b> при нажатии «Рядом» браузер передаёт координаты только для расчёта расстояния; на сервере они не сохраняются.</li>
</ul>
<h2>2. Цели использования</h2>
<ul>
<li>вход в аккаунт, бронирование и доставка уведомлений;</li>
<li>возможность для аптеки связаться с клиентом по брони;</li>
<li>защита Платформы от злоупотреблений и улучшение сервиса.</li>
</ul>
<p>Данные не продаются и не передаются третьим лицам в рекламных целях. Они могут быть предоставлены уполномоченным органам в случаях, предусмотренных законом.</p>
<h2>3. Хранение и защита</h2>
<p>Пароли хешируются алгоритмом bcrypt, соединение шифруется по HTTPS, доступ к базе данных ограничен. Данные хранятся, пока аккаунт активен; при удалении аккаунта персональные данные удаляются (кроме записей, хранение которых требует закон).</p>
<h2>4. Ваши права</h2>
<p>Вы можете запросить доступ к своим данным, их исправление, отзыв согласия на обработку и удаление аккаунта, обратившись по контактам ниже.</p>
<h2>5. Контакты</h2>
<p>${contacts('ru')}</p>
<p class="muted">Последнее обновление: ${o.updated}</p>`
    }
  },
  shartlar: {
    uz: {
      title: 'Foydalanish shartlari',
      body: (o) => `
<p>Platformadan foydalanish orqali siz quyidagi shartlarga rozilik bildirasiz.</p>
<h2>1. Xizmat mohiyati</h2>
<p>${o.name} — dorixonalardagi dorilar narxi va mavjudligi haqida ma’lumot beruvchi axborot platformasi. Platforma dori sotmaydi, to‘lov qabul qilmaydi va dorixona emas. Narx va mavjudlik ma’lumotlarini dorixonalarning o‘zi kiritadi.</p>
<h2>2. Ma’lumotlarning aniqligi</h2>
<p>Narxlar va mavjudlik o‘zgarishi mumkin. Har bir narx yonida u qachon yangilangani ko‘rsatiladi. Xarid qilishdan oldin narx va mavjudlikni dorixonadan aniqlashtiring. Noto‘g‘ri ma’lumotni “Noto‘g‘ri narx” tugmasi orqali xabar qiling.</p>
<h2>3. Bron qilish</h2>
<p>Bron — dorixonaga dorini ushlab turish so‘rovi. Dorixona uni tasdiqlashi yoki rad etishi mumkin; tasdiqlangan bron ko‘rsatilgan muddatgacha amal qiladi. Retsept bilan beriladigan dorilar faqat retsept ko‘rsatilganda beriladi.</p>
<h2>4. Dorixonalar majburiyatlari</h2>
<ul>
<li>amaldagi litsenziyaga ega bo‘lish va to‘g‘ri ma’lumot taqdim etish;</li>
<li>narx va mavjudlikni muntazam yangilab borish;</li>
<li>bronlarga o‘z vaqtida javob berish.</li>
</ul>
<h2>5. Taqiqlanadi</h2>
<ul>
<li>yolg‘on ma’lumot, soxta bron yoki soxta xabarlar yuborish;</li>
<li>Platformaga hujum qilish, avtomatik tarzda ma’lumotlarni ommaviy yig‘ish;</li>
<li>boshqa shaxs nomidan ro‘yxatdan o‘tish.</li>
</ul>
<p>Qoidalarni buzgan hisoblar bloklanishi mumkin.</p>
<h2>6. Javobgarlik</h2>
<p>Platforma dorixonalar kiritgan ma’lumotlar uchun hamda dorini qabul qilish natijalari uchun javobgar emas. Davolanish bo‘yicha qarorlarni faqat shifokor bilan maslahatlashgan holda qabul qiling.</p>
<h2>7. O‘zgartirishlar va aloqa</h2>
<p>Shartlar yangilanishi mumkin; yangi tahrir shu sahifada e’lon qilinadi.</p>
<p>${contacts('uz')}</p>
<p class="muted">Oxirgi yangilanish: ${o.updated}</p>`
    },
    ru: {
      title: 'Условия использования',
      body: (o) => `
<p>Используя Платформу, вы соглашаетесь со следующими условиями.</p>
<h2>1. Суть сервиса</h2>
<p>${o.name} — информационная платформа о ценах и наличии лекарств в аптеках. Платформа не продаёт лекарства, не принимает оплату и не является аптекой. Данные о ценах и наличии вносят сами аптеки.</p>
<h2>2. Точность данных</h2>
<p>Цены и наличие могут меняться. Рядом с каждой ценой указано, когда она обновлялась. Перед покупкой уточняйте цену и наличие в аптеке. Сообщайте о неверных данных кнопкой «Неверная цена».</p>
<h2>3. Бронирование</h2>
<p>Бронь — это запрос аптеке отложить лекарство. Аптека может подтвердить или отклонить её; подтверждённая бронь действует до указанного времени. Рецептурные препараты отпускаются только по рецепту.</p>
<h2>4. Обязанности аптек</h2>
<ul>
<li>иметь действующую лицензию и предоставлять достоверные данные;</li>
<li>регулярно обновлять цены и наличие;</li>
<li>своевременно отвечать на брони.</li>
</ul>
<h2>5. Запрещается</h2>
<ul>
<li>размещать ложные данные, фиктивные брони или ложные жалобы;</li>
<li>атаковать Платформу, массово автоматически собирать данные;</li>
<li>регистрироваться от имени другого лица.</li>
</ul>
<p>Аккаунты нарушителей могут быть заблокированы.</p>
<h2>6. Ответственность</h2>
<p>Платформа не несёт ответственности за данные, внесённые аптеками, и за последствия приёма лекарств. Решения о лечении принимайте только после консультации с врачом.</p>
<h2>7. Изменения и контакты</h2>
<p>Условия могут обновляться; новая редакция публикуется на этой странице.</p>
<p>${contacts('ru')}</p>
<p class="muted">Последнее обновление: ${o.updated}</p>`
    }
  },
  ogohlantirish: {
    uz: {
      title: 'Tibbiy ogohlantirish',
      body: (o) => `
<div class="alert"><b>Sayt shifokor maslahati o‘rnini bosmaydi.</b> Narx va mavjudlikni dorixonadan aniqlashtiring.</div>
<ul>
<li>${o.name} dagi ma’lumotlar faqat tanishish uchun. Ular tashxis qo‘yish, davolash yoki dori tanlash uchun tibbiy maslahat emas.</li>
<li>Dorini qabul qilishdan oldin shifokor yoki farmatsevt bilan maslahatlashing, qo‘llanmani o‘qing.</li>
<li><b>“Retsept bilan”</b> belgisi qo‘yilgan dorilar dorixonalarda faqat shifokor retsepti asosida beriladi.</li>
<li>“Muqobil (analog)” dorilar ta’sir etuvchi moddasi bo‘yicha ko‘rsatiladi; dozasi, shakli va qo‘shimcha moddalari farq qilishi mumkin. Almashtirishni shifokor bilan kelishing.</li>
<li>Narxlarni dorixonalar kiritadi va ular o‘zgarishi mumkin. Har bir narx yonida oxirgi yangilangan sana ko‘rsatiladi.</li>
<li>Shoshilinch holatlarda darhol <b>103</b> raqamiga qo‘ng‘iroq qiling.</li>
</ul>`
    },
    ru: {
      title: 'Медицинское предупреждение',
      body: (o) => `
<div class="alert"><b>Сайт не заменяет консультацию врача.</b> Уточняйте цену и наличие в аптеке.</div>
<ul>
<li>Информация на ${o.name} носит справочный характер и не является медицинской консультацией для диагностики, лечения или выбора лекарства.</li>
<li>Перед приёмом лекарства проконсультируйтесь с врачом или фармацевтом и прочитайте инструкцию.</li>
<li>Препараты с отметкой <b>«По рецепту»</b> отпускаются в аптеках только по рецепту врача.</li>
<li>«Аналоги» подбираются по действующему веществу; дозировка, форма и вспомогательные вещества могут отличаться. Замену согласуйте с врачом.</li>
<li>Цены вносят аптеки, они могут меняться. Рядом с каждой ценой указана дата обновления.</li>
<li>В экстренных случаях немедленно звоните <b>103</b>.</li>
</ul>`
    }
  }
};

function legalPage(slug, lang) {
  const p = PAGES[slug];
  if (!p) return null;
  const v = p[lang] || p.uz;
  return { title: v.title, html: v.body(operator()) };
}

module.exports = { legalPage, LEGAL_SLUGS: Object.keys(PAGES) };
