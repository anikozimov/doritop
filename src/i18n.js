'use strict';
// Server javoblaridagi xabarlar (o'zbek / rus). Mijoz "X-Lang: ru" sarlavhasini yuboradi.

const M = {
  uz: {
    'common.too_many': 'So‘rovlar juda ko‘p. Birozdan so‘ng urinib ko‘ring.',
    'common.bad_request': 'So‘rov noto‘g‘ri.',
    'common.forbidden': 'Ruxsat yo‘q.',
    'common.api_not_found': 'Bunday API manzil topilmadi.',
    'common.bad_json': 'So‘rov formati noto‘g‘ri (JSON).',
    'common.too_large': 'Yuborilgan ma’lumot juda katta.',
    'common.server_error': 'Serverda ichki xatolik yuz berdi.',

    'auth.required': 'Kirish talab qilinadi.',
    'auth.session_expired': 'Sessiya muddati tugagan. Qayta kiring.',
    'auth.user_not_found': 'Foydalanuvchi topilmadi.',
    'auth.blocked': 'Hisobingiz bloklangan. Administrator bilan bog‘laning.',
    'auth.forbidden': 'Bu amal uchun ruxsatingiz yetarli emas.',
    'auth.2fa_setup_required': 'Admin panel uchun avval ikki bosqichli kirishni (2FA) yoqing: Profil sahifasi.',
    'auth.too_many_logins': 'Kirishga juda ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.',
    'auth.too_many_registers': 'Ro‘yxatdan o‘tishga juda ko‘p urinish. Keyinroq urinib ko‘ring.',
    'auth.phone_locked': 'Bu raqam bilan juda ko‘p noto‘g‘ri urinish bo‘ldi. 15 daqiqadan so‘ng urinib ko‘ring.',
    'auth.name_short': 'Ism-familiya kamida 2 ta belgidan iborat bo‘lishi kerak.',
    'auth.bad_phone': 'To‘g‘ri telefon raqamini kiriting (masalan: +998901234567).',
    'auth.password_rules': 'Parol 8 tadan 72 tagacha belgidan iborat bo‘lishi kerak.',
    'auth.accept_terms': 'Ro‘yxatdan o‘tish uchun foydalanish shartlari va maxfiylik siyosatiga rozilik bering.',
    'auth.admin_use_cli': 'Bu raqam administrator uchun ajratilgan. Admin hisobi server buyrug‘i orqali yaratiladi.',
    'auth.admin_setup_code': 'Administrator raqami uchun sozlash kodi noto‘g‘ri.',
    'auth.phone_taken': 'Bu telefon raqami allaqachon ro‘yxatdan o‘tgan.',
    'auth.bad_credentials': 'Telefon raqami yoki parol noto‘g‘ri.',
    'auth.ticket_expired': 'Kirish muddati tugadi. Qaytadan kiring.',
    'auth.bad_2fa': 'Tasdiqlash kodi noto‘g‘ri.',
    'auth.reset_invalid': 'Kod noto‘g‘ri yoki muddati o‘tgan.',
    'auth.current_password_wrong': 'Joriy parol noto‘g‘ri.',
    'auth.2fa_already': 'Ikki bosqichli kirish allaqachon yoqilgan.',
    'auth.2fa_not_enabled': 'Ikki bosqichli kirish yoqilmagan.',
    'auth.2fa_required_admin': 'Administratorlar uchun ikki bosqichli kirish majburiy.',
    'tg.disabled': 'Telegram bot sozlanmagan.',

    'pharmacy.required_fields': 'Dorixona nomi, shahar, manzil va telefon majburiy.',
    'pharmacy.license_required': 'Litsenziya raqami majburiy.',
    'pharmacy.bad_phone': 'Telefon raqami noto‘g‘ri.',
    'pharmacy.bad_coords': 'Xaritadan dorixona joylashuvini to‘g‘ri belgilang.',
    'pharmacy.bad_time': 'Ish vaqti formati noto‘g‘ri (SS:DD).',
    'pharmacy.bad_schedule': 'Haftalik ish jadvali noto‘g‘ri.',
    'pharmacy.not_found': 'Dorixona topilmadi.',
    'pharmacy.not_found_or_not_yours': 'Dorixona topilmadi yoki sizga tegishli emas.',
    'pharmacy.license_other': 'Bu litsenziya raqami boshqa dorixonada mavjud.',
    'logo.bad_format': 'Faqat PNG, JPEG yoki WEBP rasm yuklang.',
    'logo.too_big': 'Rasm hajmi 400 KB dan oshmasligi kerak.',

    'request.already_pending': 'Sizda allaqachon ko‘rib chiqilayotgan ariza bor. Natijasini kuting.',
    'request.license_taken': 'Bu litsenziya raqami bilan dorixona yoki ariza allaqachon mavjud.',
    'request.not_found': 'Ariza topilmadi.',
    'request.already_reviewed': 'Bu ariza allaqachon ko‘rib chiqilgan.',
    'request.license_exists': 'Bu litsenziya raqamli dorixona allaqachon mavjud. Arizani rad eting.',
    'request.pending_not_found': 'Kutilayotgan ariza topilmadi.',

    'medicine.bad_id': 'Noto‘g‘ri dori identifikatori.',
    'medicine.not_found': 'Dori topilmadi.',
    'medicine.name_required': 'Dori nomi va ta’sir etuvchi moddasini kiriting.',
    'medicine.similar_exists': 'Katalogda shunga o‘xshash dori bor. Ro‘yxatdan tanlang yoki baribir yangisini qo‘shing.',
    'medicine.duplicate': 'Bunday dori allaqachon mavjud (ID {id}). Dublikatni birlashtiring.',
    'medicine.merge_ids': 'Birlashtirish uchun ikkita turli dori ID kiriting.',
    'medicine.merge_not_found': 'Dorilardan biri topilmadi.',

    'inventory.bad_input': 'Dori va narxni to‘g‘ri kiriting.',
    'inventory.bad_price': 'Narx noto‘g‘ri.',
    'inventory.not_found': 'Ombor yozuvi topilmadi yoki ruxsat yo‘q.',
    'bulk.bad_percent': 'Foiz -90 dan +300 gacha bo‘lishi va 0 ga teng bo‘lmasligi kerak.',
    'bulk.no_items': 'Dorilar tanlanmagan.',
    'csv.too_short': 'CSV faylda kamida sarlavha va 1 qator bo‘lishi kerak.',
    'csv.too_many': 'Bir martada ko‘pi bilan {n} ta qator yuklash mumkin.',

    'fav.limit': 'Sevimlilar soni chegarasiga yetdingiz.',
    'watch.need_telegram': 'Xabar olish uchun avval Telegram’ni ulang (Profil sahifasi).',
    'watch.limit': 'Kuzatuvlar soni chegarasiga yetdingiz.',

    'res.own_pharmacy': 'O‘z dorixonangizda bron qilib bo‘lmaydi.',
    'res.bad_items': 'Bron uchun dorilar va miqdorni to‘g‘ri tanlang (1–20 dona).',
    'res.item_unavailable': '“{name}” bu dorixonada hozir mavjud emas.',
    'res.too_many_active': 'Bir vaqtda ko‘pi bilan {n} ta faol bron bo‘lishi mumkin.',
    'res.too_many_today': 'Bugun juda ko‘p bron qildingiz. Ertaga urinib ko‘ring.',
    'res.bad_contact': 'Ism va telefon raqamini to‘g‘ri kiriting.',
    'res.not_found': 'Bron topilmadi.',
    'res.bad_transition': 'Bu bron holatini o‘zgartirib bo‘lmaydi.',

    'report.bad_reason': 'Sababni tanlang.',
    'report.not_found': 'Xabar qilingan narx topilmadi.',
    'report.too_many': 'Juda ko‘p xabar yubordingiz. Keyinroq urinib ko‘ring.',

    'user.not_found': 'Foydalanuvchi topilmadi.',
    'user.not_self': 'Bu amalni o‘zingizga nisbatan bajara olmaysiz.',
    'user.bad_role': 'Noto‘g‘ri rol.',
    'user.not_self_demote': 'O‘zingizdan admin rolini olib tashlay olmaysiz.',
    'user.last_admin': 'Tizimda kamida bitta faol admin qolishi kerak.',
    'user.pharmacies_decision': 'Bu foydalanuvchining {n} ta dorixonasi bor. Ular bilan nima qilish kerakligini tanlang.',
    'user.transfer_target_not_found': 'Dorixonalar o‘tkaziladigan foydalanuvchi topilmadi.',
    'user.transfer_other': 'Dorixonalarni boshqa foydalanuvchiga o‘tkazing.',
    'user.owner_not_found': 'Ega foydalanuvchi topilmadi.'
  },
  ru: {
    'common.too_many': 'Слишком много запросов. Попробуйте чуть позже.',
    'common.bad_request': 'Неверный запрос.',
    'common.forbidden': 'Нет доступа.',
    'common.api_not_found': 'Такой адрес API не найден.',
    'common.bad_json': 'Неверный формат запроса (JSON).',
    'common.too_large': 'Отправлено слишком много данных.',
    'common.server_error': 'Внутренняя ошибка сервера.',

    'auth.required': 'Требуется вход.',
    'auth.session_expired': 'Сессия истекла. Войдите снова.',
    'auth.user_not_found': 'Пользователь не найден.',
    'auth.blocked': 'Ваш аккаунт заблокирован. Свяжитесь с администратором.',
    'auth.forbidden': 'Недостаточно прав для этого действия.',
    'auth.2fa_setup_required': 'Для админ-панели сначала включите двухфакторный вход (2FA) на странице профиля.',
    'auth.too_many_logins': 'Слишком много попыток входа. Повторите через 15 минут.',
    'auth.too_many_registers': 'Слишком много попыток регистрации. Попробуйте позже.',
    'auth.phone_locked': 'Слишком много неверных попыток для этого номера. Повторите через 15 минут.',
    'auth.name_short': 'Имя должно содержать минимум 2 символа.',
    'auth.bad_phone': 'Введите правильный номер телефона (например: +998901234567).',
    'auth.password_rules': 'Пароль должен содержать от 8 до 72 символов.',
    'auth.accept_terms': 'Для регистрации примите условия использования и политику конфиденциальности.',
    'auth.admin_use_cli': 'Этот номер зарезервирован для администратора. Аккаунт администратора создаётся командой на сервере.',
    'auth.admin_setup_code': 'Неверный код настройки для номера администратора.',
    'auth.phone_taken': 'Этот номер уже зарегистрирован.',
    'auth.bad_credentials': 'Неверный номер телефона или пароль.',
    'auth.ticket_expired': 'Время входа истекло. Войдите снова.',
    'auth.bad_2fa': 'Неверный код подтверждения.',
    'auth.reset_invalid': 'Код неверный или истёк.',
    'auth.current_password_wrong': 'Текущий пароль неверен.',
    'auth.2fa_already': 'Двухфакторный вход уже включён.',
    'auth.2fa_not_enabled': 'Двухфакторный вход не включён.',
    'auth.2fa_required_admin': 'Для администраторов двухфакторный вход обязателен.',
    'tg.disabled': 'Telegram-бот не настроен.',

    'pharmacy.required_fields': 'Название аптеки, город, адрес и телефон обязательны.',
    'pharmacy.license_required': 'Номер лицензии обязателен.',
    'pharmacy.bad_phone': 'Неверный номер телефона.',
    'pharmacy.bad_coords': 'Правильно отметьте аптеку на карте.',
    'pharmacy.bad_time': 'Неверный формат времени (ЧЧ:ММ).',
    'pharmacy.bad_schedule': 'Неверный недельный график работы.',
    'pharmacy.not_found': 'Аптека не найдена.',
    'pharmacy.not_found_or_not_yours': 'Аптека не найдена или не принадлежит вам.',
    'pharmacy.license_other': 'Этот номер лицензии уже есть у другой аптеки.',
    'logo.bad_format': 'Загрузите изображение PNG, JPEG или WEBP.',
    'logo.too_big': 'Размер изображения не должен превышать 400 КБ.',

    'request.already_pending': 'У вас уже есть заявка на рассмотрении. Дождитесь результата.',
    'request.license_taken': 'Аптека или заявка с этим номером лицензии уже существует.',
    'request.not_found': 'Заявка не найдена.',
    'request.already_reviewed': 'Заявка уже рассмотрена.',
    'request.license_exists': 'Аптека с этим номером лицензии уже существует. Отклоните заявку.',
    'request.pending_not_found': 'Ожидающая заявка не найдена.',

    'medicine.bad_id': 'Неверный идентификатор лекарства.',
    'medicine.not_found': 'Лекарство не найдено.',
    'medicine.name_required': 'Укажите название и действующее вещество.',
    'medicine.similar_exists': 'В каталоге есть похожее лекарство. Выберите его из списка или всё равно добавьте новое.',
    'medicine.duplicate': 'Такое лекарство уже есть (ID {id}). Объедините дубликаты.',
    'medicine.merge_ids': 'Укажите два разных ID лекарств для объединения.',
    'medicine.merge_not_found': 'Одно из лекарств не найдено.',

    'inventory.bad_input': 'Правильно укажите лекарство и цену.',
    'inventory.bad_price': 'Неверная цена.',
    'inventory.not_found': 'Запись склада не найдена или нет доступа.',
    'bulk.bad_percent': 'Процент должен быть от -90 до +300 и не равен 0.',
    'bulk.no_items': 'Не выбраны лекарства.',
    'csv.too_short': 'В CSV должен быть заголовок и хотя бы 1 строка.',
    'csv.too_many': 'За раз можно загрузить не более {n} строк.',

    'fav.limit': 'Достигнут лимит избранного.',
    'watch.need_telegram': 'Чтобы получать уведомления, сначала привяжите Telegram (страница профиля).',
    'watch.limit': 'Достигнут лимит подписок.',

    'res.own_pharmacy': 'Нельзя бронировать в своей аптеке.',
    'res.bad_items': 'Правильно выберите лекарства и количество (1–20 шт.).',
    'res.item_unavailable': '«{name}» сейчас нет в этой аптеке.',
    'res.too_many_active': 'Одновременно может быть не более {n} активных броней.',
    'res.too_many_today': 'Сегодня вы сделали слишком много броней. Попробуйте завтра.',
    'res.bad_contact': 'Правильно укажите имя и телефон.',
    'res.not_found': 'Бронь не найдена.',
    'res.bad_transition': 'Нельзя изменить статус этой брони.',

    'report.bad_reason': 'Выберите причину.',
    'report.not_found': 'Цена, о которой вы сообщаете, не найдена.',
    'report.too_many': 'Слишком много сообщений. Попробуйте позже.',

    'user.not_found': 'Пользователь не найден.',
    'user.not_self': 'Это действие нельзя выполнить над собой.',
    'user.bad_role': 'Неверная роль.',
    'user.not_self_demote': 'Нельзя снять с себя роль администратора.',
    'user.last_admin': 'В системе должен остаться хотя бы один активный администратор.',
    'user.pharmacies_decision': 'У пользователя {n} аптек(и). Выберите, что с ними сделать.',
    'user.transfer_target_not_found': 'Пользователь для передачи аптек не найден.',
    'user.transfer_other': 'Передайте аптеки другому пользователю.',
    'user.owner_not_found': 'Пользователь-владелец не найден.'
  }
};

function t(lang, key, vars) {
  const dict = M[lang] || M.uz;
  const tpl = dict[key] ?? M.uz[key] ?? key;
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
}

function pickLang(req) {
  const h = String(req.headers['x-lang'] || req.query.lang || '').toLowerCase();
  if (h === 'ru' || h === 'uz') return h;
  return /^ru/i.test(String(req.headers['accept-language'] || '')) ? 'ru' : 'uz';
}

module.exports = { t, pickLang, MESSAGES: M };
