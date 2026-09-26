-- ============================================================================
--  DATALOGGER (SICAKLIK KAYIT CİHAZI) ENTEGRASYONU
--  Kırılıcı Değişiklik Yok: mevcut uygulama aynen çalışmaya devam eder.
--  Bu dosyayı Supabase SQL Editor'de BİR KEZ çalıştırın.
--
--  Tasarım:
--    * Cihaz YOKKEN de tüm tablolar ve ayarlar hazırdır (elle çalışmaya devam).
--    * Cihaz gelince: Yönetim > Cihaz Ayarları ekranından API adresi + anahtar girilir.
--    * API anahtarı SADECE bu tabloda tutulur; tarayıcıya asla dönmez.
--    * Kayıtlar 3x/gün (sabah/öğle/akşam) otomatik + "Çek" butonu ile anlık.
-- ============================================================================


-- ─── 1) YARDIMCI: GERÇEK ADMIN KONTROLÜ ────────────────────────────────────
-- Not: Uygulamadaki rol sistemi tarayıcı tarafındadır (sessionStorage) ve
-- taklit edilebilir. Bu yüzden "sadece yönetici" kuralı Supabase Auth JWT'si
-- üzerinden gerçek olarak doğrulanır: e-posta -> user_roles -> role='admin'.
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
-- Mevcut kayıtlar etkilenmez: yeni sütunlar NULL varsayılanlı.
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS cihaz_id   TEXT;
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS prob_no     INTEGER;
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS kaynak      TEXT DEFAULT 'manuel';
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS limit_durumu TEXT;
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS cihaz_zaman TEXT;

-- Eski elle girilmiş kayıtlar "manuel" sayılsın.
UPDATE haccp_records SET kaynak = 'manuel' WHERE kaynak IS NULL;

-- Otomatik kayıtlar icin tekrar calistirmada cogaltmayi engelleyen koruma.
-- Manuel kayitlar bu korumaya dahil DEGILDIR (kullanici istedigi kadar ekleyebilir).
CREATE UNIQUE INDEX IF NOT EXISTS haccp_auto_dedupe_idx
  ON haccp_records (cihaz_id, prob_no, tarih, saat, kaynak)
  WHERE cihaz_id IS NOT NULL AND kaynak IN ('sabah', 'ogle', 'aksam');

-- "Cek" butonu ile kaydedilen anlik degerler: saniye cozumurleri icin korunur.
CREATE UNIQUE INDEX IF NOT EXISTS haccp_cek_dedupe_idx
  ON haccp_records (cihaz_id, prob_no, tarih, saat)
  WHERE cihaz_id IS NOT NULL AND kaynak = 'cek';

-- Sorgu hizlari
CREATE INDEX IF NOT EXISTS haccp_depo_tarih_idx  ON haccp_records (depo_ad, tarih DESC);
CREATE INDEX IF NOT EXISTS haccp_cihaz_idx        ON haccp_records (cihaz_id) WHERE cihaz_id IS NOT NULL;


-- ─── 3) CIHAZ AYARLARI (TEK SATIR) ───────────────────────────────────────────
-- Bu tabloda API anahtari saklanir. Satir guvenligi yalnizca admin'e aciktir.
CREATE TABLE IF NOT EXISTS cihaz_ayarlari (
  id                 TEXT PRIMARY KEY DEFAULT 'datalogger',
  aktif              BOOLEAN     NOT NULL DEFAULT false,
  cihaz_adi          TEXT        NOT NULL DEFAULT '',
  uretici            TEXT        NOT NULL DEFAULT '',
  api_url            TEXT        NOT NULL DEFAULT '',
  api_key            TEXT        NOT NULL DEFAULT '',
  api_yontem         TEXT        NOT NULL DEFAULT 'GET',
  -- Gunluk 3 otomatik kayit saati (ayarlar ekranindan degistirilebilir)
  saat_sabah         TEXT        NOT NULL DEFAULT '08:00',
  saat_ogle          TEXT        NOT NULL DEFAULT '12:30',
  saat_aksam         TEXT        NOT NULL DEFAULT '18:00',
  -- Zaman dilimi (sunucu saati degil, kurumun saat dilimi)
  saat_dilimi        TEXT        NOT NULL DEFAULT 'Europe/Istanbul',
  -- Edge Function adresi ve cron guvenlik anahtari
  edge_function_url  TEXT        NOT NULL DEFAULT '',
  cron_secret        TEXT        NOT NULL DEFAULT '',
  -- Baglanti testi / son senkron durumu
  son_test_zamani     TEXT,
  son_test_sonuc     TEXT,
  son_sync_zamani     TEXT,
  son_sync_durum      TEXT,
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


-- ─── 4) CIHAZ / PROB / DEPO ESLESMESI ───────────────────────────────────────
-- Cihazdaki kanal numarasi -> uygulamadaki depo adi.
CREATE TABLE IF NOT EXISTS cihaz_prob (
  id            SERIAL PRIMARY KEY,
  cihaz_id      TEXT    NOT NULL DEFAULT 'datalogger',
  prob_no       INTEGER NOT NULL,
  depo_ad       TEXT    NOT NULL,
  etiket        TEXT    NOT NULL DEFAULT '',
  aktif         BOOLEAN NOT NULL DEFAULT true,
  last_modified TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE cihaz_prob ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cihaz_prob_all" ON cihaz_prob;
CREATE POLICY "cihaz_prob_all" ON cihaz_prob FOR ALL
  USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS cihaz_prob_unique_idx
  ON cihaz_prob (cihaz_id, prob_no);


-- ─── 5) SENKRON LOGU (denetim izi) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datalogger_log (
  id         BIGSERIAL PRIMARY KEY,
  slot       TEXT,           -- sabah | ogle | aksam | cek | test
  cihaz_id   TEXT,
  basarili   BOOLEAN,
  mesaj      TEXT,
  kayit_adedi INTEGER DEFAULT 0,
  olusturma  TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE datalogger_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "datalogger_log_all" ON datalogger_log;
CREATE POLICY "datalogger_log_all" ON datalogger_log FOR ALL
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS datalogger_log_time_idx ON datalogger_log (olusturma DESC);


-- ─── 6) OTOMATIK KAYIT: TEKRAR CALISMAYI ONLEYEN FONKSIYON ──────────────────
-- Edge Function bu fonksiyonu cagirir. Ayni gun/saat/prob icin ikinci kez
-- cagrilirsa hicbir sey eklemez (UNIQUE index zaten engelliyor, burada
-- "zaten var" durumunu netlestirip sayaci dogru donuyoruz).

-- Otomatik kayitlar icin ayri bir kimlik dizisi. Boylece ayni milisaniyede
-- gelen iki kayit birbirini ezmez ve PK cakismasi olmaz. Baslangic degeri
-- uygulamanin kullandigi Date.now() degerlerinden guvenli sekilde ayridir
-- (1.8e15 < Number.MAX_SAFE_INTEGER).
CREATE SEQUENCE IF NOT EXISTS haccp_auto_id_seq START WITH 1800000000000000;

CREATE OR REPLACE FUNCTION public.datalogger_kayit_ekle(
  p_depo_ad  TEXT,
  p_sicaklik NUMERIC,
  p_nem      NUMERIC,
  p_tarih    TEXT,
  p_saat     TEXT,
  p_cihaz_id TEXT,
  p_prob_no  INTEGER,
  p_kaynak   TEXT,
  p_limit_durumu TEXT DEFAULT NULL,
  p_cihaz_zaman TEXT DEFAULT NULL
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
       cihaz_id, prob_no, kaynak, limit_durumu, cihaz_zaman, last_modified)
    VALUES
      (v_id, 'sicaklik', p_tarih, p_saat, p_depo_ad, p_sicaklik, p_nem, '',
       p_cihaz_id, p_prob_no, p_kaynak, v_durum, p_cihaz_zaman,
       to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    v_eklendi := 1;
  EXCEPTION WHEN unique_violation THEN
    v_eklendi := 0;   -- zaten kayitli, sessizce gec
  END;

  RETURN v_eklendi;
END;
$$;

COMMENT ON FUNCTION public.datalogger_kayit_ekle IS
  'Datalogger kaydi ekler; ayni cihaz/prob/tarih/saat/kaynak varsa 0 doner.';


-- ─── 7) ZAMANLANMIS KURALLAR (pg_cron) ──────────────────────────────────────
-- Bu blok opsiyoneldir. Supabase Pro planda pg_cron + pg_net aktiftir.
-- Edge Function adresi ve guvenlik anahtari cihaz_ayarlari'ndan okunur;
-- hicbir yerde sabit kod yoktur. Ayarlar ekranındaki "Kaydet" bunu yeniden
-- cagirir, böylece saat değişince zamanlama kendiliğinden güncellenir.
-- pg_cron / pg_net yoksa sessizce boş döner, program elle çalışmaya devam eder.
CREATE OR REPLACE FUNCTION public.datalogger_zamanlama_ayarla()
RETURNS TABLE (slot TEXT, planlanan_saat TEXT, cron_ifadesi TEXT, etkin BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_aktif  BOOLEAN;
  v_dakika TEXT;
  v_saat   TEXT;
  v_slot   TEXT;
  v_cron   TEXT;
  r RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;   -- bos doner: zamanlama yapilmaz
  END IF;

  SELECT c.edge_function_url, c.cron_secret, c.aktif
    INTO v_url, v_secret, v_aktif
    FROM public.cihaz_ayarlari c WHERE c.id = 'datalogger';

  -- URL veya anahtar eksikse zamanlama yapma (elle kayit devrede kalir).
  IF v_url IS NULL OR btrim(v_url) = '' OR v_aktif IS NOT TRUE THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('sabah', (SELECT saat_sabah FROM public.cihaz_ayarlari WHERE id = 'datalogger')),
      ('ogle',  (SELECT saat_ogle  FROM public.cihaz_ayarlari WHERE id = 'datalogger')),
      ('aksam', (SELECT saat_aksam FROM public.cihaz_ayarlari WHERE id = 'datalogger'))
    ) AS t(slot, saat)
  LOOP
    v_slot := r.slot;
    v_saat := r.saat;

    v_dakika := '0';
    IF v_saat ~ '^[0-2][0-9]:[0-5][0-9]$' THEN
      v_dakika := lpad(split_part(v_saat, ':', 2), 2, '0');
    END IF;

    v_cron := v_dakika || ' * * * *';

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

    slot            := v_slot;
    planlanan_saat  := v_saat;
    cron_ifadesi    := v_cron;
    etkin           := true;
    RETURN NEXT;
  END LOOP;
END;
$f$;


-- ─── 8) DURUM KONTROLU ──────────────────────────────────────────────────────
-- Calistirdiktan sonra su cumleyi calistirarak dogrula:
--   SELECT * FROM datalogger_zamanlama_ayarla();
--   SELECT * FROM cihaz_ayarlari;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'haccp_records' ORDER BY ordinal_position;
