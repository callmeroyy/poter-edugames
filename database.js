const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'poter_data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    user_agent TEXT,
    os TEXT,
    browser TEXT,
    device_type TEXT,
    path TEXT,
    referrer TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS download_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT,
    ip TEXT,
    user_agent TEXT,
    os TEXT,
    browser TEXT,
    device_type TEXT,
    status TEXT DEFAULT 'completed',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS install_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT,
    device_id TEXT,
    device_model TEXT,
    os_version TEXT,
    ip TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_code TEXT UNIQUE,
    release_date TEXT,
    file_size TEXT,
    min_android TEXT,
    changelog TEXT,
    file_name TEXT,
    is_latest INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    ip TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'success',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_admin_audit_timestamp ON admin_audit_logs(timestamp);
`);

// Backward-compatible migration for databases created by older versions.
const downloadColumns = db.prepare('PRAGMA table_info(download_logs)').all().map(column => column.name);
if (!downloadColumns.includes('verified')) {
  db.exec('ALTER TABLE download_logs ADD COLUMN verified INTEGER DEFAULT 0');
}
if (!downloadColumns.includes('bytes_sent')) {
  db.exec('ALTER TABLE download_logs ADD COLUMN bytes_sent INTEGER DEFAULT 0');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_download_logs_verified ON download_logs(verified, timestamp)');

const installColumns = db.prepare('PRAGMA table_info(install_logs)').all().map(column => column.name);
if (!installColumns.includes('verified')) {
  db.exec('ALTER TABLE install_logs ADD COLUMN verified INTEGER DEFAULT 0');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_install_logs_verified ON install_logs(verified, timestamp)');

// Seed default admin if not exists
const initialAdminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
const checkAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(initialAdminUsername);
if (!checkAdmin) {
  const generatedPassword = !process.env.ADMIN_PASSWORD;
  const initialAdminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(initialAdminPassword, salt);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(initialAdminUsername, passwordHash, 'admin');
  console.log(`Admin created: ${initialAdminUsername}`);
  if (generatedPassword) {
    console.log(`One-time generated admin password: ${initialAdminPassword}`);
  }
}

// Seed default app versions if table is empty
const checkVersions = db.prepare('SELECT count(*) as count FROM app_versions').get();
if (checkVersions.count === 0) {
  const insertVersion = db.prepare(`
    INSERT INTO app_versions (version_code, release_date, file_size, min_android, changelog, file_name, is_latest, download_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertVersion.run(
    'v1.1.0',
    '7 November 2026',
    '62.4 MB',
    'Android 8.0 (Oreo) ke atas',
    JSON.stringify([
      'Game baru: Rapikan! (melatih kemampuan spasial dan klasifikasi objek)',
      'Tombol petunjuk dan ulang kini ada di pojok kanan atas layar',
      'Penyempurnaan animasi interaktif dan peningkatan kestabilan performa'
    ]),
    'POTER-EDUGAMES-v1.1.0.apk',
    1,
    0
  );

  insertVersion.run(
    'v1.0.0',
    '24 Oktober 2026',
    '55.0 MB',
    'Android 8.0 (Oreo) ke atas',
    JSON.stringify([
      'Rilis perdana game edukasi: Pasangkan (Memori), Mengelompokkan (Memilah kue), Timbangan Pasar (Bandingkan), dan Buka Jalan (Strategi)',
      'Dukungan grafis 2D ramah anak tanpa iklan'
    ]),
    'POTER-EDUGAMES-v1.0.0.apk',
    0,
    0
  );

  console.log('Default game versions seeded (v1.1.0 & v1.0.0)');
}

// The public counter is derived only from transfers verified by the server.
// Legacy/demo rows remain available for historical inspection but do not
// contribute to any public or dashboard download total.
db.prepare(`
  UPDATE app_versions
  SET download_count = (
    SELECT COUNT(*)
    FROM download_logs
    WHERE download_logs.version = app_versions.version_code
      AND download_logs.status = 'completed'
      AND download_logs.verified = 1
  )
`).run();

module.exports = db;
