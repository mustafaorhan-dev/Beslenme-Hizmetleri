// ============================================================================
//  datalogger-cron  —  Gunde 3 kez (sabah / ogle / aksam) otomatik kayit
//
//  pg_cron bu fonksiyonu cagirir; header'da x-cron-secret gelir.
//  Kayit, veritabanindaki datalogger_kayit_ekle() fonksiyonu ile yapilir;
//  boylece ayni slot iki kez calissa bile cift kayit olusmaz.
//
//  Cihaz tanimli degilse sessizce 200 doner: program elle calismaya devam eder.
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
    secenek.body = JSON.stringify({ device: ay.cihaz_adi || undefined });
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

function kanallariAyikla(ham: any): any[] {
  if (Array.isArray(ham)) return ham;
  if (!ham || typeof ham !== 'object') return [];
  for (const k of ['data', 'channels', 'readings', 'result', 'results', 'items', 'values']) {
    const v = ham[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const ic = Object.values(v);
      if (ic.length && ic.every((x) => x && typeof x === 'object')) {
        return Object.entries(v).map(([no, x]: [string, any]) => ({ channel: no, ...x }));
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
      .from('cihaz_prob').select('*').eq('cihaz_id', SETTINGS_ID).eq('aktif', true);

    const ham = await cihazApiCagir(ay);
    const kanallar = kanallariAyikla(ham);

    const okunan = kanallar
      .map((k) => {
        if (!k || typeof k !== 'object') return null;
        const no = sayisaAl(k, ['prob_no', 'probNo', 'probe', 'channel', 'channelId', 'channel_id', 'ch', 'id', 'no', 'index']);
        if (no === null) return null;
        const n = Math.trunc(no);
        const depo = (eslesmeler ?? []).find((e: any) => Number(e.prob_no) === n)?.depo_ad ?? '';
        return {
          prob_no: n,
          depo_ad: depo,
          sicaklik: sayisaAl(k, ['sicaklik', 'temperature', 'temp', 'temperatureC', 'value', 'val', 't']),
          nem: sayisaAl(k, ['nem', 'humidity', 'rh', 'hum', 'humidityPct'])
        };
      })
      .filter((x) => x && x.sicaklik !== null);

    if (okunan.length === 0) {
      await admin.from('datalogger_log').insert({
        slot, cihaz_id: SETTINGS_ID, basarili: false, mesaj: 'Cihaz yanıtından kanal okunamadı'
      });
      await admin.from('cihaz_ayarlari')
        .update({ son_sync_zamani: new Date().toISOString(), son_sync_durum: 'Hata: kanal okunamadi' })
        .eq('id', SETTINGS_ID);
      return json({ ok: false, error: 'kanal_okunamadi' });
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
      if (!o.depo_ad) { atlanan.push({ prob_no: o.prob_no, neden: 'depo eslestirilmemis' }); continue; }
      const { data: n, error } = await admin.rpc('datalogger_kayit_ekle', {
        p_depo_ad: o.depo_ad,
        p_sicaklik: o.sicaklik,
        p_nem: o.nem,
        p_tarih: tarih,
        p_saat: saat,
        p_cihaz_id: SETTINGS_ID,
        p_prob_no: o.prob_no,
        p_kaynak: slot
      });
      if (error) { atlanan.push({ prob_no: o.prob_no, neden: error.message }); continue; }
      if (Number(n) > 0) eklendi++; else atlanan.push({ prob_no: o.prob_no, neden: 'zaten kayitli' });
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
