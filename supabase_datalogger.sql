-- ============================================================================
--  DATALOGGER (SICAKLIK KAYIT CIHAZI) ENTEGRASYONU
--  Kirici Degisiklik Yok: mevcut uygulama aynen calismaya devam eder.
--  Bu dosyayi Supabase SQL Editor'de BIR KEZ calistirin.
--
--  TASARIM - 5 CIHAZ, HER DEPOYA BIR TANE:
--    * 5 ayri cihaz alinacak, her biri bir depoya monte edilecek ve Wi-Fi'ye
--      baglanacak. Yani "bir cihaz + 5 prob" DEGIL, "5 cihaz" modelidir.
--    * Bu yuzden kanal/prob numarasi hicbir yerde kullanilmaz. Her cihaz zaten
--      kendi deposunu olcer; tek yapilan seri no -> depo adi eslestirmesidir.
--    * API adresi + anahtar 5 cihaz icin ORTAKTIR (ayni bulut hesabi).
--    * Kayitlar 3x/gun (sabah/ogle/aksam) otomatik + "Cek" butonu ile anlik.
--    * Cihaz YOKKEN de butun tablolar hazirdir; elle kayit calismaya devam eder.
-- ============================================================================


-- ─── 1) YARDIMCI: GERCEK ADMIN KONTROLU ─────────────────────────────────────
-- Uygulamadaki rol sistemi tarayici tarafinda (sessionStorage) ve taklit
-- edilebilir. Bu yuzden "sadece yonetici" kurali Supabase Auth JWT'si
-- uzerinden gercek olarak dogrulanir: e-posta -> user_roles -> role='admin'.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.auth_user_id
    WHERE lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      AND lower(coalesce(ur.role, '')) = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'JWT e-postasina karsilik gelen kullanicinin user_roles kaydi admin ise true.';


-- ─── 2) HACCP KAYITLARINA CIHAZ ALANLARI ────────────────────────────────────
-- Mevcut kayitlar etkilenmez: yeni sutunlar NULL varsayilanli.
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS cihaz_id   TEXT;
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS kaynak      TEXT DEFAULT 'manuel';
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS limit_durumu TEXT;
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS cihaz_zaman TEXT;

-- Eski elle girilmis kayitlar "manuel" saysin.
UPDATE haccp_records SET kaynak = 'manuel' WHERE kaynak IS NULL;

-- OTOMATIK kayitlarda tekrar calistirmada cogaltmayi engelleyen koruma.
-- Anahtar (cihaz_id, tarih, saat, kaynak): prob_no YOK cunku her cihaz tek
-- depoyu olcer. Manuel kayitlar bu korumaya dahil DEGILDIR.
DROP INDEX IF EXISTS haccp_auto_dedupe_idx;
CREATE UNIQUE INDEX IF NOT EXISTS haccp_auto_dedupe_idx
  ON haccp_records (cihaz_id, tarih, saat, kaynak)
  WHERE cihaz_id IS NOT NULL AND kaynak IN ('sabah', 'ogle', 'aksam');

-- "Cek" butonu ile kaydedilen anlik degerler: saniye cozumurleri icin korunur.
DROP INDEX IF EXISTS haccp_cek_dedupe_idx;
CREATE UNIQUE INDEX IF NOT EXISTS haccp_cek_dedupe_idx
  ON haccp_records (cihaz_id, tarih, saat)
  WHERE cihaz_id IS NOT NULL AND kaynak = 'cek';

-- Sorgu hizlari
CREATE INDEX IF NOT EXISTS haccp_depo_tarih_idx ON haccp_records (depo_ad, tarih DESC);
CREATE INDEX IF NOT EXISTS haccp_cihaz_idx      ON haccp_records (cihaz_id) WHERE cihaz_id IS NOT NULL;


-- ─── 3) CIHAZ AYARLARI (TEK SATIR) ──────────────────────────────────────────
-- Bu tabloda API anahtari saklanir. Satir erisimi yalnizca admin'e aciktir;
-- Edge Function service_role ile okur, tarayiciya anahtar ASLA donmez.
CREATE TABLE IF NOT EXISTS cihaz_ayarlari (
  id                 TEXT PRIMARY KEY DEFAULT 'datalogger',
  aktif              BOOLEAN     NOT NULL DEFAULT false,
  api_url            TEXT        NOT NULL DEFAULT '',
  api_key            TEXT        NOT NULL DEFAULT '',
  api_yontem         TEXT        NOT NULL DEFAULT 'GET',
  -- Gunluk 3 otomatik kayit saati (ayarlar ekranindan degistirilebilir)
  saat_sabah         TEXT        NOT NULL DEFAULT '08:00',
  saat_ogle          TEXT        NOT NULL DEFAULT '12:30',
  saat_aksam         TEXT        NOT NULL DEFAULT '18:00',
  -- Zaman dilimi (sunucu saati degil, kurumun saat dilimi)
  saat_dilimi        TEXT        NOT NULL DEFAULT 'Europe/Istanbul',
  -- Edge Function adresi ve cron guvenlik anahtari (otomatik doldurulur)
  edge_function_url  TEXT        NOT NULL DEFAULT '',
  cron_secret        TEXT        NOT NULL DEFAULT '',
  -- Baglanti testi / son senkron durumu
  son_test_zamani    TEXT,
  son_test_sonuc     TEXT,
  son_sync_zamani    TEXT,
  son_sync_durum     TEXT,
  son_sync_mesaj     TEXT,
  last_modified      TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE cihaz_ayarlari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cihaz_ayarlari_admin_all" ON cihaz_ayarlari;
CREATE POLICY "cihaz_ayarlari_admin_all" ON cihaz_ayarlari FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Anonim erisim kesinlikle yok. Tek satir varsayilan degerle.
INSERT INTO cihaz_ayarlari (id) VALUES ('datalogger')
  ON CONFLICT (id) DO NOTHING;


-- ─── 4) CIHAZ -> DEPO ESLESMESI (5 SATIR) ───────────────────────────────────
-- Her depoya bir cihaz. cihaz_kodu, ureticinin verdigi seri no veya cihazin
-- yerel IP adresi olabilir; API cevabindaki hangi alanla eslendirilecegi
-- cihaz gelince netlestirilecek.
CREATE TABLE IF NOT EXISTS cihaz_ebsleme (
  id            SERIAL PRIMARY KEY,
  cihaz_kodu    TEXT    NOT NULL UNIQUE,
  depo_ad       TEXT    NOT NULL,
  etiket        TEXT    NOT NULL DEFAULT '',
  sira          INTEGER NOT NULL DEFAULT 0,
  aktif         BOOLEAN NOT NULL DEFAULT true,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE cihaz_ebsleme ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cihaz_ebsleme_all" ON cihaz_ebsleme;
CREATE POLICY "cihaz_ebsleme_all" ON cihaz_ebsleme FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE UNIQUE INDEX IF NOT EXISTS cihaz_ebsleme_kod_idx ON cihaz_ebsleme (cihaz_kodu);
CREATE UNIQUE INDEX IF NOT EXISTS cihaz_ebsleme_depo_idx ON cihaz_ebsleme (depo_ad);


-- ─── 5) SENKRON LOGU (denetim izi) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datalogger_log (
  id          BIGSERIAL PRIMARY KEY,
  slot        TEXT,           -- sabah | ogle | aksam | cek | test
  cihaz_id    TEXT,
  basarili    BOOLEAN,
  mesaj       TEXT,
  kayit_adedi INTEGER DEFAULT 0,
  olusturma   TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE datalogger_log ENABLE ROW LEVEL SECURITY;

-- Log yazilir Edge Function (service_role) tarafindan, okunur yalnizca admin.
DROP POLICY IF EXISTS "datalogger_log_all" ON datalogger_log;
DROP POLICY IF EXISTS "datalogger_log_read" ON datalogger_log;
CREATE POLICY "datalogger_log_read" ON datalogger_log FOR SELECT
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS datalogger_log_time_idx ON datalogger_log (olusturma DESC);


-- ─── 6) OTOMATIK KAYIT FONKSIYONU ───────────────────────────────────────────
-- Edge Function bunu cagirir. Ayni cihaz/gun/saat/kaynak icin ikinci kez
-- cagrilirsa hicbir sey eklemez (UNIQUE index zaten engelliyor; burada
-- "zaten var" durumunu netlestirip sayaci dogru donuyoruz).
--
-- Otomatik kayitlar icin ayri kimlik dizisi: ayni milisaniyede gelen iki
-- kayit birbirini ezmez. 1.8e15 < Number.MAX_SAFE_INTEGER, guvenli.
CREATE SEQUENCE IF NOT EXISTS haccp_auto_id_seq START WITH 1800000000000000;

-- Onceki surum 9 parametreliydi; cihaz basina depolar acildigi icin imza
-- degisti. Eskiyi kaldiriyoruz ki iki surum yan yana kalip belirsizlik
-- yaratmasin.
DROP FUNCTION IF EXISTS public.datalogger_kayit_ekle(TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.datalogger_kayit_ekle(
  p_depo_ad      TEXT,
  p_sicaklik     NUMERIC,
  p_nem          NUMERIC,
  p_tarih        TEXT,
  p_saat         TEXT,
  p_cihaz_id     TEXT,
  p_kaynak       TEXT,
  p_limit_durumu TEXT DEFAULT NULL,
  p_cihaz_zaman  TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eklendi INTEGER := 0;
  v_min NUMERIC;
  v_max NUMERIC;
  v_durum TEXT;
  v_id BIGINT;
BEGIN
  IF p_depo_ad IS NULL OR btrim(p_depo_ad) = '' THEN
    RAISE EXCEPTION 'depo_adi_zorunlu';
  END IF;

  -- Depo limitlerinden limit durumunu hesapla (eslesme yoksa NULL).
  SELECT min_limit, max_limit INTO v_min, v_max
    FROM haccp_depo_adlari WHERE ad = p_depo_ad;

  IF v_min IS NOT NULL AND v_max IS NOT NULL AND p_sicaklik IS NOT NULL THEN
    IF p_sicaklik > v_max THEN        v_durum := 'Yuksek';
    ELSIF p_sicaklik < v_min THEN     v_durum := 'Dusuk';
    ELSE                              v_durum := 'Uygun';
    END IF;
  END IF;

  v_durum := coalesce(p_limit_durumu, v_durum);

  BEGIN
    v_id := nextval('public.haccp_auto_id_seq');
    INSERT INTO haccp_records
      (id, type, tarih, saat, depo_ad, sicaklik, nem, not_,
       cihaz_id, kaynak, limit_durumu, cihaz_zaman, last_modified)
    VALUES
      (v_id, 'sicaklik', p_tarih, p_saat, p_depo_ad, p_sicaklik, p_nem, '',
       p_cihaz_id, p_kaynak, v_durum, p_cihaz_zaman,
       to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    v_eklendi := 1;
  EXCEPTION WHEN unique_violation THEN
    v_eklendi := 0;   -- zaten kayitli, sessizce gec
  END;

  RETURN v_eklendi;
END;
$$;

COMMENT ON FUNCTION public.datalogger_kayit_ekle IS
  'Datalogger kaydi ekler; ayni cihaz/tarih/saat/kaynak varsa 0 doner.';


-- ─── 7) ZAMANLANMIS GOREV (pg_cron) ──────────────────────────────────────────
-- Veritabaninin saati, 3 kez "kayit al" diye kendi Edge Function'ini cagirir.
-- Boylece hicbir tarayici/PWA acik olmak zorunda degildir.
--
-- DIKKAT: pg_cron veritabani saat diliminde (Supabase'de UTC) calisir. Kurum
-- saatiyle (Europe/Istanbul) verilen saatler burada UTC'ye cevrilir. Aksi
-- halde 08:00 kaydi 05:00'te yapilirdi.
-- Onceki surum 4 OUT parametre donuyordu (utc_sati yoktu); yeni surum 5
-- donuyor. Postgres CREATE OR REPLACE ile OUT parametrelerini degistiremez
-- ("cannot change return type"), bu yuzden eskisini once dusuruyoruz.
-- Bu fonksiyon Edge Function tarafindan yalnizca rpc ile cagrildigi icin
-- dusurulmesi guvenlidir.
DROP FUNCTION IF EXISTS public.datalogger_zamanlama_ayarla();

CREATE OR REPLACE FUNCTION public.datalogger_zamanlama_ayarla()
RETURNS TABLE (slot TEXT, planlanan_saat TEXT, utc_saat TEXT, cron_ifadesi TEXT, etkin BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_url     TEXT;
  v_secret  TEXT;
  v_aktif   BOOLEAN;
  v_tz      TEXT;
  v_slot    TEXT;
  v_saat    TEXT;
  v_dakika  TEXT;
  v_saat_ut TEXT;
  v_utc     TEXT;
  v_cron    TEXT;
  r RECORD;
BEGIN
  SELECT c.edge_function_url, c.cron_secret, c.aktif, c.saat_dilimi
    INTO v_url, v_secret, v_aktif, v_tz
    FROM public.cihaz_ayarlari c WHERE c.id = 'datalogger';

  -- Once zamanlama yoksa zamanlama yok: pasif durumda eski isler de temizlenir.
  BEGIN
    PERFORM cron.unschedule(jobid) FROM cron.job
      WHERE jobname IN ('datalogger_sabah','datalogger_ogle','datalogger_aksam');
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- cron schema yoksa yoksay
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;   -- bos doner: zamanlama yapilmaz, elle kayit calisir
  END IF;

  -- URL, anahtar veya etkinlik eksikse zamanlama yapma.
  IF v_url IS NULL OR btrim(v_url) = ''
     OR v_secret IS NULL OR btrim(v_secret) = ''
     OR v_aktif IS NOT TRUE THEN
    RETURN;
  END IF;

  v_tz := coalesce(nullif(btrim(v_tz), ''), 'Europe/Istanbul');

  FOR r IN
    SELECT * FROM (VALUES
      ('sabah', (SELECT saat_sabah FROM public.cihaz_ayarlari WHERE id = 'datalogger')),
      ('ogle',  (SELECT saat_ogle  FROM public.cihaz_ayarlari WHERE id = 'datalogger')),
      ('aksam', (SELECT saat_aksam FROM public.cihaz_ayarlari WHERE id = 'datalogger'))
    ) AS t(slot, saat)
  LOOP
    v_slot := r.slot;
    v_saat := r.saat;
    v_utc  := NULL;

    IF v_saat ~ '^[0-2][0-9]:[0-5][0-9]$' THEN
      -- Kurum saatini UTC'ye cevir (Istanbul yaz saati uygulamaz, +3 sabit).
      v_utc := to_char(
        (v_saat::timestamp AT TIME ZONE v_tz) AT TIME ZONE 'UTC',
        'HH24:MI'
      );
      v_dakika  := split_part(v_utc, ':', 2);
      v_saat_ut := split_part(v_utc, ':', 1);
      v_cron    := v_dakika || ' ' || v_saat_ut || ' * * *';
    ELSE
      -- Gecersiz saat: bu slotu atla.
      CONTINUE;
    END IF;

    PERFORM cron.schedule(
      'datalogger_' || v_slot,
      v_cron,
      format($cmd$
        SELECT net.http_post(
          url     := %L,
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'x-cron-secret', %L),
          body    := jsonb_build_object('slot', %L)
        );
      $cmd$, v_url, v_secret, v_slot)
    );

    slot           := v_slot;
    planlanan_saat := v_saat;
    utc_saat       := v_utc;
    cron_ifadesi   := v_cron;
    etkin          := true;
    RETURN NEXT;
  END LOOP;
END;
$f$;

COMMENT ON FUNCTION public.datalogger_zamanlama_ayarla() IS
  'Kurum saatlerini UTC saatine cevirip 3 gunluk is kurar; pasifse isleri kaldirir.';


-- ─── 8) DOGRULAMA ───────────────────────────────────────────────────────────
-- Calistirdiktan sonra su cumleleri calistirarak dogrula:
--
--   -- 1) Ayarlar (3 saat gorunmeli)
--   SELECT aktif, saat_sabah, saat_ogle, saat_aksam, saat_dilimi FROM cihaz_ayarlari;
--
--   -- 2) Yeni sutunlar
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='haccp_records' AND column_name IN
--      ('cihaz_id','kaynak','limit_durumu','cihaz_zaman');
--
--   -- 3) Zamanlama (3 satir; 08:00 Istanbul -> 05:00 UTC gorunmeli)
--   SELECT * FROM datalogger_zamanlama_ayarla();
--
--   -- 4) Cihaz sayaci
--   SELECT count(*) FROM cihaz_ebsleme;
