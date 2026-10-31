/*
  ============================================
  GÜVENLİK NOTU - 2026
  ============================================
  Bu dosyadaki users listesi LEGACY (eski) auth içindir.
  Supabase Auth'a geçiş yapıldıysa buradaki kullanıcılar
  sadece yedek giriş yöntemi olarak çalışır.
  
  ÖNERİLEN: Supabase Auth kullanın.
  Kullanıcıları Supabase Dashboard > Authentication > Users
  sayfasından oluşturup rollerini user_roles tablosundan atayın.
  
  Supabase Auth aktifken giriş:
  - email: kullaniciadi@kurumadi.com (veya @beslenme.local)
  - password: (Supabase'de belirlediğiniz şifre)
  ============================================
*/

const APP_CONFIG = {
  // ── SÜRÜM BİLGİSİ — TEK KAYNAK ──
  // Değiştirmeniz veya admin panelinden "Sürümü Yayınla" demeniz yeterli;
  // giriş ekranı, yan menü, kılavuz ve service worker bu değerden güncellenir.
  version: '1.5.29',   // görünen sürüm (v1.5.29)
  build: 227,          // önbellek/güncelleme no (her yayında +1)
  // LEGACY kullanıcılar - Supabase Auth'a geçildiğinde boşaltılabilir
  users: [],
  // Bu e-postalarla giriş yapan kişiler her zaman admin olur.
  // GÜVENLİK: Production'da BOŞ bırakın; admin yetkisi Supabase user_roles/app_users üzerinden verilir.
  bootstrapAdmins: [],
  supabaseUrl: 'https://ydbeltktutcxfeosqmai.supabase.co',
  supabaseAnonKey: 'sb_publishable_tUj9gU4n1VKLgwJZw5FmDQ_9W1E2nmA'
};
