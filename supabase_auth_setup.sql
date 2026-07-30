/*
  ============================================
  Supabase Auth + RLS Güvenlik Kurulum Scripti
  ============================================
  
  Bu script'i Supabase Dashboard > SQL Editor'da çalıştırın.
  
  ÖNEMLİ: Önce supabase_schema.sql'i çalıştırın, sonra bu script'i çalıştırın.
  
  Adımlar:
  1. SQL Editor'da bu script'i çalıştırın
  2. Supabase Dashboard > Authentication > Users sayfasından kullanıcıları oluşturun
  3. Aşağıdaki fonksiyon ile her kullanıcıya rol atayın
  
  Kullanıcı oluşturma (Dashboard'dan):
  - email: admin@kurumadi.com
  - password: (güçlü bir şifre)
  
  Rol atama (SQL ile):
  SELECT assign_user_role('kullanici-uuid', 'admin', 'Admin Adı');
*/

-- Kullanıcılara rol atamak için yardımcı fonksiyon
CREATE OR REPLACE FUNCTION assign_user_role(
  p_auth_user_id UUID,
  p_role TEXT,
  p_display_name TEXT DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_roles (auth_user_id, role, display_name)
  VALUES (p_auth_user_id, p_role, p_display_name)
  ON CONFLICT (auth_user_id) 
  DO UPDATE SET role = p_role, display_name = p_display_name;
END;
$$;

-- Örnek kullanım (Dashboard'dan UUID'yi aldıktan sonra):
-- SELECT assign_user_role('00000000-0000-0000-0000-000000000000', 'admin', 'Admin');
-- SELECT assign_user_role('00000000-0000-0000-0000-000000000001', 'diyetisyen', 'Diyetisyen');
-- SELECT assign_user_role('00000000-0000-0000-0000-000000000002', 'depo', 'Depo Sorumlusu');
-- SELECT assign_user_role('00000000-0000-0000-0000-000000000003', 'asci', 'Aşçı');
-- SELECT assign_user_role('00000000-0000-0000-0000-000000000004', 'gida_muhendisi', 'Gıda Mühendisi');
