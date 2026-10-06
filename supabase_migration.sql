-- ============================================
-- MİGRASYON - Ağu 2026
-- ============================================
-- Bu dosyayı Supabase Dashboard > SQL Editor'da açıp çalıştırın.
--
-- Ne yapar?
-- 1) 'sadece_gorme' (ve yönetim panelinde eklenen özel) rollerin
--    app_users / user_roles tablosuna kaydedilmesini sağlar.
--    (Bu düzeltilmezse eklenen kullanıcı başka cihazlarda giriş
--    listesinde görünmez.)
-- 2) Yönetim panelindeki rol izin kutucuklarının (depo sıcaklık,
--    atık yağ, ambalaj vb.) tüm cihazlara senkronize olmasını sağlar.

-- ÖNEMLİ: Bu komutlar mevcut veritabanında SORUNSUZCA çalışır.
-- Kısıt zaten yoksa IF EXISTS sayesinde hata vermez.

-- 1) app_users rol kısıtını kaldır
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;

-- 2) user_roles rol kısıtını kaldır
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;

-- 3) config tablosunda yalnızca 'role_permissions' ve 'harcama_oranlari' satırlarına anon erişim
--    (rol izin kutucuklarının ve harcama oranlarının tüm cihazlara senkronu için)
DROP POLICY IF EXISTS "anon_role_permissions" ON config;
CREATE POLICY "anon_role_permissions" ON config FOR ALL
  USING (key IN ('role_permissions', 'harcama_oranlari', 'app_version', 'app_build'))
  WITH CHECK (key IN ('role_permissions', 'harcama_oranlari', 'app_version', 'app_build'));

-- 4) KALİBRASYONA TABİ CİHAZLAR tablosu + erişim politikası
--    durum değerleri: calisir, arizali, bakim, hurda
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

-- Eski sürümden (yapildi boolean) gelen tabloyu yeni durum alanına çevir
ALTER TABLE kalibrasyon_cihazlari DROP COLUMN IF EXISTS yapildi;
ALTER TABLE kalibrasyon_cihazlari ADD COLUMN IF NOT EXISTS durum TEXT NOT NULL DEFAULT 'calisir';

ALTER TABLE kalibrasyon_cihazlari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kalibrasyon_cihazlari_all" ON kalibrasyon_cihazlari;
CREATE POLICY "kalibrasyon_cihazlari_all" ON kalibrasyon_cihazlari FOR ALL
  USING (true) WITH CHECK (true);

-- 5) BİRİM FİYAT LİSTESİ tablosu + erişim politikası
--    Yemeklerde kullanılan malzemelerin kg/lt/adet birim fiyatlarını tutar
--    Yıl bazlı: her yıl için ayrı birim fiyat girilir
--
--    id TEXT (SERIAL DEĞİL): Uygulama satırları çevrimdışı da kullanılabilsin
--    diye kendi ürettiği metin id ile saklıyor (Date.now().toString(36)+rastgele),
--    'dishes' tablosu da aynı şekilde TEXT PRIMARY KEY kullanıyor. id SERIAL
--    (integer) kaldığı sürece yeni eklenen/güncellenen ürünlerde
--    "invalid input syntax for type integer" (22P02) hatası veriyor,
--    hata yutulduğu için ürün "kaydedildi" görünüp sayfa yenilenince kayboluyordu.
CREATE TABLE IF NOT EXISTS unit_prices (
  id TEXT PRIMARY KEY,
  urun_adi TEXT NOT NULL,
  birim TEXT NOT NULL DEFAULT 'kg',
  birim_fiyat NUMERIC(10,2) NOT NULL DEFAULT 0,
  yil INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  birim_carpan NUMERIC(10,4) DEFAULT 0,
  birim_alt TEXT NOT NULL DEFAULT 'kg',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

-- 5b) Eski kurulumda id SERIAL (integer) ise TEXT'e çevir.
--     Mevcut satırların id'si olduğu gibi korunur; yalnızca tip değişir.
DO $$
DECLARE
  mevcut_tip TEXT;
BEGIN
  SELECT data_type INTO mevcut_tip
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'unit_prices'
     AND column_name = 'id';

  IF mevcut_tip IS NOT NULL AND mevcut_tip <> 'text' THEN
    EXECUTE 'ALTER TABLE unit_prices ADD COLUMN id_text TEXT';
    EXECUTE 'UPDATE unit_prices SET id_text = id::TEXT WHERE id_text IS NULL';
    EXECUTE 'ALTER TABLE unit_prices DROP CONSTRAINT IF EXISTS unit_prices_pkey';
    EXECUTE 'ALTER TABLE unit_prices DROP COLUMN id';
    EXECUTE 'ALTER TABLE unit_prices RENAME COLUMN id_text TO id';
    EXECUTE 'ALTER TABLE unit_prices ADD PRIMARY KEY (id)';
  END IF;
END $$;

-- 6) BİRİM ÇARPANI - her ürünün kendi birim dönüşüm oranı
--    1 teneke = 18 lt, 1 koli = 10 kg, 1 adet = X gr vb.
--    Bu kolon olmadan uygulamanın upsert'i 42703 (column not found) ile
--    BAŞARISIZ olur; o yüzden yukarıdaki CREATE TABLE'da da tanımlı.
ALTER TABLE unit_prices ADD COLUMN IF NOT EXISTS birim_carpan NUMERIC(10,4) DEFAULT 0;
ALTER TABLE unit_prices ADD COLUMN IF NOT EXISTS last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));

-- 6b) KOLİ ALT BİRİMİ - koli iki anlama geliyor:
--       'kg'   -> 1 koli = X kilogram  (örn. 1 koli = 10 kg)
--       'adet' -> 1 koli = X adet     (örn. yumurta: 1 koli = 30 adet)
--     DEFAULT 'kg' eski kayıtların davranışını olduğu gibi korur; bu
--     kolon olmadan uygulamanın upsert'i 42703 ile başarısız olur.
ALTER TABLE unit_prices ADD COLUMN IF NOT EXISTS birim_alt TEXT NOT NULL DEFAULT 'kg';
UPDATE unit_prices SET birim_alt = 'kg' WHERE birim_alt IS NULL OR birim_alt NOT IN ('kg', 'adet');

ALTER TABLE unit_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "unit_prices_all" ON unit_prices;
CREATE POLICY "unit_prices_all" ON unit_prices FOR ALL
  USING (true) WITH CHECK (true);
