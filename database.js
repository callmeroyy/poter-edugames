const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const usePostgres = Boolean(process.env.DATABASE_URL);
let sqlite = null;
let pool = null;

if (usePostgres) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, value => Number(value));
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DB_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000
  });
} else {
  const Database = require('better-sqlite3');
  sqlite = new Database(path.join(__dirname, 'poter_data.db'));
  sqlite.pragma('journal_mode = WAL');
}

function postgresSql(sql) {
  let converted = String(sql)
    .replace(/datetime\('now',\s*'-(\d+) seconds?'\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '$1 seconds')")
    .replace(/datetime\('now',\s*'-(\d+) days?'\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '$1 days')")
    .replace(/date\('now'\)/gi, 'CURRENT_DATE');
  let parameterIndex = 0;
  converted = converted.replace(/\?/g, () => `$${++parameterIndex}`);
  return converted;
}

function createAdapter(client = null) {
  const pgClient = client || pool;
  return {
    isPostgres: usePostgres,
    prepare(sql) {
      return {
        async get(...params) {
          if (!usePostgres) return sqlite.prepare(sql).get(...params);
          const result = await pgClient.query(postgresSql(sql), params);
          return result.rows[0];
        },
        async all(...params) {
          if (!usePostgres) return sqlite.prepare(sql).all(...params);
          const result = await pgClient.query(postgresSql(sql), params);
          return result.rows;
        },
        async run(...params) {
          if (!usePostgres) return sqlite.prepare(sql).run(...params);
          const result = await pgClient.query(postgresSql(sql), params);
          return { changes: result.rowCount };
        }
      };
    },
    async transaction(callback) {
      if (!usePostgres) return callback(createAdapter());
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const result = await callback(createAdapter(connection));
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
    async close() {
      if (usePostgres) return pool.end();
      return sqlite.close();
    }
  };
}

const db = createAdapter();

async function initializePostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_logs (
      id BIGSERIAL PRIMARY KEY, ip TEXT, user_agent TEXT, os TEXT, browser TEXT,
      device_type TEXT, path TEXT, referrer TEXT,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS download_logs (
      id BIGSERIAL PRIMARY KEY, version TEXT, ip TEXT, user_agent TEXT, os TEXT,
      browser TEXT, device_type TEXT, status TEXT DEFAULT 'completed',
      verified INTEGER DEFAULT 0, bytes_sent BIGINT DEFAULT 0,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS install_logs (
      id BIGSERIAL PRIMARY KEY, version TEXT, device_id TEXT, device_model TEXT,
      os_version TEXT, ip TEXT, verified INTEGER DEFAULT 0,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_versions (
      id BIGSERIAL PRIMARY KEY, version_code TEXT UNIQUE NOT NULL, release_date TEXT,
      file_size TEXT, min_android TEXT, changelog TEXT, file_name TEXT,
      download_url TEXT, is_latest INTEGER DEFAULT 0,
      download_enabled INTEGER NOT NULL DEFAULT 1, download_count INTEGER DEFAULT 0,
      deleted_at TIMESTAMPTZ DEFAULT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL, role TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT, username TEXT NOT NULL,
      category TEXT NOT NULL, action TEXT NOT NULL, details TEXT, ip TEXT,
      user_agent TEXT, status TEXT DEFAULT 'success',
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_download_logs_verified ON download_logs(verified, timestamp);
    CREATE INDEX IF NOT EXISTS idx_install_logs_verified ON install_logs(verified, timestamp);
    CREATE INDEX IF NOT EXISTS idx_app_versions_deleted_at ON app_versions(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_timestamp ON admin_audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
  `);
}

function initializeSqlite() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, user_agent TEXT, os TEXT,
      browser TEXT, device_type TEXT, path TEXT, referrer TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS download_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT, ip TEXT, user_agent TEXT,
      os TEXT, browser TEXT, device_type TEXT, status TEXT DEFAULT 'completed',
      verified INTEGER DEFAULT 0, bytes_sent INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS install_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT, device_id TEXT,
      device_model TEXT, os_version TEXT, ip TEXT, verified INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, version_code TEXT UNIQUE, release_date TEXT,
      file_size TEXT, min_android TEXT, changelog TEXT, file_name TEXT, download_url TEXT,
      is_latest INTEGER DEFAULT 0, download_enabled INTEGER NOT NULL DEFAULT 1,
      download_count INTEGER DEFAULT 0, deleted_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT,
      role TEXT DEFAULT 'admin', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER, username TEXT NOT NULL,
      role TEXT NOT NULL, expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT NOT NULL,
      category TEXT NOT NULL, action TEXT NOT NULL, details TEXT, ip TEXT,
      user_agent TEXT, status TEXT DEFAULT 'success',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
  `);
  const versionColumns = sqlite.prepare('PRAGMA table_info(app_versions)').all().map(column => column.name);
  if (!versionColumns.includes('download_enabled')) sqlite.exec('ALTER TABLE app_versions ADD COLUMN download_enabled INTEGER NOT NULL DEFAULT 1');
  if (!versionColumns.includes('deleted_at')) sqlite.exec('ALTER TABLE app_versions ADD COLUMN deleted_at DATETIME DEFAULT NULL');
  if (!versionColumns.includes('download_url')) sqlite.exec('ALTER TABLE app_versions ADD COLUMN download_url TEXT');
}

async function seedDefaults() {
  const username = String(process.env.ADMIN_USERNAME || 'admin').trim();
  const existingAdmin = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!existingAdmin) {
    const password = process.env.ADMIN_PASSWORD || (!usePostgres ? 'poter2026' : crypto.randomBytes(24).toString('base64url'));
    await db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, bcrypt.hashSync(password, 10), 'admin');
    if (usePostgres && !process.env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD belum diatur; atur sebelum login produksi.');
  }

  const versionCount = await db.prepare('SELECT COUNT(*) AS count FROM app_versions').get();
  if (Number(versionCount.count) === 0) {
    const insert = `
      INSERT INTO app_versions
        (version_code, release_date, file_size, min_android, changelog, file_name, is_latest, download_enabled, download_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `;
    await db.prepare(insert).run(
      'v1.1.0', '7 November 2026', '62.4 MB', 'Android 8.0 (Oreo) ke atas',
      JSON.stringify([
        'Game baru: Rapikan! (melatih kemampuan spasial dan klasifikasi objek)',
        'Tombol petunjuk dan ulang kini ada di pojok kanan atas layar',
        'Penyempurnaan animasi interaktif dan peningkatan kestabilan performa'
      ]),
      'POTER-EDUGAMES-v1.1.0.apk', 1, 0
    );
    await db.prepare(insert).run(
      'v1.0.0', '24 Oktober 2026', '55.0 MB', 'Android 8.0 (Oreo) ke atas',
      JSON.stringify([
        'Rilis perdana game edukasi: Pasangkan (Memori), Mengelompokkan (Memilah kue), Timbangan Pasar (Bandingkan), dan Buka Jalan (Strategi)',
        'Dukungan grafis 2D ramah anak tanpa iklan'
      ]),
      'POTER-EDUGAMES-v1.0.0.apk', 0, 0
    );
  }

  await db.prepare(`
    UPDATE app_versions SET download_count = (
      SELECT COUNT(*) FROM download_logs
      WHERE download_logs.version = app_versions.version_code
        AND download_logs.status = 'completed' AND download_logs.verified = 1
    )
  `).run();
}

async function initialize() {
  if (usePostgres) await initializePostgres();
  else initializeSqlite();
  await seedDefaults();
}

db.ready = initialize();
module.exports = db;
