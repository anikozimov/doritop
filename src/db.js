'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const db = new DatabaseSync(config.DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8'));

// better-sqlite3 transaction() API'siga mos yordamchi (ichma-ich chaqirishni ham qo'llaydi)
let txDepth = 0;
db.transaction = function (fn) {
  return function (...args) {
    const outer = txDepth === 0;
    if (outer) db.exec('BEGIN IMMEDIATE');
    txDepth++;
    try {
      const result = fn(...args);
      txDepth--;
      if (outer) db.exec('COMMIT');
      return result;
    } catch (err) {
      txDepth--;
      if (outer) { try { db.exec('ROLLBACK'); } catch (_) {} }
      throw err;
    }
  };
};

// =========================================================================
// MIGRATSIYALAR (versiyalangan; har biri bir marta, tranzaksiya ichida)
// =========================================================================
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}
function addColumn(table, col, def) {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

const migrations = [
  {
    id: 1,
    name: 'one_pending_request',
    up() {
      // Eski bazada dublikat pending bo'lsa, eng yangisidan boshqalarini rad etamiz
      db.exec(`
        UPDATE pharmacy_requests SET status = 'rejected', admin_note = 'Dublikat ariza (avtomatik)'
        WHERE status = 'pending' AND id NOT IN (
          SELECT MAX(id) FROM pharmacy_requests WHERE status = 'pending' GROUP BY user_id
        )`);
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_one_pending ON pharmacy_requests(user_id) WHERE status = 'pending'");
    }
  },
  {
    id: 2,
    name: 'v2_security_and_features',
    up() {
      // users
      addColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('users', 'blocked_at', 'DATETIME');
      addColumn('users', 'blocked_reason', "TEXT NOT NULL DEFAULT ''");
      addColumn('users', 'telegram_chat_id', 'TEXT');
      addColumn('users', 'totp_secret', 'TEXT');
      addColumn('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('users', 'totp_last_step', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('users', 'terms_accepted_at', 'DATETIME');
      addColumn('users', 'lang', "TEXT NOT NULL DEFAULT 'uz'");
      addColumn('users', 'last_login_at', 'DATETIME');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tg ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL');

      // pharmacies
      addColumn('pharmacies', 'verified', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('pharmacies', 'verified_at', 'DATETIME');
      addColumn('pharmacies', 'logo_path', "TEXT NOT NULL DEFAULT ''");
      addColumn('pharmacies', 'phones', "TEXT NOT NULL DEFAULT '[]'");
      addColumn('pharmacies', 'schedule', "TEXT NOT NULL DEFAULT ''");
      addColumn('pharmacies', 'last_reminded_at', 'DATETIME');

      // medicines
      addColumn('medicines', 'slug', 'TEXT');
      addColumn('medicines', 'name_norm', "TEXT NOT NULL DEFAULT ''");
      addColumn('medicines', 'verified', 'INTEGER NOT NULL DEFAULT 1');
      addColumn('medicines', 'updated_at', 'DATETIME');

      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          action TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id INTEGER,
          details TEXT NOT NULL DEFAULT '{}',
          ip TEXT NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

        CREATE TABLE IF NOT EXISTS price_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          inventory_id INTEGER,
          pharmacy_id INTEGER NOT NULL,
          medicine_id INTEGER NOT NULL,
          reported_price INTEGER,
          reason TEXT NOT NULL CHECK(reason IN ('wrong_price', 'out_of_stock', 'closed', 'wrong_info', 'other')),
          comment TEXT NOT NULL DEFAULT '',
          reporter_user_id INTEGER,
          reporter_key TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK(status IN ('open', 'resolved', 'dismissed')) DEFAULT 'open',
          resolved_by INTEGER,
          resolved_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE,
          FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE,
          FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reports_status ON price_reports(status);
        CREATE INDEX IF NOT EXISTS idx_reports_ph ON price_reports(pharmacy_id, status);

        CREATE TABLE IF NOT EXISTS reservations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          pharmacy_id INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'expired')) DEFAULT 'pending',
          customer_name TEXT NOT NULL,
          customer_phone TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          owner_note TEXT NOT NULL DEFAULT '',
          total INTEGER NOT NULL DEFAULT 0,
          hold_until DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_res_user ON reservations(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_res_ph ON reservations(pharmacy_id, status);

        CREATE TABLE IF NOT EXISTS reservation_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reservation_id INTEGER NOT NULL,
          medicine_id INTEGER,
          name TEXT NOT NULL,
          qty INTEGER NOT NULL CHECK(qty > 0),
          price INTEGER NOT NULL CHECK(price >= 0),
          FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
          FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_resitems_res ON reservation_items(reservation_id);

        CREATE TABLE IF NOT EXISTS favorites (
          user_id INTEGER NOT NULL,
          medicine_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, medicine_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
        );

        -- "Kelganda xabar ber" / "narx tushsa xabar ber" (sayt foydalanuvchisi yoki Telegram chat)
        CREATE TABLE IF NOT EXISTS watches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          chat_id TEXT,
          medicine_id INTEGER NOT NULL,
          city TEXT NOT NULL DEFAULT 'all',
          kind TEXT NOT NULL CHECK(kind IN ('available', 'price')),
          last_min_price INTEGER,
          last_notified_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE,
          CHECK (user_id IS NOT NULL OR chat_id IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_watches_unique
          ON watches(COALESCE(user_id, 0), COALESCE(chat_id, ''), medicine_id, kind, city);
        CREATE INDEX IF NOT EXISTS idx_watches_med ON watches(medicine_id);

        -- Kunlik narx ko'rsatkichlari (grafik uchun)
        CREATE TABLE IF NOT EXISTS price_daily (
          medicine_id INTEGER NOT NULL,
          city TEXT NOT NULL,
          day TEXT NOT NULL,
          min_price INTEGER,
          avg_price INTEGER,
          offers INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (medicine_id, city, day),
          FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
        );

        -- Dorixona statistikasi (kunlik hisoblagichlar)
        CREATE TABLE IF NOT EXISTS pharmacy_stats (
          pharmacy_id INTEGER NOT NULL,
          medicine_id INTEGER NOT NULL DEFAULT 0,
          day TEXT NOT NULL,
          views INTEGER NOT NULL DEFAULT 0,
          calls INTEGER NOT NULL DEFAULT 0,
          routes INTEGER NOT NULL DEFAULT 0,
          reservations INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (pharmacy_id, medicine_id, day),
          FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE
        );

        -- Qidiruv statistikasi (eng ko'p qidirilgan / topilmagan)
        CREATE TABLE IF NOT EXISTS search_stats (
          term TEXT NOT NULL,
          day TEXT NOT NULL,
          searches INTEGER NOT NULL DEFAULT 0,
          zero_results INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (term, day)
        );

        CREATE TABLE IF NOT EXISTS telegram_links (
          code TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS password_resets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          used INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);

        CREATE INDEX IF NOT EXISTS idx_inventory_updated ON inventory(updated_at);
        CREATE INDEX IF NOT EXISTS idx_medicines_norm ON medicines(name_norm);
      `);

      // Mavjud dorilar uchun slug va normallashtirilgan nom
      const U = require('./utils');
      const rows = db.prepare('SELECT id, name, dosage FROM medicines').all();
      const upd = db.prepare('UPDATE medicines SET slug = ?, name_norm = ? WHERE id = ?');
      const used = new Set();
      for (const r of rows) {
        let base = U.slugify(`${r.name} ${r.dosage}`) || `dori-${r.id}`;
        let slug = base;
        if (used.has(slug)) slug = `${base}-${r.id}`;
        used.add(slug);
        upd.run(slug, U.normKey(r.name), r.id);
      }
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_slug ON medicines(slug)');
      // Tasdiqlangan arizalardan yaratilgan dorixonalar litsenziyasi admin tomonidan ko'rilgan
      db.exec(`UPDATE pharmacies SET verified = 1, verified_at = CURRENT_TIMESTAMP
               WHERE license_number != '' AND LOWER(license_number) IN (
                 SELECT LOWER(license_number) FROM pharmacy_requests WHERE status = 'approved')`);
    }
  },
  {
    id: 3,
    name: 'telegram_chats',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS telegram_chats (
          chat_id TEXT PRIMARY KEY,
          lang TEXT NOT NULL DEFAULT 'uz',
          city TEXT NOT NULL DEFAULT 'all',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
    }
  }
];

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

for (const m of migrations) {
  if (db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(m.id)) continue;
  db.transaction(() => {
    m.up();
    db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
  })();
}

module.exports = db;
