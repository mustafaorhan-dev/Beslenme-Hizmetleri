-- ============================================================
-- KİŞİ BAZLI İZİNLER + E-POSTA İLE GİRİŞ
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.
-- ============================================================

-- 1) app_users tablosuna kişiye özel izin + aktiflik kolonları.
--    username artık e-posta adresini tutar (ör: ad.soyad@ahievran.edu.tr).
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS permissions TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) user_roles tablosunda auth_user_id benzersiz olsun (varsa atlanır).
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_auth_user_id_key;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_auth_user_id_key UNIQUE (auth_user_id);

-- ============================================================
-- 3) İLK ADMİNİ TANIMLAMA (BOOTSTRAP)
-- ============================================================
-- Supabase Authentication'da açtığınız admin e-postasını buraya yazın.
-- Program ilk açıldığında bu kayıt sayesinde admin rolünü alır.
--
-- Aşağıdaki satırları kendi e-postanızla düzenleyip çalıştırın:
--
-- INSERT INTO app_users (username, password_hash, role, display_name, permissions)
-- VALUES ('mustafa.orhan@ahievran.edu.tr', '', 'admin', 'Mustafa Orhan', NULL)
-- ON CONFLICT (username) DO UPDATE
--   SET role = 'admin', display_name = EXCLUDED.display_name;

-- ============================================================
-- NOTLAR
-- ============================================================
-- * Şifre bu tabloya YAZILMAZ. Şifreler Supabase Authentication'da tutulur.
-- * Yeni kişi eklerken:
--     1. Supabase > Authentication > Users > Add user: e-posta + geçici şifre
--     2. Program > Yönetim Paneli > Kullanıcı Yönetimi: ad, e-posta, rol, tikler
-- * Kullanıcı ilk girişinde rol ve izinler e-posta üzerinden eşleştirilir.
-- * Kişi giriş yaptıktan sonra sağ üstteki anahtar simgesinden şifresini değiştirebilir.
