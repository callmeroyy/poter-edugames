const path = require('path');
const bcrypt = require('bcryptjs');

async function main() {
  const newPassword = process.argv[2] || 'poter202612345678910';
  const username = 'admin';
  const newHash = bcrypt.hashSync(newPassword, 10);

  // 1. Update SQLite
  try {
    const Database = require('better-sqlite3');
    const sqlitePath = path.join(__dirname, '..', 'poter_data.db');
    const sqlite = new Database(sqlitePath);
    const info = sqlite.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(newHash, username);
    console.log(`SQLite updated: ${info.changes} row(s)`);
    sqlite.close();
  } catch (err) {
    console.error('Error updating SQLite:', err.message);
  }

  // 2. Update Neon Postgres if DATABASE_URL is set
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
      });
      const res = await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [newHash, username]);
      console.log(`Neon Postgres updated: ${res.rowCount} row(s)`);
      await pool.end();
    } catch (err) {
      console.error('Error updating Neon Postgres:', err.message);
    }
  } else {
    console.log('DATABASE_URL not set, skipped Postgres update.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
