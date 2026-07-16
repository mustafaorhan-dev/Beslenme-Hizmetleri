-- ============================================
-- Yemekhane Atık Takip Sistemi - Supabase Schema
-- RLS enabled with proper policies
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
  harcama_tutari NUMERIC DEFAULT 0,
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
  ad TEXT NOT NULL UNIQUE,
  min_limit NUMERIC,
  max_limit NUMERIC
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
  birim TEXT DEFAULT 'kg',
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
  ('viewer_settings', '{"editAllowed":false,"tabs":{"dashboard":true,"menu":true,"records":true,"report":true,"haccp":true,"yag":true,"ambalaj":true,"charts":true},"showExportBtn":false,"showSyncBtn":false,"showActions":false}'),
  ('users_list', '[{"username":"admin","passwordHash":"e4b4617b9d7c3c1bed904600c772cf9ae83896aaff83a9cf9c04fa46fc11f126","role":"admin","displayName":"Admin"},{"username":"diyetisyen","passwordHash":"27bb63ed6f711388cd6e7b053728de769515945977022b6414ecc9ca546a0889","role":"diyetisyen","displayName":"Diyetisyen"},{"username":"depo","passwordHash":"fddc599a3afe6c68b8098f7ef3db02335f7e398e3c0bd34b663f04f424886aeb","role":"depo","displayName":"Depo Sorumlusu"},{"username":"ascı","passwordHash":"a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3","role":"asci","displayName":"Aşçı"}]')
ON CONFLICT (key) DO NOTHING;

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

-- ============================================
-- RLS GÜVENLİK POLİTİKALARI
-- Uygulama kendi kimlik doğrulamasını kullandığı için
-- anon key ile tüm işlemlere izin veriyoruz.
-- İleride Supabase Auth entegrasyonu ile
-- kısıtlanabilir.
-- ============================================

-- Önce RLS'yi aktifleştir
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE haccp_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE haccp_depo_adlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE yag_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ambalaj_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;

-- Anonim kullanıcılar için tüm tablolarda tam yetki
CREATE POLICY "anon_all_records" ON records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_haccp" ON haccp_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_haccp_depo" ON haccp_depo_adlari FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_yag" ON yag_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_ambalaj" ON ambalaj_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_dishes" ON dishes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_weekly_menu" ON weekly_menu FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_config" ON config FOR ALL TO anon USING (true) WITH CHECK (true);

-- NOT: Güvenlik için ileride şu adımlar atılmalıdır:
-- 1. Supabase Auth (email/şifre veya magic link) entegre edilmeli
-- 2. RLS politikaları JWT claim'lerine göre daraltılmalı
-- 3. Admin işlemleri service_role key ile yapılmalı
-- 4. Config tablosundaki hash'ler asla anon key ile okunmamalı

-- Mevcut ambalaj_records tablosuna birim kolonu ekle (çalıştırılması gereken ALTER)
ALTER TABLE ambalaj_records ADD COLUMN IF NOT EXISTS birim TEXT DEFAULT 'kg';
