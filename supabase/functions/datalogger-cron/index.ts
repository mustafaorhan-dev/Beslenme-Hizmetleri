// ============================================================================
//  datalogger-cron  —  Gunde 3 kez (sabah / ogle / aksam) otomatik kayit
//
//  pg_cron bu fonksiyonu cagirir; header'da x-cron-secret gelir.
//  Kayit, veritabanindaki datalogger_kayit_ekle() fonksiyonu ile yapilir;
//  boylece ayni slot iki kez calissa bile cift kayit olusmaz.
//
//  MODEL: 5 cihaz, her depoya bir tane. API'ye TEK istek atilir, gelen
//  cihazlar seri numarasindan eslestirilip ilgili depolara yazilir.
//
//  Cihaz tanimli degilse sessizce 200 doner: program elle calismaya devam eder.
//
//  DEPLOY NOTU: Bu fonksiyon yalnizca veritabanindan gelen isteklere yanit
//  vermelidir. Authorization basligi gonderilmez, bu yuzden gateway JWT
//  dogrulamasi KAPALI olmalidir:
//      supabase functions deploy datalogger-cron --no-verify-jwt
//  Guvenlik, asagida dogrulanan x-cron-secret ile saglanir.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SETTINGS_ID = 'datalogger';
const SLOTLAR = ['sabah', 'ogle', 'aksam'] as const;
type Slot = typeof SLOTLAR[number];

const admin = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

function gunlSaat(bayi: Date, dilim: string) {
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: dilim || 'Europe/Istanbul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(bayi);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
    const sa = g('hour') === '24' ? '00' : g('hour');
    return { tarih: `${g('year')}-${g('month')}-${g('day')}`, saat: `${sa}:${g('minute')}` };
  } catch {
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      tarih: `${bayi.getFullYear()}-${p(bayi.getMonth() + 1)}-${p(bayi.getDate())}`,
      saat: `${p(bayi.getHours())}:${p(bayi.getMinutes())}`
    };
  }
}

async function cihazApiCagir(ay: any) {
  const basliklar: Record<string, string> = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${ay.api_key}`,
    'X-API-Key': ay.api_key,
    'api-key': ay.api_key
  };
  const yontem = (ay.api_yontem || 'GET').toUpperCase();
  const secenek: RequestInit = { method: yontem, headers: basliklar };
  if (yontem === 'POST') {
    basliklar['Content-Type'] = 'application/json';
    secenek.body = JSON.stringify({});
  }

  const cevap = await fetch(ay.api_url.trim(), secenek);
  const govde = await cevap.text();
  if (!cevap.ok) throw new Error(`Cihaz ${cevap.status} döndü: ${govde.slice(0, 200)}`);
  try {
    return JSON.parse(govde);
  } catch {
    throw new Error('Cihaz yanıtı JSON değil: ' + govde.slice(0, 200));
  }
}

function cihazlariAyikla(ham: any): any[] {
  if (Array.isArray(ham)) return ham;
  if (!ham || typeof ham !== 'object') return [];
  for (const k of ['data', 'devices', 'device', 'readings', 'result', 'results', 'items', 'values', 'sensors']) {
    const v = ham[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const ic = Object.values(v);
      if (ic.length && ic.every((x) => x && typeof x === 'object')) {
        return Object.entries(v).map(([kod, x]: [string, any]) => ({ deviceId: kod, ...x }));
      }
    }
  }
  return [ham];
}

function sayiyaAl(n: any, anahtarlar: string[]): number | null {
  for (const a of anahtarlar) {
    const v = n?.[a];
    if (v === null || v === undefined || v === '') continue;
    const x = parseFloat(String(v).replace(',', '.'));
    if (!Number.isNaN(x)) return x;
  }
  return null;
}

function kodAl(n: any, anahtarlar: string[]): string {
  for (const a of anahtarlar) {
    const v = n?.[a];
    if (v === null || v === undefined || v === '') continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return '';
}

const normKod = (s: string) => String(s ?? '').trim().toLowerCase();

const KOD_ANAHTARLARI = [
  'deviceId', 'device_id', 'deviceSerial', 'device_serial', 'serial', 'serialNumber',
  'serial_number', 'sn', 'mac', 'macAddress', 'imei', 'hwId', 'gatewayId', 'ip', 'host',
  'id', 'key', 'name'
];

Deno.serve(async (req: Request) => {
  let istek: any = {};
  try {
    istek = await req.json();
  } catch {
    istek = {};
  }
  const slot = String(istek.slot ?? '') as Slot;

  try {
    const { data: ay } = await admin
      .from('cihaz_ayarlari').select('*').eq('id', SETTINGS_ID).maybeSingle();

    // Cihaz henuz bagli degilse: sessizce gec, elle kayit devam eder.
    if (!ay || !ay.aktif || !String(ay.api_url || '').trim() || !String(ay.api_key || '').trim()) {
      return json({ ok: true, atlandi: true, neden: 'cihaz_bagli_degil' });
    }

    // Cron anahtari dogrulanir (ayar yoksa veya yanlissa reddet).
    const beklenen = String(ay.cron_secret || '').trim();
    const gelen = String(req.headers.get('x-cron-secret') ?? '').trim();
    if (!beklenen || gelen !== beklenen) {
      await admin.from('datalogger_log').insert({
        slot, cihaz_id: SETTINGS_ID, basarili: false, mesaj: 'Yetkisiz cron istegi reddedildi'
      });
      return json({ ok: false, error: 'yetkisiz' }, 401);
    }

    if (!SLOTLAR.includes(slot)) {
      return json({ ok: false, error: 'gecersiz_slot' }, 400);
    }

    const { data: eslesmeler } = await admin
      .from('cihaz_ebsleme').select('*').eq('aktif', true);

    // Kod -> depo haritasi (kucuk harfli, tekillestirilmis).
    const harita = new Map<string, any>();
    for (const e of (eslesmeler ?? []) as any[]) {
      const k = normKod(e.cihaz_kodu);
      if (k !== '' && !harita.has(k)) harita.set(k, e);
    }

    // Hicbir cihaz tanimli degilse gereksiz API cagrisi yapma.
    if (harita.size === 0) {
      return json({ ok: true, atlandi: true, neden: 'cihaz_tanimli_degil' });
    }

    const ham = await cihazApiCagir(ay);
    const cihazlar = cihazlariAyikla(ham);

    const okunan = cihazlar
      .map((k) => {
        if (!k || typeof k !== 'object') return null;
        const kod = kodAl(k, KOD_ANAHTARLARI);
        if (kod === '') return null;
        const sicaklik = sayiyaAl(k, ['sicaklik', 'temperature', 'temp', 'temperatureC', 'tempC', 'value', 'val', 't']);
        if (sicaklik === null) return null;
        return {
          cihaz_kodu: kod,
          depo_ad: harita.get(normKod(kod))?.depo_ad ?? '',
          sicaklik,
          nem: sayiyaAl(k, ['nem', 'humidity', 'rh', 'hum', 'humidityPct']),
          cihaz_zaman: k.timestamp ?? k.time ?? k.datetime ?? k.measuredAt ?? k.measured_at ?? null
        };
      })
      .filter((x) => x && x.sicaklik !== null);

    if (okunan.length === 0) {
      await admin.from('datalogger_log').insert({
        slot, cihaz_id: SETTINGS_ID, basarili: false, mesaj: 'Cihaz yanıtından sıcaklık okunamadı'
      });
      await admin.from('cihaz_ayarlari')
        .update({ son_sync_zamani: new Date().toISOString(), son_sync_durum: 'Hata: sıcaklık okunamadi' })
        .eq('id', SETTINGS_ID);
      return json({ ok: false, error: 'sicaklik_okunamadi' });
    }

    // Otomatik kaydin saati: yapilandirilmis slot saati + ":00".
    // Sabit kullanmak, tekrar calistirmada cift kaydi engelliyor.
    const slotSaati: Record<Slot, string> = {
      sabah: String(ay.saat_sabah || '08:00'),
      ogle: String(ay.saat_ogle || '12:30'),
      aksam: String(ay.saat_aksam || '18:00')
    };
    const { tarih } = gunlSaat(new Date(), ay.saat_dilimi);
    const saat = slotSaati[slot] + ':00';

    let eklendi = 0;
    const atlanan: any[] = [];
    for (const o of okunan) {
      if (!o.depo_ad) { atlanan.push({ cihaz_kodu: o.cihaz_kodu, neden: 'depo eslestirilmemis' }); continue; }
      const { data: n, error } = await admin.rpc('datalogger_kayit_ekle', {
        p_depo_ad: o.depo_ad,
        p_sicaklik: o.sicaklik,
        p_nem: o.nem,
        p_tarih: tarih,
        p_saat: saat,
        p_cihaz_id: o.cihaz_kodu,
        p_kaynak: slot,
        p_cihaz_zaman: o.cihaz_zaman ? String(o.cihaz_zaman) : null
      });
      if (error) { atlanan.push({ cihaz_kodu: o.cihaz_kodu, neden: error.message }); continue; }
      if (Number(n) > 0) eklendi++; else atlanan.push({ cihaz_kodu: o.cihaz_kodu, neden: 'zaten kayitli' });
    }

    const basarili = atlanan.length === 0;
    const mesaj = `${slot}: ${eklendi} kayit eklendi` + (atlanan.length ? `, ${atlanan.length} atlandi` : '');

    await admin.from('datalogger_log').insert({
      slot, cihaz_id: SETTINGS_ID, basarili, mesaj, kayit_adedi: eklendi
    });
    await admin.from('cihaz_ayarlari')
      .update({ son_sync_zamani: new Date().toISOString(), son_sync_durum: mesaj, son_sync_mesaj: JSON.stringify(atlanan).slice(0, 500) })
      .eq('id', SETTINGS_ID);

    return json({ ok: true, slot, tarih, saat, eklendi, atlanan });
  } catch (hata: any) {
    const mesaj = hata?.message ?? String(hata);
    await admin.from('datalogger_log').insert({
      slot: slot || '?', cihaz_id: SETTINGS_ID, basarili: false, mesaj
    }).catch(() => {});
    await admin.from('cihaz_ayarlari')
      .update({ son_sync_zamani: new Date().toISOString(), son_sync_durum: 'Hata: ' + mesaj })
      .eq('id', SETTINGS_ID).catch(() => {});
    return json({ ok: false, error: mesaj }, 200);   // cron'un hata mesigini bogmasin diye 200
  }
});
