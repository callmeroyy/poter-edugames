const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const { issueSignedToken, del } = require('@vercel/blob');
const { handleUploadPresigned } = require('@vercel/blob/client');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const cookieSecret = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
app.use(cookieParser(cookieSecret));
app.use(async (req, res, next) => {
  try {
    await db.ready;
    next();
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    res.status(503).json({ success: false, message: 'Database belum siap.' });
  }
});

// Helper: Parse User Agent for human-friendly OS, Browser, Device Type
function parseUserAgent(ua = '') {
  let os = 'Lainnya';
  let browser = 'Lainnya';
  let deviceType = 'Desktop';

  // OS detection
  if (/android/i.test(ua)) {
    os = 'Android';
    deviceType = 'Mobile';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    os = 'iOS';
    deviceType = /ipad/i.test(ua) ? 'Tablet' : 'Mobile';
  } else if (/windows nt 10/i.test(ua)) {
    os = 'Windows 10/11';
  } else if (/windows/i.test(ua)) {
    os = 'Windows';
  } else if (/mac os x/i.test(ua)) {
    os = 'macOS';
  } else if (/cros/i.test(ua)) {
    os = 'Chrome OS';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  // Browser detection
  if (/edg/i.test(ua)) {
    browser = 'Microsoft Edge';
  } else if (/samsungbrowser/i.test(ua)) {
    browser = 'Samsung Internet';
  } else if (/opr|opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/chrome|crios/i.test(ua)) {
    browser = deviceType === 'Mobile' ? 'Chrome Mobile' : 'Google Chrome';
  } else if (/firefox|fxios/i.test(ua)) {
    browser = 'Mozilla Firefox';
  } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
    browser = 'Safari';
  }

  return { os, browser, deviceType };
}

// Helper: Extract clean Client IP
function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    ip = '127.0.0.1';
  }
  return ip.replace(/^.*:/, '') || '127.0.0.1';
}

async function recordAdminAudit(req, { user = null, category, action, details = '', status = 'success' }) {
  try {
    const actor = user || req.adminUser || {};
    const username = String(actor.username || req.body?.username || 'unknown').slice(0, 80);
    await db.prepare(`
      INSERT INTO admin_audit_logs
        (user_id, username, category, action, details, ip, user_agent, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actor.id || null,
      username,
      String(category || 'system').slice(0, 40),
      String(action || 'UNKNOWN').slice(0, 80),
      String(details || '').slice(0, 500),
      getClientIp(req),
      String(req.headers['user-agent'] || 'Unknown').slice(0, 500),
      String(status || 'success').slice(0, 24)
    );
  } catch (err) {
    console.error('Failed to write admin audit log:', err.message);
  }
}

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function getAuthenticatedAdmin(req) {
  const token = req.cookies.poter_admin_token;
  return token
    ? await db.prepare(`
        SELECT user_id AS id, username, role, created_at
        FROM admin_sessions
        WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP
      `).get(sessionTokenHash(token))
    : null;
}

async function requireAuth(req, res, next) {
  const session = await getAuthenticatedAdmin(req);
  if (!session) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir.' });
    }
    return res.redirect('/admin/login.html');
  }
  req.adminUser = session;
  next();
}

// Tracking middleware for public pages (auto log visits)
app.use(async (req, res, next) => {
  const reqPath = req.path;
  const isStatic = reqPath.startsWith('/css/') ||
                   reqPath.startsWith('/js/') ||
                   reqPath.startsWith('/assets/') ||
                   reqPath.startsWith('/api/') ||
                   reqPath.includes('.') && !reqPath.endsWith('.html');

  if (!isStatic && !reqPath.startsWith('/admin')) {
    try {
      const ip = getClientIp(req);
      const ua = req.headers['user-agent'] || 'Unknown';
      const { os, browser, deviceType } = parseUserAgent(ua);
      const referrer = req.headers['referer'] || req.headers['referrer'] || 'Langsung (Direct)';

      await db.prepare(`
        INSERT INTO access_logs (ip, user_agent, os, browser, device_type, path, referrer)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(ip, ua, os, browser, deviceType, reqPath, referrer);
    } catch (err) {
      console.error('Failed to log access:', err.message);
    }
  }
  next();
});

// Serve static assets from public
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// PUBLIC API: Game Versions & Download
// -------------------------------------------------------------

// Get list of versions (public)
app.get('/api/versions', async (req, res) => {
  try {
    const versions = await db.prepare('SELECT * FROM app_versions WHERE deleted_at IS NULL ORDER BY is_latest DESC, id DESC').all();
    const formatted = versions.map(v => {
      const { download_url, ...publicVersion } = v;
      return {
        ...publicVersion,
        changelog: typeof v.changelog === 'string' ? JSON.parse(v.changelog || '[]') : v.changelog
      };
    });
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await db.prepare('SELECT 1 AS ok').get();
    res.json({ success: true, database: db.isPostgres ? 'postgres' : 'sqlite' });
  } catch (error) {
    res.status(503).json({ success: false, message: error.message });
  }
});

// Telemetry: Detect and log download button click in real-time
app.post('/api/track/download-click', async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }
    const { version, source = 'Tombol Unduh' } = body || {};
    let targetVersion;

    if (version) {
      targetVersion = await db.prepare('SELECT * FROM app_versions WHERE version_code = ? AND deleted_at IS NULL').get(version);
      if (!targetVersion) {
        return res.status(404).json({ success: false, message: 'Versi APK tidak ditemukan.' });
      }
    }
    if (!targetVersion) {
      targetVersion = await db.prepare('SELECT * FROM app_versions WHERE is_latest = 1 AND download_enabled = 1 AND deleted_at IS NULL').get() ||
                      await db.prepare('SELECT * FROM app_versions WHERE download_enabled = 1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get();
    }

    if (!targetVersion) {
      return res.status(503).json({ success: false, message: 'Belum ada versi APK yang dapat diunduh.' });
    }

    if (targetVersion.download_enabled !== 1) {
      return res.status(403).json({
        success: false,
        message: `Unduhan ${targetVersion.version_code} sedang dinonaktifkan oleh admin.`
      });
    }

    const versionCode = targetVersion ? targetVersion.version_code : (version || 'v1.1.0');
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || 'Unknown';
    const { os, browser, deviceType } = parseUserAgent(ua);

    // 1. Log to access_logs so the click event appears in Access Logs
    try {
      await db.prepare(`
        INSERT INTO access_logs (ip, user_agent, os, browser, device_type, path, referrer)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(ip, ua, os, browser, deviceType, `/download [Klik: ${source}]`, req.headers['referer'] || 'Web Portal');
    } catch (e) {
      console.warn('Failed to log click in access_logs:', e.message);
    }

    res.json({
      success: true,
      message: `Klik unduhan ${versionCode} tercatat dari ${source}.`,
      version: versionCode
    });
  } catch (err) {
    console.error('Error tracking download click:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function recordVerifiedDownload({ targetVersion, ip, ua, os, browser, deviceType, bytesSent }) {
  const recent = await db.prepare(`
    SELECT id FROM download_logs
    WHERE ip = ? AND version = ? AND timestamp >= datetime('now', '-4 seconds')
    ORDER BY id DESC LIMIT 1
  `).get(ip, targetVersion.version_code);
  if (recent) return;

  await db.transaction(async tx => {
    await tx.prepare(`
      INSERT INTO download_logs
        (version, ip, user_agent, os, browser, device_type, status, verified, bytes_sent)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', 1, ?)
    `).run(targetVersion.version_code, ip, ua, os, browser, deviceType, bytesSent);
    await tx.prepare(`
      UPDATE app_versions
      SET download_count = (
        SELECT COUNT(*) FROM download_logs
        WHERE version = ? AND status = 'completed' AND verified = 1
      )
      WHERE id = ?
    `).run(targetVersion.version_code, targetVersion.id);
  });
}

function validBlobUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com');
  } catch (_) {
    return false;
  }
}

// A download is counted only after the full response finishes transferring.
app.get(['/download', '/download/:version'], async (req, res) => {
  try {
    const requestedVersion = req.params.version;
    let targetVersion;

    if (requestedVersion) {
      targetVersion = await db.prepare('SELECT * FROM app_versions WHERE version_code = ? AND deleted_at IS NULL').get(requestedVersion);
      if (!targetVersion) {
        return res.status(404).send('Versi APK tidak ditemukan di sistem.');
      }
    }

    if (!targetVersion) {
      targetVersion = await db.prepare('SELECT * FROM app_versions WHERE is_latest = 1 AND download_enabled = 1 AND deleted_at IS NULL').get() ||
                      await db.prepare('SELECT * FROM app_versions WHERE download_enabled = 1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get();
    }

    if (!targetVersion) {
      return res.status(503).send('Belum ada versi APK yang dapat diunduh saat ini.');
    }

    if (targetVersion.download_enabled !== 1) {
      return res.status(403).send(`Unduhan ${targetVersion.version_code} sedang dinonaktifkan oleh admin.`);
    }

    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || 'Unknown';
    const { os, browser, deviceType } = parseUserAgent(ua);

    const apkFilePath = path.join(__dirname, 'public', 'assets', 'apks', targetVersion.file_name);

    if (!fs.existsSync(apkFilePath) && !validBlobUrl(targetVersion.download_url)) {
      return res.status(404).send('Berkas APK untuk versi ini belum tersedia. Tidak ada unduhan yang dicatat.');
    }

    if (!fs.existsSync(apkFilePath)) {
      const remote = await fetch(targetVersion.download_url, { method: req.method === 'HEAD' ? 'HEAD' : 'GET' });
      if (!remote.ok || (req.method !== 'HEAD' && !remote.body)) {
        return res.status(502).send('Penyimpanan APK sedang tidak dapat diakses.');
      }
      const remoteSize = Number(remote.headers.get('content-length')) || 0;
      res.status(remote.status);
      res.set('Content-Type', 'application/vnd.android.package-archive');
      res.set('Content-Disposition', `attachment; filename="${targetVersion.file_name}"`);
      if (remoteSize > 0) res.set('Content-Length', String(remoteSize));
      if (req.method === 'HEAD') return res.end();

      res.once('finish', () => {
        if (res.statusCode !== 200) return;
        recordVerifiedDownload({
          targetVersion, ip, ua, os, browser, deviceType, bytesSent: remoteSize
        }).catch(error => console.error('Failed to record Blob download:', error.message));
      });
      Readable.fromWeb(remote.body).pipe(res);
      return;
    }

    const fileSize = fs.statSync(apkFilePath).size;
    const apkHeader = Buffer.alloc(4);
    const apkDescriptor = fs.openSync(apkFilePath, 'r');
    fs.readSync(apkDescriptor, apkHeader, 0, apkHeader.length, 0);
    fs.closeSync(apkDescriptor);

    // Verify APK has valid ZIP signature (0x50, 0x4b, 0x03, 0x04)
    const hasZipSignature = apkHeader.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
                            apkHeader.equals(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (!hasZipSignature) {
      return res.status(503).send('Berkas APK belum siap atau format tidak valid.');
    }

    if (req.method === 'HEAD') {
      return res.status(200)
        .set('Content-Type', 'application/vnd.android.package-archive')
        .set('Content-Length', String(fileSize))
        .end();
    }

    return res.download(apkFilePath, targetVersion.file_name, async err => {
      if (err) {
        console.error('APK transfer did not complete:', err.message);
        if (!res.headersSent) {
          res.status(err.statusCode || 500).send('Unduhan tidak selesai dan tidak dicatat.');
        }
        return;
      }

      if (res.statusCode !== 200) return;
      await recordVerifiedDownload({ targetVersion, ip, ua, os, browser, deviceType, bytesSent: fileSize });
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Terjadi kendala saat memproses unduhan APK.');
  }
});

// QR Code Generator for mobile instant scan
app.get('/api/qr', async (req, res) => {
  try {
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const targetUrl = `${protocol}://${host}/download`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 2,
      width: 280,
      color: {
        dark: '#1E3A8A',
        light: '#FFFFFF'
      }
    });

    res.json({ success: true, qr: qrDataUrl, url: targetUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Telemetry Install Ping (Called when game is first opened on Android)
app.post('/api/track/install', async (req, res) => {
  try {
    const { version = 'v1.1.0', device_id = 'unknown', device_model = 'Android Device', os_version = 'Android' } = req.body;
    const ip = getClientIp(req);

    if (device_id !== 'unknown') {
      const existing = await db.prepare(`
        SELECT id FROM install_logs
        WHERE version = ? AND device_id = ? AND verified = 1
        LIMIT 1
      `).get(version, device_id);
      if (existing) {
        return res.json({ success: true, duplicate: true, message: 'Pemasangan perangkat ini sudah pernah dicatat.' });
      }
    }

    await db.prepare(`
      INSERT INTO install_logs (version, device_id, device_model, os_version, ip, verified)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(version, device_id, device_model, os_version, ip);

    res.json({ success: true, message: 'Telemetri instalasi berhasil dicatat.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// AUTHENTICATION ROUTES
// -------------------------------------------------------------

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    await recordAdminAudit(req, {
      user: { username: username || 'unknown' },
      category: 'authentication',
      action: 'LOGIN_FAILED',
      details: 'Username atau password kosong',
      status: 'denied'
    });
    return res.status(400).json({ success: false, message: 'Nama pengguna dan kata sandi wajib diisi.' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    await recordAdminAudit(req, {
      user: { username },
      category: 'authentication',
      action: 'LOGIN_FAILED',
      details: 'Kredensial tidak cocok',
      status: 'denied'
    });
    return res.status(401).json({ success: false, message: 'Nama pengguna atau kata sandi tidak cocok.' });
  }

  // Store only a token hash so a database leak cannot expose active cookies.
  const token = `poter_sess_${crypto.randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= CURRENT_TIMESTAMP').run();
  await db.prepare(`
    INSERT INTO admin_sessions (token_hash, user_id, username, role, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionTokenHash(token), user.id, user.username, user.role, expiresAt);

  res.cookie('poter_admin_token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });

  await recordAdminAudit(req, {
    user,
    category: 'authentication',
    action: 'LOGIN_SUCCESS',
    details: `Masuk sebagai ${user.role}`
  });

  res.json({ success: true, username: user.username, role: user.role });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies.poter_admin_token;
  if (token) {
    const tokenHash = sessionTokenHash(token);
    const session = await db.prepare(`
      SELECT user_id AS id, username, role FROM admin_sessions WHERE token_hash = ?
    `).get(tokenHash);
    if (session) {
      await recordAdminAudit(req, {
        user: session,
        category: 'authentication',
        action: 'LOGOUT',
        details: 'Keluar dari dashboard admin'
      });
    }
    await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
  }
  res.clearCookie('poter_admin_token');
  res.json({ success: true, message: 'Berhasil keluar.' });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies.poter_admin_token;
  const session = token
    ? await db.prepare(`
        SELECT user_id AS id, username, role, created_at
        FROM admin_sessions
        WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP
      `).get(sessionTokenHash(token))
    : null;
  if (!session) {
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, user: session });
});

// -------------------------------------------------------------
// ADMIN DASHBOARD ANALYTICS & LOGS (Protected)
// -------------------------------------------------------------

// Dashboard Stats & Metrics
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const totalVisits = (await db.prepare('SELECT COUNT(*) as count FROM access_logs').get()).count;
    const uniqueVisitors = (await db.prepare('SELECT COUNT(DISTINCT ip) as count FROM access_logs').get()).count;
    const totalDownloads = (await db.prepare("SELECT COUNT(*) as count FROM download_logs WHERE verified = 1 AND status = 'completed'").get()).count;
    const totalInstalls = (await db.prepare('SELECT COUNT(*) as count FROM install_logs WHERE verified = 1').get()).count;

    // Today's numbers
    const todayVisits = (await db.prepare(`
      SELECT COUNT(*) as count FROM access_logs
      WHERE date(timestamp) = date('now')
    `).get()).count;

    const todayDownloads = (await db.prepare(`
      SELECT COUNT(*) as count FROM download_logs
      WHERE verified = 1 AND status = 'completed' AND date(timestamp) = date('now')
    `).get()).count;

    // Conversion rate
    const downloadRate = totalVisits > 0 ? ((totalDownloads / totalVisits) * 100).toFixed(1) : 0;
    const installRate = totalDownloads > 0 ? ((totalInstalls / totalDownloads) * 100).toFixed(1) : 0;

    // Daily trends (last 7 days)
    const dailyVisits = await db.prepare(`
      SELECT date(timestamp) as date, COUNT(*) as visits
      FROM access_logs
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY date(timestamp)
      ORDER BY date(timestamp) ASC
    `).all();

    const dailyDownloads = await db.prepare(`
      SELECT date(timestamp) as date, COUNT(*) as downloads
      FROM download_logs
      WHERE verified = 1 AND status = 'completed'
        AND timestamp >= datetime('now', '-7 days')
      GROUP BY date(timestamp)
      ORDER BY date(timestamp) ASC
    `).all();

    // OS Distribution
    const osDistribution = await db.prepare(`
      SELECT os, COUNT(*) as count
      FROM access_logs
      GROUP BY os
      ORDER BY count DESC
      LIMIT 5
    `).all();

    // Device Type Distribution
    const deviceDistribution = await db.prepare(`
      SELECT device_type, COUNT(*) as count
      FROM access_logs
      GROUP BY device_type
      ORDER BY count DESC
    `).all();

    // Downloads per version
    const versionDownloads = await db.prepare(`
      SELECT version, COUNT(*) as count
      FROM download_logs
      WHERE verified = 1 AND status = 'completed'
      GROUP BY version
      ORDER BY count DESC
    `).all();

    // Recent 5 access logs
    const recentAccess = await db.prepare(`
      SELECT id, ip, os, browser, device_type, path, referrer, timestamp
      FROM access_logs
      ORDER BY id DESC
      LIMIT 5
    `).all();

    // Recent 5 download logs
    const recentDownloads = await db.prepare(`
      SELECT id, version, ip, os, browser, device_type, status, timestamp
      FROM download_logs
      WHERE verified = 1 AND status = 'completed'
      ORDER BY id DESC
      LIMIT 5
    `).all();

    res.json({
      success: true,
      data: {
        summary: {
          totalVisits,
          uniqueVisitors,
          totalDownloads,
          totalInstalls,
          todayVisits,
          todayDownloads,
          downloadRate: `${downloadRate}%`,
          installRate: `${installRate}%`
        },
        dailyVisits,
        dailyDownloads,
        osDistribution,
        deviceDistribution,
        versionDownloads,
        recentAccess,
        recentDownloads
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Full Access Logs with search, filter, pagination
app.get('/api/dashboard/access-logs', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const osFilter = req.query.os || null;

    let query = 'SELECT * FROM access_logs';
    let countQuery = 'SELECT COUNT(*) as total FROM access_logs';
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(ip LIKE ? OR user_agent LIKE ? OR path LIKE ? OR referrer LIKE ?)');
      params.push(search, search, search, search);
    }
    if (osFilter) {
      conditions.push('os = ?');
      params.push(osFilter);
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    const totalCount = (await db.prepare(countQuery).get(...params)).total;
    const logs = await db.prepare(query).all(...params, limit, offset);

    res.json({
      success: true,
      logs,
      total: totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Full Download Logs with search, filter, pagination
app.get('/api/dashboard/download-logs', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const versionFilter = req.query.version || null;

    let query = 'SELECT * FROM download_logs';
    let countQuery = 'SELECT COUNT(*) as total FROM download_logs';
    const conditions = ["verified = 1", "status = 'completed'"];
    const params = [];

    if (search) {
      conditions.push('(ip LIKE ? OR version LIKE ? OR user_agent LIKE ?)');
      params.push(search, search, search);
    }
    if (versionFilter) {
      conditions.push('version = ?');
      params.push(versionFilter);
    }

    const whereClause = ' WHERE ' + conditions.join(' AND ');
    query += whereClause;
    countQuery += whereClause;

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    const totalCount = (await db.prepare(countQuery).get(...params)).total;
    const logs = await db.prepare(query).all(...params, limit, offset);

    res.json({
      success: true,
      logs,
      total: totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Full Install Logs
app.get('/api/dashboard/install-logs', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;

    const totalCount = (await db.prepare('SELECT COUNT(*) as total FROM install_logs WHERE verified = 1').get()).total;
    const logs = await db.prepare('SELECT * FROM install_logs WHERE verified = 1 ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);

    res.json({
      success: true,
      logs,
      total: totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin audit trail, kept separate from public visitor and download logs.
app.get('/api/dashboard/admin-audit-logs', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const category = req.query.category || null;
    const status = req.query.status || null;
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(username LIKE ? OR action LIKE ? OR details LIKE ? OR ip LIKE ?)');
      params.push(search, search, search, search);
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const total = (await db.prepare(`SELECT COUNT(*) AS total FROM admin_audit_logs${whereClause}`).get(...params)).total;
    const logs = await db.prepare(`
      SELECT id, username, category, action, details, ip, status, timestamp
      FROM admin_audit_logs${whereClause}
      ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      success: true,
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/dashboard/audit', requireAuth, async (req, res) => {
  const allowedSections = new Set([
    'Ringkasan & Grafik',
    'Riwayat Akses Web',
    'Unduhan APK Terverifikasi',
    'Telemetri Pemasangan',
    'Aktivitas Admin',
    'Kelola Versi Game',
    'Panduan Telemetri'
  ]);
  const section = String(req.body?.section || '').slice(0, 80);

  if (!allowedSections.has(section)) {
    return res.status(400).json({ success: false, message: 'Bagian dashboard tidak dikenali.' });
  }

  await recordAdminAudit(req, {
    category: 'navigation',
    action: 'VIEW_SECTION',
    details: `Membuka tampilan: ${section}`
  });
  res.json({ success: true });
});

// CSV Export for Logs
app.get('/api/dashboard/export/:type', requireAuth, async (req, res) => {
  const { type } = req.params;

  if (type === 'access') {
    const rows = await db.prepare('SELECT id, ip, os, browser, device_type, path, referrer, timestamp FROM access_logs ORDER BY id DESC').all();
    let csv = 'ID,IP Address,OS,Browser,Device,Path,Referrer,Timestamp\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.ip}","${r.os}","${r.browser}","${r.device_type}","${r.path}","${r.referrer}","${r.timestamp}"\n`;
    });
    await recordAdminAudit(req, {
      category: 'data_export',
      action: 'EXPORT_ACCESS_LOGS',
      details: `Mengekspor ${rows.length} log akses web`
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="poter_access_logs.csv"');
    return res.send(csv);
  } else if (type === 'downloads') {
    const rows = await db.prepare(`
      SELECT id, version, ip, os, browser, device_type, bytes_sent, status, timestamp
      FROM download_logs
      WHERE verified = 1 AND status = 'completed'
      ORDER BY id DESC
    `).all();
    let csv = 'ID,Version,IP Address,OS,Browser,Device,Bytes Sent,Status,Timestamp\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.version}","${r.ip}","${r.os}","${r.browser}","${r.device_type}","${r.bytes_sent}","${r.status}","${r.timestamp}"\n`;
    });
    await recordAdminAudit(req, {
      category: 'data_export',
      action: 'EXPORT_VERIFIED_DOWNLOADS',
      details: `Mengekspor ${rows.length} unduhan terverifikasi`
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="poter_download_logs.csv"');
    return res.send(csv);
  } else if (type === 'admin-audit') {
    const rows = await db.prepare(`
      SELECT id, username, category, action, details, ip, status, timestamp
      FROM admin_audit_logs ORDER BY id DESC
    `).all();
    let csv = 'ID,Username,Category,Action,Details,IP,Status,Timestamp\n';
    rows.forEach(r => {
      const details = String(r.details || '').replaceAll('"', '""');
      csv += `"${r.id}","${r.username}","${r.category}","${r.action}","${details}","${r.ip}","${r.status}","${r.timestamp}"\n`;
    });
    await recordAdminAudit(req, {
      category: 'data_export',
      action: 'EXPORT_ADMIN_AUDIT',
      details: `Mengekspor ${rows.length} log aktivitas admin`
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="poter_admin_audit.csv"');
    return res.send(csv);
  } else {
    res.status(400).send('Tipe ekspor tidak dikenali.');
  }
});

// Admin version list, including a separate recoverable trash view.
app.get('/api/admin/versions', requireAuth, async (req, res) => {
  try {
    const status = req.query.status === 'trash' ? 'trash' : 'active';
    const condition = status === 'trash' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
    const versions = await db.prepare(`
      SELECT * FROM app_versions
      WHERE ${condition}
      ORDER BY is_latest DESC, id DESC
    `).all();
    const formatted = versions.map(version => ({
      ...version,
      changelog: typeof version.changelog === 'string'
        ? JSON.parse(version.changelog || '[]')
        : version.changelog
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';
const MAX_APK_SIZE_BYTES = 1024 * 1024 * 1024;

function safeApkPathPart(value, fallback = 'versi-baru') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function parseUploadClientPayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    throw new Error('Data unggahan APK tidak valid.');
  }
}

// Cookie auth protects token issuance; Blob signs the completion callback instead.
app.post('/api/admin/apk-upload', async (req, res) => {
  try {
    const result = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname, clientPayload) => {
        const admin = await getAuthenticatedAdmin(req);
        if (!admin) {
          const error = new Error('Sesi admin tidak valid atau telah berakhir.');
          error.statusCode = 401;
          throw error;
        }

        const payload = parseUploadClientPayload(clientPayload);
        const versionCode = String(payload.versionCode || '').trim();
        if (!versionCode) throw new Error('Nomor versi wajib diisi sebelum APK diunggah.');

        const safeVersion = safeApkPathPart(versionCode);
        const expectedPath = `apks/${safeVersion}/POTER-EDUGAMES-${safeVersion}.apk`;
        if (pathname !== expectedPath || !pathname.toLowerCase().endsWith('.apk')) {
          throw new Error('Lokasi unggahan APK tidak diizinkan.');
        }

        const validUntil = Date.now() + (15 * 60 * 1000);
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          allowedContentTypes: [APK_CONTENT_TYPE],
          maximumSizeInBytes: MAX_APK_SIZE_BYTES,
          validUntil
        });

        await recordAdminAudit(req, {
          user: admin,
          category: 'version_management',
          action: 'START_APK_UPLOAD',
          details: `Memulai unggahan APK untuk ${versionCode}`
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes: [APK_CONTENT_TYPE],
            maximumSizeInBytes: MAX_APK_SIZE_BYTES,
            validUntil,
            addRandomSuffix: true,
            allowOverwrite: false,
            cacheControlMaxAge: 60 * 60,
            tokenPayload: JSON.stringify({
              userId: admin.id,
              username: admin.username,
              versionCode
            })
          }
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseUploadClientPayload(tokenPayload);
        await recordAdminAudit(req, {
          user: {
            id: Number(payload.userId) || null,
            username: String(payload.username || 'admin')
          },
          category: 'version_management',
          action: 'COMPLETE_APK_UPLOAD',
          details: `APK ${payload.versionCode || '-'} selesai diunggah: ${blob.pathname}`
        });
      }
    });

    res.json(result);
  } catch (err) {
    console.error('APK upload route failed:', err.message);
    const statusCode = Number(err.statusCode) || 400;
    res.status(statusCode).json({
      success: false,
      message: err.message || 'Unggahan APK gagal diproses.'
    });
  }
});

// Add New Game Version
app.post('/api/versions', requireAuth, async (req, res) => {
  try {
    const { version_code, release_date, file_size, min_android, changelog, download_url, is_latest, download_enabled } = req.body;

    if (!version_code || !file_size) {
      return res.status(400).json({ success: false, message: 'Nomor versi dan ukuran file wajib diisi.' });
    }
    if (download_url && !validBlobUrl(download_url)) {
      return res.status(400).json({ success: false, message: 'URL APK harus berasal dari Vercel Blob.' });
    }

    if (is_latest) {
      await db.prepare('UPDATE app_versions SET is_latest = 0 WHERE deleted_at IS NULL').run();
    }

    const changelogArray = Array.isArray(changelog) ? changelog : (changelog || '').split('\n').filter(Boolean);
    const fileName = `POTER-EDUGAMES-${version_code}.apk`;

    const stmt = db.prepare(`
      INSERT INTO app_versions (version_code, release_date, file_size, min_android, changelog, file_name, download_url, is_latest, download_enabled, download_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    await stmt.run(
      version_code,
      release_date || new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
      file_size,
      min_android || 'Android 8.0 (Oreo) ke atas',
      JSON.stringify(changelogArray),
      fileName,
      download_url || null,
      is_latest ? 1 : 0,
      download_enabled === false || !download_url ? 0 : 1
    );

    await recordAdminAudit(req, {
      category: 'version_management',
      action: 'CREATE_VERSION',
      details: `Menambahkan versi ${version_code}${is_latest ? ' sebagai versi utama' : ''}`
    });

    res.json({ success: true, message: `Versi ${version_code} berhasil ditambahkan.` });
  } catch (err) {
    const isDuplicate = String(err.message).includes('UNIQUE constraint failed') ||
                        String(err.message).includes('duplicate key') ||
                        err.code === '23505';
    res.status(isDuplicate ? 409 : 500).json({
      success: false,
      message: isDuplicate
        ? `Nomor versi '${req.body?.version_code}' sudah terdaftar. Gunakan tombol Edit pada tabel di bawah untuk memperbarui berkas APK versi ini.`
        : (err.message || 'Versi gagal ditambahkan.'),
      error: err.message
    });
  }
});

// Edit release metadata, recommendation, and download availability.
app.put('/api/versions/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { version_code, release_date, file_size, min_android, changelog, download_url, is_latest, download_enabled } = req.body;
    const version = await db.prepare('SELECT * FROM app_versions WHERE id = ?').get(id);

    if (!version) {
      return res.status(404).json({ success: false, message: 'Versi APK tidak ditemukan.' });
    }
    if (version.deleted_at) {
      return res.status(409).json({ success: false, message: 'Pulihkan versi dari sampah sebelum mengeditnya.' });
    }

    const hasLatestUpdate = Object.prototype.hasOwnProperty.call(req.body, 'is_latest');
    const hasDownloadUpdate = Object.prototype.hasOwnProperty.call(req.body, 'download_enabled');
    const hasMetadataUpdate = ['version_code', 'release_date', 'file_size', 'min_android', 'changelog', 'download_url']
      .some(field => Object.prototype.hasOwnProperty.call(req.body, field));

    if (!hasLatestUpdate && !hasDownloadUpdate && !hasMetadataUpdate) {
      return res.status(400).json({ success: false, message: 'Tidak ada data versi yang diperbarui.' });
    }

    const nextVersionCode = hasMetadataUpdate ? String(version_code || '').trim() : version.version_code;
    const nextFileSize = hasMetadataUpdate ? String(file_size || '').trim() : version.file_size;
    if (hasMetadataUpdate && (!nextVersionCode || !nextFileSize)) {
      return res.status(400).json({ success: false, message: 'Nomor versi dan ukuran file wajib diisi.' });
    }
    if (hasMetadataUpdate && download_url && !validBlobUrl(download_url)) {
      return res.status(400).json({ success: false, message: 'URL APK harus berasal dari Vercel Blob.' });
    }
    const requestedDownloadEnabled = download_enabled === true || download_enabled === 1 || download_enabled === '1';
    const effectiveDownloadEnabled = requestedDownloadEnabled && Boolean(hasMetadataUpdate ? download_url : version.download_url);

    await db.transaction(async tx => {
      if (hasMetadataUpdate) {
        const changelogArray = Array.isArray(changelog)
          ? changelog
          : String(changelog || '').split('\n').map(item => item.trim()).filter(Boolean);
        await tx.prepare(`
          UPDATE app_versions
          SET version_code = ?, release_date = ?, file_size = ?, min_android = ?, changelog = ?, download_url = ?
          WHERE id = ?
        `).run(
          nextVersionCode,
          String(release_date || '').trim(),
          nextFileSize,
          String(min_android || '').trim(),
          JSON.stringify(changelogArray),
          download_url || null,
          id
        );
      }

      if (hasLatestUpdate && is_latest) {
        await tx.prepare('UPDATE app_versions SET is_latest = 0 WHERE deleted_at IS NULL').run();
        await tx.prepare('UPDATE app_versions SET is_latest = 1 WHERE id = ?').run(id);
      }

      if (hasDownloadUpdate) {
        await tx.prepare('UPDATE app_versions SET download_enabled = ? WHERE id = ?').run(effectiveDownloadEnabled ? 1 : 0, id);
      }
    });

    if (hasMetadataUpdate) {
      await recordAdminAudit(req, {
        category: 'version_management',
        action: 'EDIT_VERSION',
        details: `Mengedit versi ${version.version_code} menjadi ${nextVersionCode}`
      });
    }
    if (hasLatestUpdate && is_latest) {
      await recordAdminAudit(req, {
        category: 'version_management',
        action: 'SET_LATEST_VERSION',
        details: `Menetapkan ${nextVersionCode} sebagai versi utama`
      });
    }
    if (hasDownloadUpdate) {
      await recordAdminAudit(req, {
        category: 'version_management',
        action: effectiveDownloadEnabled ? 'ENABLE_VERSION_DOWNLOAD' : 'DISABLE_VERSION_DOWNLOAD',
        details: `${effectiveDownloadEnabled ? 'Mengaktifkan' : 'Menonaktifkan'} unduhan ${nextVersionCode}`
      });
    }

    const updated = await db.prepare('SELECT * FROM app_versions WHERE id = ?').get(id);
    res.json({ success: true, message: 'Versi berhasil diperbarui.', data: updated });
  } catch (err) {
    const isDuplicate = String(err.message).includes('UNIQUE constraint failed') ||
                        String(err.message).includes('duplicate key') ||
                        err.code === '23505';
    res.status(isDuplicate ? 409 : 500).json({
      success: false,
      message: isDuplicate ? 'Nomor versi tersebut sudah digunakan.' : 'Versi gagal diperbarui.',
      error: err.message
    });
  }
});

// Move a version to recoverable trash instead of deleting it permanently.
app.delete('/api/versions/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const version = await db.prepare('SELECT * FROM app_versions WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!version) {
      return res.status(404).json({ success: false, message: 'Versi aktif tidak ditemukan.' });
    }

    await db.transaction(async tx => {
      await tx.prepare(`
        UPDATE app_versions
        SET deleted_at = CURRENT_TIMESTAMP, is_latest = 0, download_enabled = 0
        WHERE id = ?
      `).run(id);

      if (version.is_latest === 1) {
        const replacement = await tx.prepare(`
          SELECT id FROM app_versions
          WHERE deleted_at IS NULL
          ORDER BY id DESC
          LIMIT 1
        `).get();
        if (replacement) {
          await tx.prepare('UPDATE app_versions SET is_latest = 1 WHERE id = ?').run(replacement.id);
        }
      }
    });

    await recordAdminAudit(req, {
      category: 'version_management',
      action: 'TRASH_VERSION',
      details: `Memindahkan ${version.version_code} ke sampah`
    });
    res.json({ success: true, message: `${version.version_code} dipindahkan ke sampah.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Versi gagal dipindahkan ke sampah.', error: err.message });
  }
});

// Restore a trashed version. Downloads stay disabled until the admin enables them again.
app.post('/api/versions/:id/restore', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const version = await db.prepare('SELECT * FROM app_versions WHERE id = ? AND deleted_at IS NOT NULL').get(id);
    if (!version) {
      return res.status(404).json({ success: false, message: 'Versi tidak ditemukan di sampah.' });
    }

    await db.prepare(`
      UPDATE app_versions
      SET deleted_at = NULL, is_latest = 0, download_enabled = 0
      WHERE id = ?
    `).run(id);
    await recordAdminAudit(req, {
      category: 'version_management',
      action: 'RESTORE_VERSION',
      details: `Memulihkan ${version.version_code} dari sampah dengan unduhan nonaktif`
    });
    res.json({ success: true, message: `${version.version_code} dipulihkan. Unduhan tetap nonaktif sampai diaktifkan admin.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Versi gagal dipulihkan.', error: err.message });
  }
});

// Permanently delete a single trashed version from database and storage
app.delete('/api/versions/:id/permanent', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const version = await db.prepare('SELECT * FROM app_versions WHERE id = ? AND deleted_at IS NOT NULL').get(id);
    if (!version) {
      return res.status(404).json({ success: false, message: 'Versi tidak ditemukan di sampah.' });
    }

    if (validBlobUrl(version.download_url) && typeof del === 'function') {
      try {
        await del(version.download_url);
      } catch (blobErr) {
        console.warn('Gagal menghapus berkas di Blob:', blobErr.message);
      }
    }

    const apkFilePath = path.join(__dirname, 'public', 'assets', 'apks', version.file_name);
    if (fs.existsSync(apkFilePath)) {
      try { fs.unlinkSync(apkFilePath); } catch (_) {}
    }

    await db.prepare('DELETE FROM app_versions WHERE id = ?').run(id);

    await recordAdminAudit(req, {
      category: 'version_management',
      action: 'PERMANENT_DELETE_VERSION',
      details: `Menghapus permanen versi ${version.version_code} dari database`
    });

    res.json({ success: true, message: `Versi ${version.version_code} berhasil dihapus permanen dari database.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus versi secara permanen.', error: err.message });
  }
});

// Empty all trashed versions from database
app.post('/api/versions/empty-trash', requireAuth, async (req, res) => {
  try {
    const trashed = await db.prepare('SELECT * FROM app_versions WHERE deleted_at IS NOT NULL').all();
    if (trashed.length === 0) {
      return res.json({ success: true, message: 'Sampah sudah kosong.' });
    }

    for (const version of trashed) {
      if (validBlobUrl(version.download_url) && typeof del === 'function') {
        try { await del(version.download_url); } catch (_) {}
      }
      const apkFilePath = path.join(__dirname, 'public', 'assets', 'apks', version.file_name);
      if (fs.existsSync(apkFilePath)) {
        try { fs.unlinkSync(apkFilePath); } catch (_) {}
      }
    }

    await db.prepare('DELETE FROM app_versions WHERE deleted_at IS NOT NULL').run();

    await recordAdminAudit(req, {
      category: 'version_management',
      action: 'EMPTY_VERSION_TRASH',
      details: `Mengosongkan ${trashed.length} versi dari sampah dan menghapusnya dari database`
    });

    res.json({ success: true, message: `${trashed.length} versi di sampah berhasil dihapus permanen dari database.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengosongkan sampah.', error: err.message });
  }
});

// Admin Route redirect
app.get('/admin', (req, res) => {
  res.redirect('/admin/index.html');
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`POTER EDUGAMES berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
