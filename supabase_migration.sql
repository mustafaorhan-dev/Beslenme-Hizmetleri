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

-- 3) config tablosunda yalnızca 'role_permissions' satırına anon erişim
--    (rol izin kutucuklarının tüm cihazlara senkronu için)
DROP POLICY IF EXISTS "anon_role_permissions" ON config;
CREATE POLICY "anon_role_permissions" ON config FOR ALL
  USING (key = 'role_permissions')
  WITH CHECK (key = 'role_permissions');

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
