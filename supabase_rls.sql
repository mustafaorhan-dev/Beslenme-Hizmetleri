-- RLS (rekursiyonsuz)
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

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_users_self_read" ON app_users;
DROP POLICY IF EXISTS "app_users_admin_all" ON app_users;
DROP POLICY IF EXISTS "user_roles_self_read" ON user_roles;
DROP POLICY IF EXISTS "user_roles_admin_all" ON user_roles;

CREATE POLICY "app_users_self_read" ON app_users
  FOR SELECT TO authenticated
  USING (username = auth.jwt() ->> 'email');

CREATE POLICY "app_users_admin_all" ON app_users
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "user_roles_self_read" ON user_roles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "user_roles_admin_all" ON user_roles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
