-- ============================================================
-- SÜRÜM SENKRONİZASYONU
-- Admin paneldeki "Sürümü Yayınla" butonunun tüm cihazlara
-- ulaşması için config tablosundaki policy'yi genişletir.
-- Supabase Dashboard > SQL Editor'de BİR KEZ çalıştırın.
-- ============================================================

DROP POLICY IF EXISTS "anon_role_permissions" ON config;

CREATE POLICY "anon_role_permissions" ON config FOR ALL
  USING (key IN ('role_permissions', 'harcama_oranlari', 'app_version', 'app_build'))
  WITH CHECK (key IN ('role_permissions', 'harcama_oranlari', 'app_version', 'app_build'));

-- Başlangıç değerleri (varsa korunur)
INSERT INTO config (key, value) VALUES
  ('app_version', '1.4.0'),
  ('app_build', '134')
ON CONFLICT (key) DO NOTHING;
