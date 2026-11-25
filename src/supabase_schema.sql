-- PostgreSQL / Supabase uchun migratsiya sxemasi (SQLite sxemasi bilan to'liq mos)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'pharmacy_owner', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pharmacy_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  license_number TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  is_247 BOOLEAN NOT NULL DEFAULT FALSE,
  open_time TEXT NOT NULL DEFAULT '08:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pharmacies (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  license_number TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  is_247 BOOLEAN NOT NULL DEFAULT FALSE,
  open_time TEXT NOT NULL DEFAULT '08:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medicines (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  active_ingredient TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  dosage TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Umumiy',
  prescription BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, dosage, manufacturer)
);

CREATE TABLE IF NOT EXISTS inventory (
  id BIGSERIAL PRIMARY KEY,
  pharmacy_id BIGINT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  medicine_id BIGINT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price >= 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'low', 'out')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pharmacy_id, medicine_id)
);

-- Bitta foydalanuvchida bir vaqtda faqat bitta kutilayotgan ariza
CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_requests_one_pending ON pharmacy_requests(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pg_requests_status ON pharmacy_requests(status);
CREATE INDEX IF NOT EXISTS idx_pg_pharmacies_city ON pharmacies(city);
CREATE INDEX IF NOT EXISTS idx_pg_pharmacies_owner ON pharmacies(owner_id);
CREATE INDEX IF NOT EXISTS idx_pg_medicines_name ON medicines(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_pg_medicines_active ON medicines(LOWER(active_ingredient));
CREATE INDEX IF NOT EXISTS idx_pg_inventory_med ON inventory(medicine_id);
CREATE INDEX IF NOT EXISTS idx_pg_inventory_ph ON inventory(pharmacy_id);

-- =====================================================================
-- v2: xavfsizlik, bron, kuzatuv, statistika, audit (SQLite migratsiyalari 2-3 bilan mos)
-- =====================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'uz';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_users_tg ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS logo_path TEXT NOT NULL DEFAULT '';
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS phones JSONB NOT NULL DEFAULT '[]';
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS schedule JSONB;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

ALTER TABLE medicines ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS name_norm TEXT NOT NULL DEFAULT '';
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_medicines_slug ON medicines(slug);
CREATE INDEX IF NOT EXISTS idx_pg_medicines_norm ON medicines(name_norm);
CREATE INDEX IF NOT EXISTS idx_pg_inventory_updated ON inventory(updated_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pg_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_pg_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS price_reports (
  id BIGSERIAL PRIMARY KEY,
  inventory_id BIGINT,
  pharmacy_id BIGINT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  medicine_id BIGINT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  reported_price INTEGER,
  reason TEXT NOT NULL CHECK (reason IN ('wrong_price', 'out_of_stock', 'closed', 'wrong_info', 'other')),
  comment TEXT NOT NULL DEFAULT '',
  reporter_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reporter_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by BIGINT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pg_reports_ph ON price_reports(pharmacy_id, status);

CREATE TABLE IF NOT EXISTS reservations (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pharmacy_id BIGINT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'expired')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  owner_note TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  hold_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pg_res_user ON reservations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_res_ph ON reservations(pharmacy_id, status);

CREATE TABLE IF NOT EXISTS reservation_items (
  id BIGSERIAL PRIMARY KEY,
  reservation_id BIGINT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  medicine_id BIGINT REFERENCES medicines(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  price INTEGER NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medicine_id BIGINT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, medicine_id)
);

CREATE TABLE IF NOT EXISTS watches (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT,
  medicine_id BIGINT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  city TEXT NOT NULL DEFAULT 'all',
  kind TEXT NOT NULL CHECK (kind IN ('available', 'price')),
  last_min_price INTEGER,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR chat_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_watches_unique ON watches(COALESCE(user_id, 0), COALESCE(chat_id, ''), medicine_id, kind, city);

CREATE TABLE IF NOT EXISTS price_daily (
  medicine_id BIGINT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  city TEXT NOT NULL,
  day DATE NOT NULL,
  min_price INTEGER,
  avg_price INTEGER,
  offers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (medicine_id, city, day)
);

CREATE TABLE IF NOT EXISTS pharmacy_stats (
  pharmacy_id BIGINT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  medicine_id BIGINT NOT NULL DEFAULT 0,
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  routes INTEGER NOT NULL DEFAULT 0,
  reservations INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pharmacy_id, medicine_id, day)
);

CREATE TABLE IF NOT EXISTS search_stats (
  term TEXT NOT NULL,
  day DATE NOT NULL,
  searches INTEGER NOT NULL DEFAULT 0,
  zero_results INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (term, day)
);

CREATE TABLE IF NOT EXISTS telegram_links (
  code TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'uz',
  city TEXT NOT NULL DEFAULT 'all',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
