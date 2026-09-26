// ============================================================================
//  datalogger-fetch  —  Datalogger ile tek seferlik iletisim
//
//  MODEL: 5 ayri cihaz, her depoya bir tane. Cihazlar kendi depolarini
//  olcer; bu yuzden "kanal/prob" kavrami YOKTUR. Tek eslestirme cihaz
//  kodunun (seri no veya IP) depo adina baglanmasidir.
//
//  Tarayicidan gelen istekler icin islemler:
//    status       : Ayarlar okunur, cihaz bagli mi diye bakilir (API cagrilmaz)
//    test         : API'ye bir istek atilir, cihazlar okunur (kayit yazilmaz)
//    fetch        : Anlik degerler okunur ve ekrana doner (kayit yazilmaz)
//    save         : Anlik degerler okunur ve haccp_records'a kaydedilir
//    settings     : Maskeli ayar + cihaz listesi okunur
//    settings-save: Ayarlar + cihaz listesi yazilir, zamanlama yeniden kurulur
//
//  Guvenlik:
//    * API anahtari SADECE sunucuda okunur, tarayiciya donmez.
//    * Cagiran gercekten admin mi JWT uzerinden dogrulanir.
//    * Cron guvenlik anahtari ve Edge adresi sunucuda OTOMATIK uretilir;
//      kullanici girmez.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const SETTINGS_ID = 'datalogger';

const admin = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

type Ayar = {
  aktif: boolean;
  api_url: string;
  api_key: string;
  api_yontem: string;
  saat_sabah: string;
  saat_ogle: string;
  saat_aksam: string;
  saat_dilimi: string;
  edge_function_url: string;
  cron_secret: string;
};

type Okuma = {
  cihaz_kodu: string;
  etiket: string;
  depo_ad: string;
  sicaklik: number | null;
  nem: number | null;
  cihaz_zaman: string | null;
};

type Ebsleme = {
  id: number;
  cihaz_kodu: string;
  depo_ad: string;
  etiket: string;
  sira: number;
  aktif: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
    }
  });

function gunlSaat(bayi: Date, dilim: string) {
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: dilim || 'Europe/Istanbul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(bayi);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
    const sa = g('hour') === '24' ? '00' : g('hour');
    return { tarih: `${g('year')}-${g('month')}-${g('day')}`, saat: `${sa}:${g('minute')}:${g('second')}` };
  } catch {
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      tarih: `${bayi.getFullYear()}-${p(bayi.getMonth() + 1)}-${p(bayi.getDate())}`,
      saat: `${p(bayi.getHours())}:${p(bayi.getMinutes())}:${p(bayi.getSeconds())}`
    };
  }
}

async function cagiriciAdminMi(req: Request): Promise<boolean> {
  const baslik = req.headers.get('Authorization') ?? '';
  const token = baslik.startsWith('Bearer ') ? baslik.slice(7) : baslik;
  if (!token) return false;

  const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.getUser(token);
  if (error || !data?.user?.email) return false;

  const { data: rol } = await admin
    .from('user_roles')
    .select('role')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();

  return String(rol?.role ?? '').toLowerCase() === 'admin';
}

async function ayarlariOku(): Promise<Ayar | null> {
  const { data } = await admin.from('cihaz_ayarlari').select('*').eq('id', SETTINGS_ID).maybeSingle();
  return (data as Ayar) ?? null;
}

async function ebslemeleriOku(): Promise<Ebsleme[]> {
  const { data } = await admin.from('cihaz_ebsleme').select('*').eq('aktif', true);
  return (data as Ebsleme[]) ?? [];
}

async function logYaz(slot: string, basarili: boolean, mesaj: string, adet = 0) {
  await admin.from('datalogger_log').insert({
    slot, cihaz_id: SETTINGS_ID, basarili, mesaj: String(mesaj).slice(0, 500), kayit_adedi: adet
  });
}

// ─── Cihaz API'sini cagir ────────────────────────────────────────────────────
async function cihazApiCagir(ay: Ayar) {
  const url = (ay.api_url || '').trim();
  if (!url) throw new Error('API adresi boş');

  const basliklar: Record<string, string> = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${ay.api_key}`,
    'X-API-Key': ay.api_key,
    'api-key': ay.api_key
  };

  const yontem = (ay.api_yontem || 'GET').toUpperCase();
  const secenek: RequestInit = { method: yontem, headers: basliklar };
  if (yontem === 'POST') {
    secenek.body = JSON.stringify({});
    basliklar['Content-Type'] = 'application/json';
  }

  const cevap = await fetch(url, secenek);
  const govde = await cevap.text();
  if (!cevap.ok) throw new Error(`Cihaz ${cevap.status} döndü: ${govde.slice(0, 200)}`);

  try {
    return JSON.parse(govde);
  } catch {
    throw new Error('Cihaz yanıtı JSON değil (ilk 200 karakter): ' + govde.slice(0, 200));
  }
}

// ─── Cihaz yanitini cihaz listesine ayir ─────────────────────────────────────
// Cihaz secilmedi; ureticilerin formatlari degiskendir. Bilinen kaliplari
// deniyoruz, ise yaramazsa ham yaniti donup sonra buna gore uyarlariz.
function cihazlariAyikla(ham: any): any[] {
  if (Array.isArray(ham)) return ham;
  if (!ham || typeof ham !== 'object') return [];

  for (const anahtar of ['data', 'devices', 'device', 'readings', 'result', 'results', 'items', 'values', 'sensors']) {
    const v = ham[anahtar];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      // { data: { "SN-001": {...} } } gibi harita bicimi
      const ic = Object.values(v);
      if (ic.length && ic.every((x) => x && typeof x === 'object')) {
        return Object.entries(v).map(([k, x]: [string, any]) => ({ deviceId: k, ...x }));
      }
    }
  }
  return [ham];
}

function sayiyaAl(nesne: any, anahtarlar: string[]): number | null {
  for (const a of anahtarlar) {
    const v = nesne?.[a];
    if (v === null || v === undefined || v === '') continue;
    const n = parseFloat(String(v).replace(',', '.'));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

// Cihaz kodunu metin olarak al. Sayi olan kodlar da metne cevrilir ki
// eslestirme her zaman string karsilastirmasiyla yapilsin.
function kodAl(nesne: any, anahtarlar: string[]): string {
  for (const a of anahtarlar) {
    const v = nesne?.[a];
    if (v === null || v === undefined || v === '') continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return '';
}

function normKod(s: string): string {
  return String(s ?? '').trim().toLowerCase();
}

function cihazlariNormalle(cihazlar: any[], eslesmeler: Ebsleme[]): Okuma[] {
  // eslesmeleri kucuk harfli kodla indeksle; birden fazla eslesme varsa
  // siraya gore ilkini sec.
  const harita = new Map<string, Ebsleme>();
  for (const e of eslesmeler) {
    const k = normKod(e.cihaz_kodu);
    if (k !== '' && !harita.has(k)) harita.set(k, e);
  }

  return cihazlar
    .map((k) => {
      if (!k || typeof k !== 'object') return null;

      const kod = kodAl(k, [
        'deviceId', 'device_id', 'deviceSerial', 'device_serial', 'serial', 'serialNumber',
        'serial_number', 'sn', 'mac', 'macAddress', 'imei', 'hwId', 'gatewayId', 'ip', 'host',
        'id', 'key', 'name'
      ]);
      if (kod === '') return null;

      const eslesme = harita.get(normKod(kod));

      return {
        cihaz_kodu: kod,
        etiket: String(k.label ?? k.name ?? k.etiket ?? k.title ?? eslesme?.etiket ?? kod),
        depo_ad: eslesme?.depo_ad ?? '',
        sicaklik: sayisaAl(k, ['sicaklik', 'temperature', 'temp', 'temperatureC', 'tempC', 'value', 'val', 't']),
        nem: sayisaAl(k, ['nem', 'humidity', 'rh', 'hum', 'humidityPct']),
        cihaz_zaman: k.timestamp ?? k.time ?? k.datetime ?? k.measuredAt ?? k.measured_at ?? null
      } as Okuma;
    })
    .filter((x): x is Okuma => !!x && x.sicaklik !== null);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });

  let istek: any = {};
  try {
    istek = await req.json();
  } catch {
    istek = {};
  }
  const aksiyon = String(istek.action ?? 'status');

  if (aksiyon !== 'status') {
    if (!(await cagiriciAdminMi(req))) {
      return json({ ok: false, error: 'Bu işlem için yönetici yetkisi gerekiyor.' }, 403);
    }
  }

  try {
    const ay = await ayarlariOku();
    const eslesmeler = await ebslemeleriOku();

    const ayarliMi = !!ay && !!ay.aktif && !!(ay.api_url || '').trim() && !!(ay.api_key || '').trim();
    const tanimliCihaz = eslesmeler.filter((e) => normKod(e.cihaz_kodu) !== '').length;

    if (aksiyon === 'status') {
      // Yetkisiz cagrilara sadece bayrak doner: API adresi/anahtar sizmaz.
      return json({
        ok: true,
        configured: ayarliMi,
        aktif: !!ay?.aktif,
        cihaz_adedi: tanimliCihaz,
        bugun: gunlSaat(new Date(), ay?.saat_dilimi).tarih,
        saat_sabah: ay?.saat_sabah ?? '08:00',
        saat_ogle: ay?.saat_ogle ?? '12:30',
        saat_aksam: ay?.saat_aksam ?? '18:00'
      });
    }

    // ── Ayarlar: maskeli okuma ───────────────────────────────────────────────
    if (aksiyon === 'settings') {
      const ham = await admin.from('cihaz_ayarlari').select('*').eq('id', SETTINGS_ID).maybeSingle();
      const a: any = ham.data ?? {};
      const { data: log } = await admin
        .from('datalogger_log').select('slot, basarili, mesaj, olusturma')
        .order('olusturma', { ascending: false }).limit(15);

      const tumEbs = await admin
        .from('cihaz_ebsleme').select('*').order('sira', { ascending: true });

      return json({
        ok: true,
        ayarlar: {
          aktif: !!a.aktif,
          api_url: a.api_url ?? '',
          api_yontem: a.api_yontem ?? 'GET',
          // Anahtar HICBIR ZAMAN gonderilmez; yalnizca doluluk bilgisi doner.
          api_key_dolu: !!(a.api_key || '').trim(),
          saat_sabah: a.saat_sabah ?? '08:00',
          saat_ogle: a.saat_ogle ?? '12:30',
          saat_aksam: a.saat_aksam ?? '18:00',
          saat_dilimi: a.saat_dilimi ?? 'Europe/Istanbul',
          edge_function_url: a.edge_function_url ?? '',
          cron_secret_dolu: !!(a.cron_secret || '').trim(),
          son_test_zamani: a.son_test_zamani ?? null,
          son_test_sonuc: a.son_test_sonuc ?? null,
          son_sync_zamani: a.son_sync_zamani ?? null,
          son_sync_durum: a.son_sync_durum ?? null
        },
        cihazlar: tumEbs.data ?? [],
        log: log ?? []
      });
    }

    // ── Ayarlar: kaydetme ───────────────────────────────────────────────────
    if (aksiyon === 'settings-save') {
      const s = istek.ayarlar ?? {};
      const yama: Record<string, unknown> = { last_modified: new Date().toISOString() };

      if (s.aktif !== undefined)      yama.aktif = !!s.aktif;
      if (s.api_url !== undefined)    yama.api_url = String(s.api_url ?? '').trim();
      if (s.api_yontem !== undefined) yama.api_yontem = ['GET', 'POST'].includes(s.api_yontem) ? s.api_yontem : 'GET';
      if (s.saat_sabah !== undefined) yama.saat_sabah = saatDogrula(s.saat_sabah, '08:00');
      if (s.saat_ogle !== undefined)  yama.saat_ogle = saatDogrula(s.saat_ogle, '12:30');
      if (s.saat_aksam !== undefined) yama.saat_aksam = saatDogrula(s.saat_aksam, '18:00');
      if (s.saat_dilimi !== undefined) yama.saat_dilimi = String(s.saat_dilimi || 'Europe/Istanbul');

      // Bos string gonderilirse mevcut anahtari SILMeyelim.
      if (typeof s.api_key === 'string' && s.api_key.trim() !== '') yama.api_key = s.api_key.trim();
      if (s.api_key_temizle === true) yama.api_key = '';

      // ── Cron guvenlik anahtari ve Edge adresi: sunucuda uretilir ────────────
      // Kullanici bunlari gormez/girmez. Supabase zaten kendi proje
      // adresimizi bize verir; cron fonksiyonunun adresi oradan turetilir.
      if (!(ay?.cron_secret || '').trim()) {
        yama.cron_secret = rastgeleAnahtar();
      }
      if (!(ay?.edge_function_url || '').trim() && SB_URL) {
        yama.edge_function_url = `${SB_URL.replace(/\/+$/, '')}/functions/v1/datalogger-cron`;
      }

      // ── Cihaz listesi ─────────────────────────────────────────────────────
      // Gelen liste DEDUPE edilerek yazilir. Bos kodlu satirlar atlanir.
      const gelen: any[] = Array.isArray(istek.cihazlar) ? istek.cihazlar : [];
      const temiz: Ebsleme[] = [];
      const gorulenKod = new Set<string>();
      const gorulenDepo = new Set<string>();
      for (const c of gelen) {
        const kod = String(c?.cihaz_kodu ?? '').trim();
        const depo = String(c?.depo_ad ?? '').trim();
        if (kod === '' || depo === '') continue;
        const nk = normKod(kod);
        const nd = normKod(depo);
        if (gorulenKod.has(nk) || gorulenDepo.has(nd)) continue;   // UNIQUE ihlali
        gorulenKod.add(nk);
        gorulenDepo.add(nd);
        temiz.push({
          cihaz_kodu: kod,
          depo_ad: depo,
          etiket: String(c?.etiket ?? '').trim(),
          sira: temiz.length + 1,
          aktif: c?.aktif !== false
        });
      }

      const { error } = await admin.from('cihaz_ayarlari').update(yama).eq('id', SETTINGS_ID);
      if (error) return json({ ok: false, error: 'Ayarlar kaydedilemedi: ' + error.message }, 500);

      // Cihaz listesini tamamen degistir (sil + yeniden yaz).
      // Transaction yoksa iki islemi sirayla yap; arada hata olursa
      // eski liste korunmaya devam eder.
      await admin.from('cihaz_ebsleme').delete().neq('id', 0);
      if (temiz.length) {
        const { error: e2 } = await admin.from('cihaz_ebsleme').insert(temiz);
        if (e2) return json({ ok: false, error: 'Cihaz listesi kaydedilemedi: ' + e2.message }, 500);
      }

      // Saatler/aktiflik degistigini zamanlamayi da yeniden kur.
      let zamanlama: any = null;
      try {
        const { data } = await admin.rpc('datalogger_zamanlama_ayarla');
        zamanlama = data ?? [];
      } catch (rpcHata: any) {
        zamanlama = [];
        await logYaz('test', false, 'Zamanlama kurulamadı: ' + (rpcHata?.message ?? ''));
      }

      await logYaz('test', true, `Ayarlar guncellendi, ${temiz.length} cihaz`);
      return json({ ok: true, zamanlama, cihaz_adedi: temiz.length });
    }

    if (!ayarliMi) {
      return json({
        ok: true,
        configured: false,
        cihaz_adedi: tanimliCihaz,
        mesaj: 'Datalogger henüz bağlı değil. Elle kayıt yapmaya devam edebilirsiniz.'
      });
    }

    if (aksiyon === 'test') {
      try {
        const ham = await cihazApiCagir(ay!);
        const cihazlar = cihazlariAyikla(ham);
        const okunan = cihazlariNormalle(cihazlar, eslesmeler);
        await admin.from('cihaz_ayarlari')
          .update({ son_test_zamani: new Date().toISOString(), son_test_sonuc: 'Basarili' })
          .eq('id', SETTINGS_ID);
        await logYaz('test', true, `Cihaz okundu: ${okunan.length}`);
        return json({ ok: true, configured: true, basarili: true, cihaz_adedi: okunan.length, okunan, ham });
      } catch (hata: any) {
        const mesaj = hata?.message ?? String(hata);
        await admin.from('cihaz_ayarlari')
          .update({ son_test_zamani: new Date().toISOString(), son_test_sonuc: 'Hata: ' + mesaj })
          .eq('id', SETTINGS_ID);
        await logYaz('test', false, mesaj);
        return json({ ok: true, configured: true, basarili: false, hata: mesaj });
      }
    }

    if (aksiyon === 'fetch' || aksiyon === 'save') {
      const ham = await cihazApiCagir(ay!);
      const cihazlar = cihazlariAyikla(ham);
      const okunan = cihazlariNormalle(cihazlar, eslesmeler);

      if (okunan.length === 0) {
        await logYaz(aksiyon, false, 'Cihaz yanıtından sıcaklık okunamadı');
        return json({
          ok: false,
          configured: true,
          hata: 'Cihaz yanıtından sıcaklık okunamadı. Cihaz API biçimi farklı olabilir.',
          ham
        });
      }

      const zaman = gunlSaat(new Date(), ay!.saat_dilimi);

      if (aksiyon === 'fetch') {
        return json({ ok: true, configured: true, okunan, tarih: zaman.tarih, saat: zaman.saat, ham });
      }

      // save: ekleme fonksiyonuna yaz (tekrar calistirma korumali)
      const kaydedilen: any[] = [];
      const atlanan: any[] = [];
      for (const o of okunan) {
        if (!o.depo_ad) { atlanan.push({ ...o, neden: 'Depo eşleştirilmemiş' }); continue; }
        const { data: eklendi, error } = await admin.rpc('datalogger_kayit_ekle', {
          p_depo_ad: o.depo_ad,
          p_sicaklik: o.sicaklik,
          p_nem: o.nem,
          p_tarih: zaman.tarih,
          p_saat: zaman.saat,
          p_cihaz_id: o.cihaz_kodu,
          p_kaynak: 'cek',
          p_cihaz_zaman: o.cihaz_zaman ? String(o.cihaz_zaman) : null
        });
        if (error) { atlanan.push({ ...o, neden: error.message }); continue; }
        (Number(eklendi) > 0 ? kaydedilen : atlanan).push(
          Number(eklendi) > 0 ? o : { ...o, neden: 'Bu zaman için zaten kayıtlı' }
        );
      }

      await admin.from('cihaz_ayarlari')
        .update({ son_sync_zamani: new Date().toISOString(), son_sync_durum: 'Basarili' })
        .eq('id', SETTINGS_ID);
      await logYaz('cek', atlanan.length === 0, `Kaydedilen ${kaydedilen.length}, atlanan ${atlanan.length}`);

      return json({
        ok: true, configured: true, kaydedilen, atlanan,
        tarih: zaman.tarih, saat: zaman.saat
      });
    }

    return json({ ok: false, error: 'Bilinmeyen işlem: ' + aksiyon }, 400);
  } catch (hata: any) {
    const mesaj = hata?.message ?? String(hata);
    await logYaz(aksiyon, false, mesaj);
    return json({ ok: false, error: mesaj }, 500);
  }
});

function saatDogrula(deger: unknown, varsayilan: string) {
  const v = String(deger ?? '').trim();
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v) ? v : varsayilan;
}

// Cron guvenlik anahtari: 32 rastgele hex karakter. Kullanicinin bilmesine
// gerek yok; yalnizca veritabani ile bu Edge Function arasinda tutarli olur.
function rastgeleAnahtar(): string {
  const bayt = new Uint8Array(16);
  crypto.getRandomValues(bayt);
  return Array.from(bayt).map((b) => b.toString(16).padStart(2, '0')).join('');
}
