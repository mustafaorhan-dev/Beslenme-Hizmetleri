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
  version: '1.2.0',
  // LEGACY kullanıcılar - Supabase Auth'a geçildiğinde boşaltılabilir
  users: [
    { username: 'admin', passwordHash: 'e4b4617b9d7c3c1bed904600c772cf9ae83896aaff83a9cf9c04fa46fc11f126', role: 'admin', displayName: 'Admin' },
    { username: 'diyetisyen', passwordHash: '27bb63ed6f711388cd6e7b053728de769515945977022b6414ecc9ca546a0889', role: 'diyetisyen', displayName: 'Diyetisyen' },
    { username: 'depo', passwordHash: 'fddc599a3afe6c68b8098f7ef3db02335f7e398e3c0bd34b663f04f424886aeb', role: 'depo', displayName: 'Depo Sorumlusu' },
    { username: 'ascı', passwordHash: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', role: 'asci', displayName: 'Aşçı' },
    { username: 'gida_muhendisi', passwordHash: '83e19a9ce479dc064bab4bd50134db14918cc967debd3ad223bb8993c523788d', role: 'gida_muhendisi', displayName: 'Gıda Mühendisi' }
  ],
  supabaseUrl: 'https://ydbeltktutcxfeosqmai.supabase.co',
  supabaseAnonKey: 'sb_publishable_tUj9gU4n1VKLgwJZw5FmDQ_9W1E2nmA'
};
