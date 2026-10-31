-- ============================================================
-- ROW LEVEL SECURITY (RLS) - BHYS
-- Supabase Dashboard > SQL Editor'da çalıştırın.
-- ============================================================

-- Tüm tablolarda RLS'i aç
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- app_users: sadece kendi kaydını okuyabilir; admin her şeyi yapabilir.
-- Not: rol kontrolü için auth.jwt() veya user_roles tablosu kullanılabilir.
-- Basit politika: anon/authenticated sadece kendi e-postasıyla eşleşen kaydı okur.
CREATE POLICY "app_users_self_read" ON app_users
  FOR SELECT TO authenticated
  USING (username = auth.jwt() ->> 'email');

CREATE POLICY "app_users_admin_all" ON app_users
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.auth_user_id = auth.uid() AND ur.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.auth_user_id = auth.uid() AND ur.role = 'admin')
  );

-- user_roles: kendi kaydını okuyabilir; admin yönetir.
CREATE POLICY "user_roles_self_read" ON user_roles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "user_roles_admin_all" ON user_roles
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.auth_user_id = auth.uid() AND ur.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.auth_user_id = auth.uid() AND ur.role = 'admin')
  );

-- Diğer veri tabloları (records, menu, vb.) için örnek: authenticated okur/yazar, anon hiçbir şey yapamaz.
-- Her tablo için ayrı policy oluşturun. Örnek:
-- ALTER TABLE records ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "records_auth_all" ON records FOR ALL TO authenticated USING (true) WITH CHECK (true);