const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL wajib diatur sebelum migrasi.');
}
if (process.env.MIGRATE_CONFIRM !== 'YES') {
  throw new Error('Set MIGRATE_CONFIRM=YES untuk mengizinkan penggantian isi database tujuan.');
}

const source = new Database(path.join(__dirname, '..', 'poter_data.db'), { readonly: true });
const target = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1
});

const tableColumns = {
  users: ['id', 'username', 'password_hash', 'role', 'created_at'],
  access_logs: ['id', 'ip', 'user_agent', 'os', 'browser', 'device_type', 'path', 'referrer', 'timestamp'],
  download_logs: ['id', 'version', 'ip', 'user_agent', 'os', 'browser', 'device_type', 'status', 'verified', 'bytes_sent', 'timestamp'],
  install_logs: ['id', 'version', 'device_id', 'device_model', 'os_version', 'ip', 'verified', 'timestamp'],
  app_versions: ['id', 'version_code', 'release_date', 'file_size', 'min_android', 'changelog', 'file_name', 'download_url', 'is_latest', 'download_enabled', 'download_count', 'deleted_at', 'created_at'],
  admin_audit_logs: ['id', 'user_id', 'username', 'category', 'action', 'details', 'ip', 'user_agent', 'status', 'timestamp']
};

function readRows(table, columns) {
  const existing = new Set(source.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
  const select = columns.map(column => existing.has(column) ? column : `NULL AS ${column}`).join(', ');
  return source.prepare(`SELECT ${select} FROM ${table} ORDER BY id`).all();
}

async function insertRows(client, table, columns, rows) {
  for (const row of rows) {
    if (table === 'app_versions' && !row.download_url) row.download_enabled = 0;
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const values = columns.map(column => row[column]);
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
  }
}

async function main() {
  const client = await target.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      TRUNCATE admin_sessions, admin_audit_logs, download_logs, install_logs,
        access_logs, app_versions, users RESTART IDENTITY CASCADE
    `);

    const counts = {};
    for (const [table, columns] of Object.entries(tableColumns)) {
      const rows = readRows(table, columns);
      await insertRows(client, table, columns, rows);
      counts[table] = rows.length;
    }

    for (const table of Object.keys(tableColumns)) {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('${table}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${table}), 1),
          EXISTS(SELECT 1 FROM ${table})
        )
      `);
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ success: true, migrated: counts }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await target.end();
    source.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
