const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const cookieSecret = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
app.use(cookieParser(cookieSecret));

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

function recordAdminAudit(req, { user = null, category, action, details = '', status = 'success' }) {
  try {
    const actor = user || req.adminUser || {};
    const username = String(actor.username || req.body?.username || 'unknown').slice(0, 80);
    db.prepare(`
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

// Session store in memory (simple & robust for single-node / embedded app)
const activeSessions = new Map();

function requireAuth(req, res, next) {
  const token = req.cookies.poter_admin_token;
  if (!token || !activeSessions.has(token)) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir.' });
    }
    return res.redirect('/admin/login.html');
  }
  req.adminUser = activeSessions.get(token);
  next();
}

// Tracking middleware for public pages (auto log visits)
app.use((req, res, next) => {
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

      db.prepare(`
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
app.get('/api/versions', (req, res) => {
  try {
    const versions = db.prepare('SELECT * FROM app_versions ORDER BY is_latest DESC, id DESC').all();
    const formatted = versions.map(v => ({
      ...v,
      changelog: typeof v.changelog === 'string' ? JSON.parse(v.changelog || '[]') : v.changelog
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download APK handler. A download is recorded only after the complete APK
// response has been transferred without an error or client cancellation.
app.get(['/download', '/download/:version'], (req, res) => {
  try {
    const requestedVersion = req.params.version;
    let targetVersion;

    if (requestedVersion) {
      targetVersion = db.prepare('SELECT * FROM app_versions WHERE version_code = ?').get(requestedVersion);
    }

    if (!targetVersion) {
      targetVersion = db.prepare('SELECT * FROM app_versions WHERE is_latest = 1').get() ||
                      db.prepare('SELECT * FROM app_versions ORDER BY id DESC LIMIT 1').get();
    }

    if (!targetVersion) {
      return res.status(404).send('Versi APK tidak ditemukan di sistem.');
    }

    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || 'Unknown';
    const { os, browser, deviceType } = parseUserAgent(ua);

    const apkFilePath = path.join(__dirname, 'public', 'assets', 'apks', targetVersion.file_name);

    if (!fs.existsSync(apkFilePath)) {
      return res.status(404).send('Berkas APK untuk versi ini belum tersedia. Tidak ada unduhan yang dicatat.');
    }

    const fileSize = fs.statSync(apkFilePath).size;
    const apkHeader = Buffer.alloc(4);
    const apkDescriptor = fs.openSync(apkFilePath, 'r');
    fs.readSync(apkDescriptor, apkHeader, 0, apkHeader.length, 0);
    fs.closeSync(apkDescriptor);

    // APK is a ZIP archive. Reject tiny development placeholders so they can
    // never appear as genuine completed downloads in the admin dashboard.
    const isValidApk = fileSize >= 1024 * 1024 && apkHeader.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (!isValidApk) {
      return res.status(503).send('File APK asli belum tersedia. Silakan coba lagi setelah administrator mengunggah rilis resmi.');
    }

    if (req.method === 'HEAD') {
      return res.status(200)
        .set('Content-Type', 'application/vnd.android.package-archive')
        .set('Content-Length', String(fileSize))
        .end();
    }

    return res.download(apkFilePath, targetVersion.file_name, (err) => {
      if (err) {
        console.error('APK transfer did not complete:', err.message);
        if (!res.headersSent) {
          res.status(err.statusCode || 500).send('Unduhan tidak selesai dan tidak dicatat.');
        }
        return;
      }

      // A 206 response is only one byte-range segment (resume/probe), not a
      // complete file transfer, so it must not increase the real-download KPI.
      if (res.statusCode !== 200) return;

      const saveVerifiedDownload = db.transaction(() => {
        db.prepare(`
          INSERT INTO download_logs
            (version, ip, user_agent, os, browser, device_type, status, verified, bytes_sent)
          VALUES (?, ?, ?, ?, ?, ?, 'completed', 1, ?)
        `).run(targetVersion.version_code, ip, ua, os, browser, deviceType, fileSize);

        db.prepare(`
          UPDATE app_versions
          SET download_count = (
            SELECT COUNT(*) FROM download_logs
            WHERE version = ? AND status = 'completed' AND verified = 1
          )
          WHERE id = ?
        `).run(targetVersion.version_code, targetVersion.id);
      });

      saveVerifiedDownload();
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
app.post('/api/track/install', (req, res) => {
  try {
    const { version = 'v1.1.0', device_id = 'unknown', device_model = 'Android Device', os_version = 'Android' } = req.body;
    const ip = getClientIp(req);

    if (device_id !== 'unknown') {
      const existing = db.prepare(`
        SELECT id FROM install_logs
        WHERE version = ? AND device_id = ? AND verified = 1
        LIMIT 1
      `).get(version, device_id);
      if (existing) {
        return res.json({ success: true, duplicate: true, message: 'Pemasangan perangkat ini sudah pernah dicatat.' });
      }
    }

    db.prepare(`
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

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    recordAdminAudit(req, {
      user: { username: username || 'unknown' },
      category: 'authentication',
      action: 'LOGIN_FAILED',
      details: 'Username atau password kosong',
      status: 'denied'
    });
    return res.status(400).json({ success: false, message: 'Nama pengguna dan kata sandi wajib diisi.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordAdminAudit(req, {
      user: { username },
      category: 'authentication',
      action: 'LOGIN_FAILED',
      details: 'Kredensial tidak cocok',
      status: 'denied'
    });
    return res.status(401).json({ success: false, message: 'Nama pengguna atau kata sandi tidak cocok.' });
  }

  // Create session token
  const token = `poter_sess_${crypto.randomBytes(32).toString('hex')}`;
  activeSessions.set(token, {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: Date.now()
  });

  res.cookie('poter_admin_token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });

  recordAdminAudit(req, {
    user,
    category: 'authentication',
    action: 'LOGIN_SUCCESS',
    details: `Masuk sebagai ${user.role}`
  });

  res.json({ success: true, username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.poter_admin_token;
  if (token) {
    const session = activeSessions.get(token);
    if (session) {
      recordAdminAudit(req, {
        user: session,
        category: 'authentication',
        action: 'LOGOUT',
        details: 'Keluar dari dashboard admin'
      });
    }
    activeSessions.delete(token);
  }
  res.clearCookie('poter_admin_token');
  res.json({ success: true, message: 'Berhasil keluar.' });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies.poter_admin_token;
  if (!token || !activeSessions.has(token)) {
    return res.json({ authenticated: false });
  }
  const session = activeSessions.get(token);
  res.json({ authenticated: true, user: session });
});

// -------------------------------------------------------------
// ADMIN DASHBOARD ANALYTICS & LOGS (Protected)
// -------------------------------------------------------------

// Dashboard Stats & Metrics
app.get('/api/dashboard/stats', requireAuth, (req, res) => {
  try {
    const totalVisits = db.prepare('SELECT COUNT(*) as count FROM access_logs').get().count;
    const uniqueVisitors = db.prepare('SELECT COUNT(DISTINCT ip) as count FROM access_logs').get().count;
    const totalDownloads = db.prepare("SELECT COUNT(*) as count FROM download_logs WHERE verified = 1 AND status = 'completed'").get().count;
    const totalInstalls = db.prepare('SELECT COUNT(*) as count FROM install_logs WHERE verified = 1').get().count;

    // Today's numbers
    const todayVisits = db.prepare(`
      SELECT COUNT(*) as count FROM access_logs
      WHERE date(timestamp) = date('now')
    `).get().count;

    const todayDownloads = db.prepare(`
      SELECT COUNT(*) as count FROM download_logs
      WHERE verified = 1 AND status = 'completed' AND date(timestamp) = date('now')
    `).get().count;

    // Conversion rate
    const downloadRate = totalVisits > 0 ? ((totalDownloads / totalVisits) * 100).toFixed(1) : 0;
    const installRate = totalDownloads > 0 ? ((totalInstalls / totalDownloads) * 100).toFixed(1) : 0;

    // Daily trends (last 7 days)
    const dailyVisits = db.prepare(`
      SELECT date(timestamp) as date, COUNT(*) as visits
      FROM access_logs
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY date(timestamp)
      ORDER BY date(timestamp) ASC
    `).all();

    const dailyDownloads = db.prepare(`
      SELECT date(timestamp) as date, COUNT(*) as downloads
      FROM download_logs
      WHERE verified = 1 AND status = 'completed'
        AND timestamp >= datetime('now', '-7 days')
      GROUP BY date(timestamp)
      ORDER BY date(timestamp) ASC
    `).all();

    // OS Distribution
    const osDistribution = db.prepare(`
      SELECT os, COUNT(*) as count
      FROM access_logs
      GROUP BY os
      ORDER BY count DESC
      LIMIT 5
    `).all();

    // Device Type Distribution
    const deviceDistribution = db.prepare(`
      SELECT device_type, COUNT(*) as count
      FROM access_logs
      GROUP BY device_type
      ORDER BY count DESC
    `).all();

    // Downloads per version
    const versionDownloads = db.prepare(`
      SELECT version, COUNT(*) as count
      FROM download_logs
      WHERE verified = 1 AND status = 'completed'
      GROUP BY version
      ORDER BY count DESC
    `).all();

    // Recent 5 access logs
    const recentAccess = db.prepare(`
      SELECT id, ip, os, browser, device_type, path, referrer, timestamp
      FROM access_logs
      ORDER BY id DESC
      LIMIT 5
    `).all();

    // Recent 5 download logs
    const recentDownloads = db.prepare(`
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
app.get('/api/dashboard/access-logs', requireAuth, (req, res) => {
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
    const totalCount = db.prepare(countQuery).get(...params).total;
    const logs = db.prepare(query).all(...params, limit, offset);

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
app.get('/api/dashboard/download-logs', requireAuth, (req, res) => {
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
    const totalCount = db.prepare(countQuery).get(...params).total;
    const logs = db.prepare(query).all(...params, limit, offset);

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
app.get('/api/dashboard/install-logs', requireAuth, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;

    const totalCount = db.prepare('SELECT COUNT(*) as total FROM install_logs WHERE verified = 1').get().total;
    const logs = db.prepare('SELECT * FROM install_logs WHERE verified = 1 ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);

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
app.get('/api/dashboard/admin-audit-logs', requireAuth, (req, res) => {
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
    const total = db.prepare(`SELECT COUNT(*) AS total FROM admin_audit_logs${whereClause}`).get(...params).total;
    const logs = db.prepare(`
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

app.post('/api/dashboard/audit', requireAuth, (req, res) => {
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

  recordAdminAudit(req, {
    category: 'navigation',
    action: 'VIEW_SECTION',
    details: `Membuka tampilan: ${section}`
  });
  res.json({ success: true });
});

// CSV Export for Logs
app.get('/api/dashboard/export/:type', requireAuth, (req, res) => {
  const { type } = req.params;

  if (type === 'access') {
    const rows = db.prepare('SELECT id, ip, os, browser, device_type, path, referrer, timestamp FROM access_logs ORDER BY id DESC').all();
    let csv = 'ID,IP Address,OS,Browser,Device,Path,Referrer,Timestamp\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.ip}","${r.os}","${r.browser}","${r.device_type}","${r.path}","${r.referrer}","${r.timestamp}"\n`;
    });
    recordAdminAudit(req, {
      category: 'data_export',
      action: 'EXPORT_ACCESS_LOGS',
      details: `Mengekspor ${rows.length} log akses web`
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="poter_access_logs.csv"');
    return res.send(csv);
  } else if (type === 'downloads') {
    const rows = db.prepare(`
      SELECT id, version, ip, os, browser, device_type, bytes_sent, status, timestamp
      FROM download_logs
      WHERE verified = 1 AND status = 'completed'
      ORDER BY id DESC
    `).all();
    let csv = 'ID,Version,IP Address,OS,Browser,Device,Bytes Sent,Status,Timestamp\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.version}","${r.ip}","${r.os}","${r.browser}","${r.device_type}","${r.bytes_sent}","${r.status}","${r.timestamp}"\n`;
    });
    recordAdminAudit(req, {
      category: 'data_export',
      action: 'EXPORT_VERIFIED_DOWNLOADS',
      details: `Mengekspor ${rows.length} unduhan terverifikasi`
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="poter_download_logs.csv"');
    return res.send(csv);
  } else if (type === 'admin-audit') {
    const rows = db.prepare(`
      SELECT id, username, category, action, details, ip, status, timestamp
      FROM admin_audit_logs ORDER BY id DESC
    `).all();
    let csv = 'ID,Username,Category,Action,Details,IP,Status,Timestamp\n';
    rows.forEach(r => {
      const details = String(r.details || '').replaceAll('"', '""');
      csv += `"${r.id}","${r.username}","${r.category}","${r.action}","${details}","${r.ip}","${r.status}","${r.timestamp}"\n`;
    });
    recordAdminAudit(req, {
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

// Add New Game Version
app.post('/api/versions', requireAuth, (req, res) => {
  try {
    const { version_code, release_date, file_size, min_android, changelog, is_latest } = req.body;

    if (!version_code || !file_size) {
      return res.status(400).json({ success: false, message: 'Nomor versi dan ukuran file wajib diisi.' });
    }

    if (is_latest) {
      db.prepare('UPDATE app_versions SET is_latest = 0').run();
    }

    const changelogArray = Array.isArray(changelog) ? changelog : (changelog || '').split('\n').filter(Boolean);
    const fileName = `POTER-EDUGAMES-${version_code}.apk`;

    const stmt = db.prepare(`
      INSERT INTO app_versions (version_code, release_date, file_size, min_android, changelog, file_name, is_latest, download_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
      version_code,
      release_date || new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
      file_size,
      min_android || 'Android 8.0 (Oreo) ke atas',
      JSON.stringify(changelogArray),
      fileName,
      is_latest ? 1 : 0
    );

    recordAdminAudit(req, {
      category: 'version_management',
      action: 'CREATE_VERSION',
      details: `Menambahkan versi ${version_code}${is_latest ? ' sebagai versi utama' : ''}`
    });

    res.json({ success: true, message: `Versi ${version_code} berhasil ditambahkan.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Version Status (Set Latest)
app.put('/api/versions/:id', requireAuth, (req, res) => {
  try {
    const id = req.params.id;
    const { is_latest } = req.body;

    if (is_latest) {
      const version = db.prepare('SELECT version_code FROM app_versions WHERE id = ?').get(id);
      db.prepare('UPDATE app_versions SET is_latest = 0').run();
      db.prepare('UPDATE app_versions SET is_latest = 1 WHERE id = ?').run(id);
      recordAdminAudit(req, {
        category: 'version_management',
        action: 'SET_LATEST_VERSION',
        details: `Menetapkan ${version?.version_code || `ID ${id}`} sebagai versi utama`
      });
    }

    res.json({ success: true, message: 'Status versi berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Route redirect
app.get('/admin', (req, res) => {
  res.redirect('/admin/index.html');
});

// Start Server
app.listen(PORT, () => {
  console.log(`POTER EDUGAMES Web & Monitoring Portal berjalan di http://localhost:${PORT}`);
  console.log(`- Portal Download Publik : http://localhost:${PORT}`);
  console.log(`- Dashboard Pemantau    : http://localhost:${PORT}/admin`);
  console.log(`- Akun Admin Default    : admin / poter2026`);
});
