-- ============================================
-- Yemekhane Atık Takip Sistemi - Supabase Schema
-- GÜVENLİ SÜRÜM - RLS + Supabase Auth
-- ============================================

-- ÖNCE RLS'yi kaldır (yeniden oluşturmak için)
DROP POLICY IF EXISTS "anon_all_records" ON records;
DROP POLICY IF EXISTS "anon_all_haccp" ON haccp_records;
DROP POLICY IF EXISTS "anon_all_haccp_depo" ON haccp_depo_adlari;
DROP POLICY IF EXISTS "anon_all_yag" ON yag_records;
DROP POLICY IF EXISTS "anon_all_ambalaj" ON ambalaj_records;
DROP POLICY IF EXISTS "anon_all_kalibrasyon" ON kalibrasyon_cihazlari;
DROP POLICY IF EXISTS "anon_all_dishes" ON dishes;
DROP POLICY IF EXISTS "anon_all_weekly_menu" ON weekly_menu;
DROP POLICY IF EXISTS "anon_all_config" ON config;
DROP POLICY IF EXISTS "anon_all_user_logs" ON user_logs;
DROP POLICY IF EXISTS "auth_all_user_logs" ON user_logs;
DROP POLICY IF EXISTS "service_role_all_config" ON config;

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
  harcama_tutari NUMERIC DEFAULT 0,
  yemek_adi TEXT DEFAULT '',
  created_by UUID REFERENCES auth.users(id),
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE records ENABLE ROW LEVEL SECURITY;

-- Tüm kullanıcılar (anon + authenticated) görebilir, ekleyebilir, güncelleyebilir, silebilir
CREATE POLICY "records_all" ON records FOR ALL
  USING (true) WITH CHECK (true);

-- 3. HACCP KAYITLARI (Gıda Güvenliği)
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

ALTER TABLE haccp_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "haccp_records_all" ON haccp_records FOR ALL
  USING (true) WITH CHECK (true);

-- 4. DEPO ADLARI
CREATE TABLE IF NOT EXISTS haccp_depo_adlari (
  id SERIAL PRIMARY KEY,
  ad TEXT NOT NULL UNIQUE,
  min_limit NUMERIC,
  max_limit NUMERIC
);

ALTER TABLE haccp_depo_adlari ENABLE ROW LEVEL SECURITY;

CREATE POLICY "haccp_depo_all" ON haccp_depo_adlari FOR ALL
  USING (true) WITH CHECK (true);

-- 5. ATIK YAĞ KAYITLARI
CREATE TABLE IF NOT EXISTS yag_records (
  id BIGINT PRIMARY KEY,
  tarih TEXT NOT NULL,
  makbuz_no TEXT DEFAULT '',
  tur TEXT DEFAULT '',
  miktar NUMERIC DEFAULT 0,
  not_ TEXT DEFAULT '',
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE yag_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "yag_records_all" ON yag_records FOR ALL
  USING (true) WITH CHECK (true);

-- 6. AMBALAJ ATIKLARI KAYITLARI
CREATE TABLE IF NOT EXISTS ambalaj_records (
  id BIGINT PRIMARY KEY,
  tarih TEXT NOT NULL,
  tur TEXT DEFAULT '',
  miktar NUMERIC DEFAULT 0,
  birim TEXT DEFAULT 'kg',
  not_ TEXT DEFAULT '',
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE ambalaj_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ambalaj_records_all" ON ambalaj_records FOR ALL
  USING (true) WITH CHECK (true);

-- 6b. KALİBRASYONA TABİ CİHAZLAR
CREATE TABLE IF NOT EXISTS kalibrasyon_cihazlari (
  id BIGINT PRIMARY KEY,
  cihaz_adi TEXT NOT NULL DEFAULT '',
  marka_model TEXT DEFAULT '',
  sicil_no TEXT DEFAULT '',
  durum TEXT NOT NULL DEFAULT 'calisir',
  dogrulama TEXT DEFAULT '',
  son_kalibrasyon TEXT DEFAULT '',
  sonraki_kalibrasyon TEXT DEFAULT '',
  konum TEXT DEFAULT '',
  sorumlu TEXT DEFAULT '',
  not_ TEXT DEFAULT '',
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE kalibrasyon_cihazlari ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kalibrasyon_cihazlari_all" ON kalibrasyon_cihazlari FOR ALL
  USING (true) WITH CHECK (true);

-- 7. YEMEK LİSTESİ (Dish Pool)
CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  ad TEXT NOT NULL,
  kalori TEXT DEFAULT '',
  alerjen TEXT DEFAULT '',
  tarif JSONB DEFAULT '[]'::jsonb,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dishes_all" ON dishes FOR ALL
  USING (true) WITH CHECK (true);

-- 8. HAFTALIK MENÜ
CREATE TABLE IF NOT EXISTS weekly_menu (
  week_key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE weekly_menu ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_menu_all" ON weekly_menu FOR ALL
  USING (true) WITH CHECK (true);

-- 9. YAPILANDIRMA (sadece service_role ile erişilebilir)
-- NOT: Bu tabloya anon key ile erişilemez. Sadece Supabase Dashboard'dan
-- veya service_role key ile yapılan işlemler erişebilir.
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE config ENABLE ROW LEVEL SECURITY;

-- NOT: Yalnızca 'role_permissions' ve 'harcama_oranlari' satırlarına anon erişim izni verilir.
-- Böylece yönetim panelindeki rol izin kutucukları ve harcama oranları tüm cihazlara senkronize
-- olur, diğer config satırları (örn. legacy user hash'leri) korunur.
CREATE POLICY "anon_role_permissions" ON config FOR ALL
  USING (key IN ('role_permissions', 'harcama_oranlari'))
  WITH CHECK (key IN ('role_permissions', 'harcama_oranlari'));

-- Varsayılan config değerleri (Service Role ile çalıştırılmalı)
-- Aşağıdaki INSERT'ler service_role ile çalıştırılmalıdır, anon ile çalışmaz.
-- INSERT INTO config (key, value) VALUES
--   ('users_list', '[{"username":"admin","passwordHash":"...","role":"admin","displayName":"Admin"}]')
-- ON CONFLICT (key) DO NOTHING;

-- Mevcut tabloya limit kolonlarını ekle (geriye uyumlu)
ALTER TABLE haccp_depo_adlari ADD COLUMN IF NOT EXISTS min_limit NUMERIC;
ALTER TABLE haccp_depo_adlari ADD COLUMN IF NOT EXISTS max_limit NUMERIC;

-- Mevcut kayıt tablosuna harcama_tutari kolonunu ekle (geriye uyumlu)
ALTER TABLE records ADD COLUMN IF NOT EXISTS harcama_tutari NUMERIC DEFAULT 0;

-- Mevcut ambalaj tablosuna birim kolonunu ekle (g/kg desteği, geriye uyumlu)
-- NOT: Bu ALTER olmadan ambalaj kayıtlarının Supabase senkronu başarısız olur
-- (ambalajRecordToDB birim alanı gönderdiği için upsert 42703 hatası verir).
ALTER TABLE ambalaj_records ADD COLUMN IF NOT EXISTS birim TEXT DEFAULT 'kg';
ALTER TABLE yag_records ADD COLUMN IF NOT EXISTS birim TEXT DEFAULT 'lt';

-- Varsayılan depo adları
INSERT INTO haccp_depo_adlari (ad) VALUES
  ('Soğuk Hava Deposu 5'),
  ('Soğuk Hava Deposu 6'),
  ('Soğuk Hava Deposu 7'),
  ('Soğuk Hava Deposu 8')
ON CONFLICT (ad) DO NOTHING;

-- 10. KULLANICI İŞLEM LOG TABLOSU
CREATE TABLE IF NOT EXISTS user_logs (
  id BIGSERIAL PRIMARY KEY,
  tarih TEXT NOT NULL,
  kullanici TEXT DEFAULT '',
  rol TEXT DEFAULT '',
  islem TEXT DEFAULT '',
  detay TEXT DEFAULT ''
);

ALTER TABLE user_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_logs_all" ON user_logs FOR ALL
  USING (true) WITH CHECK (true);

-- 11. KULLANICI ROLLERİ (Supabase Auth'a geçildiğinde kullanılır)
-- Şu an legacy auth kullanılıyorsa bu tablo kullanılmaz, ama ilerisi için hazır
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- NOT: role kolonunda CHECK kısıtı yoktur (özel roller + 'sadece_gorme' için).
  role TEXT NOT NULL DEFAULT 'asci',
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Geçiş döneminde herkes görebilir; Supabase Auth aktifleşince kısıtlanır
CREATE POLICY "user_roles_all" ON user_roles FOR ALL
  USING (true) WITH CHECK (true);

-- Her auth kullanıcısına en fazla bir rol satırı (assign_user_role ve
-- uygulamanın upsert/insert işlemleri için gerekli benzersizlik)
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_auth_user_id_key;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_auth_user_id_key UNIQUE (auth_user_id);

-- 12. UYGULAMA KULLANICILARI (legacy listesinin Supabase üzerinden senkronu)
-- Yönetim panelindeki kullanıcı yönetimi (şifre/rol değişikliği) bu tabloya
-- yazılır ve tüm cihazlarda app_users'tan çekilir. Böylece şifre değişikliği
-- yalnızca tek tarayıcıda değil, her cihazda geçerli olur.
CREATE TABLE IF NOT EXISTS app_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  -- NOT: role kolonunda CHECK kısıtı yoktur (özel roller + 'sadece_gorme' için).
  role TEXT NOT NULL DEFAULT 'asci',
  display_name TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Geçiş döneminde herkes görebilir/yazabilir; ileride sadece authenticated'e kısıtlanır
CREATE POLICY "app_users_all" ON app_users FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================
-- MİGRASYON (MEVCUT VERİTABANI İÇİN)
-- ============================================
-- Bu komutları Supabase Dashboard > SQL Editor'da çalıştırın.
-- 'sadece_gorme' (görme yetkili) ve yönetim panelinde eklenen özel rollerin
-- app_users / user_roles tablolarına kaydedilememesi sorununu çözer.
-- Aksi halde yönetim panelinden eklenen görme yetkili kullanıcı başka
-- cihazlarda giriş listesinde GÖRÜNMEZ.
--
-- ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
-- ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
--
-- CREATE POLICY "anon_role_permissions" ON config FOR ALL
--   USING (key = 'role_permissions')
--   WITH CHECK (key = 'role_permissions');
