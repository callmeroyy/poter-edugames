# POTER Edugames Web

Website publik dan dashboard admin untuk distribusi serta telemetri POTER Edugames.

## Menjalankan secara lokal

1. Instal dependency dengan `npm install`.
2. Salin `.env.example` menjadi `.env` lalu ganti kredensial dan kunci rahasianya.
3. Jalankan dengan `npm start`.
4. Buka `http://localhost:3000`.

Tanpa `DATABASE_URL`, aplikasi memakai SQLite lokal. Jika `DATABASE_URL` tersedia,
aplikasi otomatis memakai PostgreSQL Neon.

## Deployment Vercel dan Neon

1. Hubungkan repository ke Vercel.
2. Tambahkan integrasi Neon PostgreSQL dari Vercel Marketplace di region Singapore.
3. Atur `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, dan `COOKIE_SECRET` pada
   environment Production, Preview, serta Development.
4. Untuk migrasi data SQLite lama, jalankan:

   ```powershell
   $env:DATABASE_URL='postgresql://...'
   $env:MIGRATE_CONFIRM='YES'
   npm run migrate:neon
   ```

5. Buat Vercel Blob public store dan unggah APK asli. Masukkan URL Blob melalui form
   Edit Versi pada dashboard admin, lalu aktifkan akses unduhannya.

File APK dan database lokal tidak disimpan di repository. Versi tanpa URL Vercel Blob
akan otomatis memiliki unduhan nonaktif di lingkungan produksi.
