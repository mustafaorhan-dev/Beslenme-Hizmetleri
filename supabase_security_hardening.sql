-- ============================================
-- GÜVENLİK SERTLEŞTİRME MİGRASYONU
-- Supabase Dashboard > SQL Editor'da çalıştırın.
-- ============================================

-- is_admin helper
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE username = auth.jwt() ->> 'email' AND role = 'admin'
  );
$$;

-- Records
DROP POLICY IF EXISTS "records_all" ON records;
CREATE POLICY "records_authenticated_all" ON records FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- HACCP
DROP POLICY IF EXISTS "haccp_records_all" ON haccp_records;
CREATE POLICY "haccp_records_authenticated_all" ON haccp_records FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "haccp_depo_all" ON haccp_depo_adlari;
CREATE POLICY "haccp_depo_authenticated_all" ON haccp_depo_adlari FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- Yag
DROP POLICY IF EXISTS "yag_records_all" ON yag_records;
CREATE POLICY "yag_records_authenticated_all" ON yag_records FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- Ambalaj
DROP POLICY IF EXISTS "ambalaj_records_all" ON ambalaj_records;
CREATE POLICY "ambalaj_records_authenticated_all" ON ambalaj_records FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- Kalibrasyon
DROP POLICY IF EXISTS "kalibrasyon_cihazlari_all" ON kalibrasyon_cihazlari;
CREATE POLICY "kalibrasyon_cihazlari_authenticated_all" ON kalibrasyon_cihazlari FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- Dishes
DROP POLICY IF EXISTS "dishes_all" ON dishes;
CREATE POLICY "dishes_authenticated_all" ON dishes FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- Weekly menu
DROP POLICY IF EXISTS "weekly_menu_all" ON weekly_menu;
CREATE POLICY "weekly_menu_authenticated_all" ON weekly_menu FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- Unit prices
DROP POLICY IF EXISTS "unit_prices_all" ON unit_prices;
CREATE POLICY "unit_prices_authenticated_all" ON unit_prices FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- user_logs
DROP POLICY IF EXISTS "user_logs_all" ON user_logs;
CREATE POLICY "user_logs_insert_authenticated" ON user_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY "user_logs_admin_read" ON user_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- app_users
DROP POLICY IF EXISTS "app_users_all" ON app_users;
DROP POLICY IF EXISTS "app_users_self_read" ON app_users;
DROP POLICY IF EXISTS "app_users_admin_all" ON app_users;
CREATE POLICY "app_users_self_read" ON app_users FOR SELECT
  TO authenticated
  USING (username = auth.jwt() ->> 'email');
CREATE POLICY "app_users_admin_all" ON app_users FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- user_roles
DROP POLICY IF EXISTS "user_roles_all" ON user_roles;
DROP POLICY IF EXISTS "user_roles_self_read" ON user_roles;
DROP POLICY IF EXISTS "user_roles_self_insert" ON user_roles;
DROP POLICY IF EXISTS "user_roles_self_update" ON user_roles;
DROP POLICY IF EXISTS "user_roles_admin_all" ON user_roles;
CREATE POLICY "user_roles_self_read" ON user_roles FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());
CREATE POLICY "user_roles_self_insert" ON user_roles FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY "user_roles_self_update" ON user_roles FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY "user_roles_admin_all" ON user_roles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- config
DROP POLICY IF EXISTS "anon_role_permissions" ON config;
DROP POLICY IF EXISTS "config_read_authenticated" ON config;
DROP POLICY IF EXISTS "config_write_admin" ON config;
DROP POLICY IF EXISTS "config_update_admin" ON config;
DROP POLICY IF EXISTS "config_delete_admin" ON config;
CREATE POLICY "config_read_authenticated" ON config FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "config_write_admin" ON config FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND key IN ('role_permissions', 'harcama_oranlari', 'app_version', 'app_build'));
CREATE POLICY "config_update_admin" ON config FOR UPDATE
  TO authenticated
  USING (public.is_admin() AND key IN ('role_permissions', 'harcama_oranlari', 'app_version', 'app_build'))
  WITH CHECK (public.is_admin() AND key IN ('role_permissions', 'harcama_oranlari', 'app_version', 'app_build'));
CREATE POLICY "config_delete_admin" ON config FOR DELETE
  TO authenticated
  USING (public.is_admin() AND key IN ('role_permissions', 'harcama_oranlari', 'app_version', 'app_build'));
