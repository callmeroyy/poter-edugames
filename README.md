# POTER Edugames Web

Website publik dan dashboard admin untuk distribusi serta telemetri POTER Edugames.

## Menjalankan proyek

1. Instal dependency dengan `npm install`.
2. Salin `.env.example` menjadi `.env` lalu ganti kredensial dan kunci rahasianya.
3. Jalankan dengan `npm start`.
4. Buka `http://localhost:3000`.

Database SQLite dan file APK tidak disimpan di repository. Letakkan APK rilis resmi di
`public/assets/apks/` dengan nama yang sesuai data versi pada dashboard admin. Server
hanya mengakui file APK valid berukuran minimal 1 MB sebagai unduhan terverifikasi.
