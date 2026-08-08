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
