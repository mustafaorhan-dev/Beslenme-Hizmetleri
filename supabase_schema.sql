-- ============================================
-- Yemekhane Atık Takip Sistemi - Supabase Schema
-- ============================================

-- 1. ANA KAYITLAR (Atık Kontrol Sistemi)
CREATE TABLE IF NOT EXISTS records (
  id BIGINT PRIMARY KEY,
  tarih TEXT NOT NULL,
  yemek NUMERIC DEFAULT 0,
  fire NUMERIC DEFAULT 0,
  turnike NUMERIC DEFAULT 0,
  personel NUMERIC DEFAULT 0,
  toplam NUMERIC DEFAULT 0,
  porsiyon NUMERIC DEFAULT 0,
  atik NUMERIC DEFAULT 0,
  ogrenci NUMERIC DEFAULT 0,
  yemek_adi TEXT DEFAULT '',
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

-- 2. HACCP KAYITLARI (Gıda Güvenliği)
CREATE TABLE IF NOT EXISTS haccp_records (
  id BIGINT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'sicaklik',
  tarih TEXT NOT NULL,
  saat TEXT DEFAULT '',
  depo_ad TEXT DEFAULT '',
  sicaklik NUMERIC,
  nem NUMERIC,
  not_ TEXT DEFAULT '',
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

-- 3. DEPO ADLARI
CREATE TABLE IF NOT EXISTS haccp_depo_adlari (
  id SERIAL PRIMARY KEY,
  ad TEXT NOT NULL UNIQUE
);

-- 4. ATIK YAĞ KAYITLARI
CREATE TABLE IF NOT EXISTS yag_records (
  id BIGINT PRIMARY KEY,
  tarih TEXT NOT NULL,
  makbuz_no TEXT DEFAULT '',
  tur TEXT DEFAULT '',
  miktar NUMERIC DEFAULT 0,
  not_ TEXT DEFAULT '',
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

-- 5. AMBALAJ ATIKLARI KAYITLARI
CREATE TABLE IF NOT EXISTS ambalaj_records (
  id BIGINT PRIMARY KEY,
  tarih TEXT NOT NULL,
  tur TEXT DEFAULT '',
  miktar NUMERIC DEFAULT 0,
  not_ TEXT DEFAULT '',
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

-- 6. YEMEK LİSTESİ (Dish Pool)
CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  ad TEXT NOT NULL,
  kalori TEXT DEFAULT '',
  alerjen TEXT DEFAULT '',
  tarif JSONB DEFAULT '[]'::jsonb,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

-- 7. HAFTALIK MENÜ
CREATE TABLE IF NOT EXISTS weekly_menu (
  week_key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

-- 8. YAPILANDIRMA (şifre hashleri, viewer ayarları vb.)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

-- Varsayılan config değerleri
INSERT INTO config (key, value) VALUES
  ('admin_hash', '83e19a9ce479dc064bab4bd50134db14918cc967debd3ad223bb8993c523788d'),
  ('viewer_hash', '137d2ccfeadfd410b7f455133360a5ad6650d0768c3b773c13cd5e7e871e483f'),
  ('viewer_settings', '{"editAllowed":false,"tabs":{"dashboard":true,"menu":true,"records":true,"report":true,"haccp":true,"yag":true,"ambalaj":true,"charts":true},"showExportBtn":false,"showSyncBtn":false,"showActions":false}')
ON CONFLICT (key) DO NOTHING;

-- Varsayılan depo adları
INSERT INTO haccp_depo_adlari (ad) VALUES
  ('Soğuk Hava Deposu 5'),
  ('Soğuk Hava Deposu 6'),
  ('Soğuk Hava Deposu 7'),
  ('Soğuk Hava Deposu 8')
ON CONFLICT (ad) DO NOTHING;

-- RLS: Herkese açık (anon key ile) - kendi auth sisteminiz olduğu için
ALTER TABLE records DISABLE ROW LEVEL SECURITY;
ALTER TABLE haccp_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE haccp_depo_adlari DISABLE ROW LEVEL SECURITY;
ALTER TABLE yag_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE ambalaj_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE dishes DISABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_menu DISABLE ROW LEVEL SECURITY;
ALTER TABLE config DISABLE ROW LEVEL SECURITY;
