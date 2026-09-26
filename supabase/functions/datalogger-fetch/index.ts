// ============================================================================
//  datalogger-fetch  —  Datalogger ile tek seferlik iletisim
//
//  Tarayicidan gelen istekler icin 4 islem:
//    status : Ayarlar okunur, cihaz bagli mi diye bakilir (API cagrilmaz)
//    test   : Ayarlar okunur, API'ye basit bir GET atilir (kayit yazilmaz)
//    fetch  : API'den anlik degerler okunur ve ekrana doner (kayit yazilmaz)
//    save   : Anlik degerler okunur ve haccp_records'a kaydedilir
//
//  Guvenlik:
//    * API anahtari SADECE sunucuda (bu fonksiyonda) okunur, tarayiciya donmez.
//    * Cagiran gercekten admin mi JWT uzerinden dogrulanir.
//    * Cihaz tanimli degilse 200 doner ama configured:false - program cokmez.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const SETTINGS_ID = 'datalogger';

// service_role: RLS'i atlar, anahtari sunucuda okumamizi saglar.
const admin = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

type Ayar = {
  aktif: boolean;
  cihaz_adi: string;
  uretici: string;
  api_url: string;
  api_key: string;
  api_yontem: string;
  saat_sabah: string;
  saat_ogle: string;
  saat_aksam: string;
  saat_dilimi: string;
};

type Okuma = {
  prob_no: number;
  etiket: string;
  depo_ad: string;
  sicaklik: number | null;
  nem: number | null;
  cihaz_zaman: string | null;
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
    // en-CA bazi motorlarda 24:00 doner; 00'a indir.
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

// ─── Cagiran gercekten admin mi? ─────────────────────────────────────────────
// Uygulamadaki rol sessionStorage'da tutuluyor ve taklit edilebilir; bu yuzden
// burada JWT e-postasi -> user_roles -> role kontrolu yapiliyor.
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

async function probEslestirmeleriOku() {
  const { data } = await admin.from('cihaz_prob').select('*').eq('cihaz_id', SETTINGS_ID).eq('aktif', true);
  return data ?? [];
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

  // Anahtari iki farkli baslikta birden gonderiyoruz: ureticilerin cogu ya
  // "Authorization: Bearer" ya da "X-API-Key" bekler. Hangisi dogruysa calisir.
  const basliklar: Record<string, string> = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${ay.api_key}`,
    'X-API-Key': ay.api_key,
    'api-key': ay.api_key
  };

  const yontem = (ay.api_yontem || 'GET').toUpperCase();
  const secenek: RequestInit = { method: yontem, headers: basliklar };
  if (yontem === 'POST') {
    secenek.body = JSON.stringify({ device: ay.cihaz_adi || undefined });
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

// ─── Cihaz yanitini kanallara ayir ──────────────────────────────────────────
// Cihaz secilmedi; ureticilerin formatlari degiskendir. Bilinen kaliplari
// deniyoruz, ise yaramazsa ham yaniti donup sonra buna gore uyarlariz.
function kanallariAyikla(ham: any): any[] {
  if (Array.isArray(ham)) return ham;
  if (!ham || typeof ham !== 'object') return [];

  for (const anahtar of ['data', 'channels', 'readings', 'result', 'results', 'items', 'values']) {
    const v = ham[anahtar];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      // { data: { "1": {...}, "2": {...} } } gibi harita bicimi
      const ic = Object.values(v);
      if (ic.length && ic.every((x) => x && typeof x === 'object')) {
        return Object.entries(v).map(([k, x]: [string, any]) => ({ channel: k, ...x }));
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

function kanallariNormalle(kanallar: any[], eslesmeler: any[]): Okuma[] {
  const depoBul = (no: number) =>
    eslesmeler.find((e) => Number(e.prob_no) === no)?.depo_ad ?? '';

  return kanallar
    .map((k) => {
      if (!k || typeof k !== 'object') return null;

      const no = sayisaAl(k, ['prob_no', 'probNo', 'probe', 'channel', 'channelId', 'channel_id', 'ch', 'id', 'no', 'index']);
      if (no === null) return null;

      return {
        prob_no: Math.trunc(no),
        etiket: String(k.label ?? k.name ?? k.etiket ?? k.title ?? `Kanal ${Math.trunc(no)}`),
        depo_ad: depoBul(Math.trunc(no)),
        sicaklik: sayisaAl(k, ['sicaklik', 'temperature', 'temp', 'temperatureC', 'value', 'val', 't']),
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
    const eslesmeler = await probEslestirmeleriOku();

    const ayarliMi = !!ay && !!ay.aktif && !!(ay.api_url || '').trim() && !!(ay.api_key || '').trim();

    if (aksiyon === 'status') {
      // Yetkisiz cagrilara sadece bayrak doner: API adresi/anahtar/prob bilgisi sizmaz.
      return json({
        ok: true,
        configured: ayarliMi,
        aktif: !!ay?.aktif,
        bugun: gunlSaat(new Date(), ay?.saat_dilimi).tarih
      });
    }

    // ── Ayarlar: maskeli okuma ───────────────────────────────────────────────
    if (aksiyon === 'settings') {
      const ham = await admin.from('cihaz_ayarlari').select('*').eq('id', SETTINGS_ID).maybeSingle();
      const a: any = ham.data ?? {};
      const { data: log } = await admin
        .from('datalogger_log').select('slot, basarili, mesaj, olusturma')
        .order('olusturma', { ascending: false }).limit(15);

      return json({
        ok: true,
        ayarlar: {
          aktif: !!a.aktif,
          cihaz_adi: a.cihaz_adi ?? '',
          uretici: a.uretici ?? '',
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
        prob: eslesmeler.map((e) => ({
          id: e.id, prob_no: e.prob_no, depo_ad: e.depo_ad, etiket: e.etiket, aktif: e.aktif
        })),
        log: log ?? []
      });
    }

    // ── Ayarlar: kaydetme ───────────────────────────────────────────────────
    if (aksiyon === 'settings-save') {
      const s = istek.ayarlar ?? {};
      const yama: Record<string, unknown> = { last_modified: new Date().toISOString() };

      if (s.aktif !== undefined)      yama.aktif = !!s.aktif;
      if (s.cihaz_adi !== undefined) yama.cihaz_adi = String(s.cihaz_adi ?? '').trim();
      if (s.uretici !== undefined)    yama.uretici = String(s.uretici ?? '').trim();
      if (s.api_url !== undefined)    yama.api_url = String(s.api_url ?? '').trim();
      if (s.api_yontem !== undefined) yama.api_yontem = ['GET', 'POST'].includes(s.api_yontem) ? s.api_yontem : 'GET';
      if (s.saat_sabah !== undefined) yama.saat_sabah = saatDogrula(s.saat_sabah, '08:00');
      if (s.saat_ogle !== undefined)  yama.saat_ogle = saatDogrula(s.saat_ogle, '12:30');
      if (s.saat_aksam !== undefined) yama.saat_aksam = saatDogrula(s.saat_aksam, '18:00');
      if (s.saat_dilimi !== undefined) yama.saat_dilimi = String(s.saat_dilimi || 'Europe/Istanbul');
      if (s.edge_function_url !== undefined) yama.edge_function_url = String(s.edge_function_url ?? '').trim();

      // Bos string gonderilirse mevcut anahtari SILMeyelim: kullanici sadece
      // diger alanlari degistirip anahtara dokunmak istemeyebilir.
      if (typeof s.api_key === 'string' && s.api_key.trim() !== '') yama.api_key = s.api_key.trim();
      if (typeof s.cron_secret === 'string' && s.cron_secret.trim() !== '') yama.cron_secret = s.cron_secret.trim();
      if (s.api_key_temizle === true) yama.api_key = '';
      if (s.cron_secret_temizle === true) yama.cron_secret = '';

      const { error } = await admin.from('cihaz_ayarlari').update(yama).eq('id', SETTINGS_ID);
      if (error) return json({ ok: false, error: 'Ayarlar kaydedilemedi: ' + error.message }, 500);

      // Saatler degistigini zamanlamayi da yeniden kur.
      let zamanlama: any = null;
      if (s.saat_sabah !== undefined || s.saat_ogle !== undefined || s.saat_aksam !== undefined || s.aktif !== undefined) {
        const { data } = await admin.rpc('datalogger_zamanlama_ayarla');
        zamanlama = data ?? [];
      }

      await logYaz('test', true, 'Ayarlar guncellendi');
      return json({ ok: true, zamanlama });
    }

    if (!ayarliMi) {
      return json({
        ok: true,
        configured: false,
        mesaj: 'Datalogger henüz bağlı değil. Elle kayıt yapmaya devam edebilirsiniz.'
      });
    }

    if (aksiyon === 'test') {
      try {
        const ham = await cihazApiCagir(ay!);
        const kanallar = kanallariAyikla(ham);
        const okunan = kanallariNormalle(kanallar, eslesmeler);
        await admin.from('cihaz_ayarlari')
          .update({ son_test_zamani: new Date().toISOString(), son_test_sonuc: 'Basarili' })
          .eq('id', SETTINGS_ID);
        await logYaz('test', true, `Kanal okundu: ${okunan.length}`);
        return json({ ok: true, configured: true, basarili: true, kanal_adedi: okunan.length, okunan, ham });
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
      const kanallar = kanallariAyikla(ham);
      let okunan = kanallariNormalle(kanallar, eslesmeler);

      if (okunan.length === 0) {
        await logYaz(aksiyon, false, 'Cihaz yanıtından sıcaklık kanalı okunamadı');
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

      // save: veritabanindaki ekleme fonksiyonuna yaz (tekrar calistirma korumali)
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
          p_cihaz_id: SETTINGS_ID,
          p_prob_no: o.prob_no,
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

// Ay girdisini "SS:DD" olarak dogrular; gecersizse varsayilani kullanir.
function saatDogrula(deger: unknown, varsayilan: string) {
  const v = String(deger ?? '').trim();
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v) ? v : varsayilan;
}
