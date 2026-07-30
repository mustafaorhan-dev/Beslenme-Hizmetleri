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
DROP POLICY IF EXISTS "anon_all_dishes" ON dishes;
DROP POLICY IF EXISTS "anon_all_weekly_menu" ON weekly_menu;
DROP POLICY IF EXISTS "anon_all_config" ON config;
DROP POLICY IF EXISTS "anon_all_user_logs" ON user_logs;
DROP POLICY IF EXISTS "auth_all_user_logs" ON user_logs;
DROP POLICY IF EXISTS "service_role_all_config" ON config;

-- 1. KULLANICI ROLLERİ (Supabase Auth ile bağlantılı)
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'asci' CHECK (role IN ('admin','diyetisyen','depo','asci','gida_muhendisi','temizlikci')),
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Her kullanıcı kendi rolünü görebilir; admin tümünü görebilir
CREATE POLICY "user_roles_select" ON user_roles FOR SELECT
  USING (auth.uid() = auth_user_id OR EXISTS (
    SELECT 1 FROM user_roles WHERE auth_user_id = auth.uid() AND role = 'admin'
  ));

-- Sadece admin tarafından eklenebilir/güncellenebilir
CREATE POLICY "user_roles_insert" ON user_roles FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE auth_user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "user_roles_update" ON user_roles FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_roles WHERE auth_user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE auth_user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "user_roles_delete" ON user_roles FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_roles WHERE auth_user_id = auth.uid() AND role = 'admin'));

-- 2. ANA KAYITLAR (Atık Kontrol Sistemi)
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

-- Giriş yapan tüm kullanıcılar görebilir, ekleyebilir, güncelleyebilir, silebilir
CREATE POLICY "records_select" ON records FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "records_insert" ON records FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "records_update" ON records FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "records_delete" ON records FOR DELETE
  USING (auth.role() = 'authenticated');

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
  created_by UUID REFERENCES auth.users(id),
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE haccp_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "haccp_records_select" ON haccp_records FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "haccp_records_insert" ON haccp_records FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "haccp_records_update" ON haccp_records FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "haccp_records_delete" ON haccp_records FOR DELETE
  USING (auth.role() = 'authenticated');

-- 4. DEPO ADLARI
CREATE TABLE IF NOT EXISTS haccp_depo_adlari (
  id SERIAL PRIMARY KEY,
  ad TEXT NOT NULL UNIQUE,
  min_limit NUMERIC,
  max_limit NUMERIC
);

ALTER TABLE haccp_depo_adlari ENABLE ROW LEVEL SECURITY;

CREATE POLICY "haccp_depo_select" ON haccp_depo_adlari FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "haccp_depo_insert" ON haccp_depo_adlari FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "haccp_depo_update" ON haccp_depo_adlari FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "haccp_depo_delete" ON haccp_depo_adlari FOR DELETE
  USING (auth.role() = 'authenticated');

-- 5. ATIK YAĞ KAYITLARI
CREATE TABLE IF NOT EXISTS yag_records (
  id BIGINT PRIMARY KEY,
  tarih TEXT NOT NULL,
  makbuz_no TEXT DEFAULT '',
  tur TEXT DEFAULT '',
  miktar NUMERIC DEFAULT 0,
  not_ TEXT DEFAULT '',
  created_by UUID REFERENCES auth.users(id),
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE yag_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "yag_records_select" ON yag_records FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "yag_records_insert" ON yag_records FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "yag_records_update" ON yag_records FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "yag_records_delete" ON yag_records FOR DELETE
  USING (auth.role() = 'authenticated');

-- 6. AMBALAJ ATIKLARI KAYITLARI
CREATE TABLE IF NOT EXISTS ambalaj_records (
  id BIGINT PRIMARY KEY,
  tarih TEXT NOT NULL,
  tur TEXT DEFAULT '',
  miktar NUMERIC DEFAULT 0,
  birim TEXT DEFAULT 'kg',
  not_ TEXT DEFAULT '',
  created_by UUID REFERENCES auth.users(id),
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE ambalaj_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ambalaj_records_select" ON ambalaj_records FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "ambalaj_records_insert" ON ambalaj_records FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "ambalaj_records_update" ON ambalaj_records FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "ambalaj_records_delete" ON ambalaj_records FOR DELETE
  USING (auth.role() = 'authenticated');

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

CREATE POLICY "dishes_select" ON dishes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "dishes_insert" ON dishes FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "dishes_update" ON dishes FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "dishes_delete" ON dishes FOR DELETE
  USING (auth.role() = 'authenticated');

-- 8. HAFTALIK MENÜ
CREATE TABLE IF NOT EXISTS weekly_menu (
  week_key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE weekly_menu ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_menu_select" ON weekly_menu FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "weekly_menu_insert" ON weekly_menu FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "weekly_menu_update" ON weekly_menu FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "weekly_menu_delete" ON weekly_menu FOR DELETE
  USING (auth.role() = 'authenticated');

-- 9. YAPILANDIRMA (sadece service_role ile erişilebilir)
-- NOT: Bu tabloya anon key ile erişilemez. Sadece Supabase Dashboard'dan
-- veya service_role key ile yapılan işlemler erişebilir.
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE config ENABLE ROW LEVEL SECURITY;

-- NOT: Bu tabloya hiçbir policy eklenmez. Sadece service_role erişebilir.
-- Bu sayede kullanıcı hash'leri ve ayarlar anon key'den korunur.

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

CREATE POLICY "user_logs_select" ON user_logs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "user_logs_insert" ON user_logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
