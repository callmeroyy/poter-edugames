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
const { sendPasswordResetEmail } = require('./mailer');
const webpush = require('web-push');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const cookieSecret = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
app.use(cookieParser(cookieSecret));
app.use(async (req, res, next) => {
  const isDbRoute = req.path.startsWith('/api') || req.path.startsWith('/download');
  try {
    await db.ensureReady();
    next();
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    if (!isDbRoute) {
      return next();
    }
    res.status(503).json({ success: false, message: 'Database belum siap. Sedang menyambungkan ulang, silakan coba beberapa detik lagi.' });
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

// Serve static assets from public (index.html is the main web)
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

// QR opens the landing page first because mobile scanners often block direct APK responses.
app.get('/api/qr', async (req, res) => {
  try {
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const targetUrl = new URL('/?download=qr', `${protocol}://${host}`).toString();

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'H',
      margin: 4,
      width: 320,
      color: {
        dark: '#000000',
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

// Request Password Reset Link via Email (Resend)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Alamat email wajib diisi dengan format yang benar.' });
    }

    // Rate limiting: check recent requests in last 15 minutes
    const recentRequests = await db.prepare(`
      SELECT COUNT(*) AS count FROM password_resets
      WHERE created_at >= datetime('now', '-15 minutes')
    `).get();
    if (Number(recentRequests?.count || 0) > 10) {
      return res.status(429).json({
        success: false,
        message: 'Terlalu banyak permintaan reset kata sandi. Silakan tunggu beberapa saat lagi.'
      });
    }

    // Check matching user
    const user = await db.prepare('SELECT id, username, email FROM users WHERE LOWER(email) = ? OR (username = ? AND ? = ?)')
      .get(email, 'admin', email, 'poteredugames@gmail.com');

    if (!user) {
      return res.json({
        success: true,
        message: 'Jika email terdaftar, instruksi atur ulang kata sandi telah dikirim ke email Anda.'
      });
    }

    // Generate cryptographic random token (32 bytes)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await db.prepare(`
      INSERT INTO password_resets (user_id, email, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(user.id, email, tokenHash, expiresAt);

    // Build absolute reset URL
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const resetUrl = `${protocol}://${host}/admin/reset-password.html?token=${rawToken}`;

    await sendPasswordResetEmail({ to: email, resetUrl });

    await recordAdminAudit(req, {
      user,
      category: 'authentication',
      action: 'FORGOT_PASSWORD_REQUESTED',
      details: `Permintaan reset kata sandi dikirim ke ${email}`
    });

    res.json({
      success: true,
      message: 'Instruksi atur ulang kata sandi telah dikirim ke email Anda. Periksa kotak masuk (atau folder spam).'
    });
  } catch (err) {
    console.error('Forgot password route error:', err);
    res.status(500).json({
      success: false,
      message: 'Gagal memproses permintaan reset kata sandi.',
      error: err.message
    });
  }
});

// Verify validity of password reset token
app.post('/api/auth/verify-reset-token', async (req, res) => {
  try {
    const rawToken = String(req.body?.token || '').trim();
    if (!rawToken || rawToken.length < 32) {
      return res.status(400).json({ valid: false, message: 'Tautan pemulihan tidak valid.' });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const reset = await db.prepare(`
      SELECT id, email, expires_at, used_at FROM password_resets
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
    `).get(tokenHash);

    if (!reset) {
      return res.status(400).json({
        valid: false,
        message: 'Tautan pemulihan tidak valid atau sudah kedaluwarsa. Silakan ajukan tautan baru.'
      });
    }

    res.json({ valid: true, email: reset.email });
  } catch (err) {
    res.status(500).json({ valid: false, message: 'Gagal memverifikasi tautan.', error: err.message });
  }
});

// Execute Password Reset
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const rawToken = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!rawToken || rawToken.length < 32) {
      return res.status(400).json({ success: false, message: 'Tautan pemulihan tidak valid.' });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Kata sandi baru minimal harus 8 karakter.' });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const reset = await db.prepare(`
      SELECT id, user_id, email, expires_at, used_at FROM password_resets
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
    `).get(tokenHash);

    if (!reset) {
      return res.status(400).json({
        success: false,
        message: 'Tautan pemulihan tidak valid atau sudah kedaluwarsa. Silakan ajukan tautan baru.'
      });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);

    await db.transaction(async tx => {
      // 1. Update user password
      if (reset.user_id) {
        await tx.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.user_id);
      } else {
        await tx.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash, 'admin');
      }

      // 2. Mark token as used
      await tx.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(reset.id);

      // 3. Clear all active sessions to force re-login
      if (reset.user_id) {
        await tx.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(reset.user_id);
      } else {
        await tx.prepare('DELETE FROM admin_sessions WHERE username = ?').run('admin');
      }
    });

    await recordAdminAudit(req, {
      user: { id: reset.user_id, username: 'admin' },
      category: 'authentication',
      action: 'PASSWORD_RESET_SUCCESS',
      details: `Kata sandi berhasil diatur ulang via email pemulihan (${reset.email})`
    });

    res.json({
      success: true,
      message: 'Kata sandi Anda berhasil diperbarui! Silakan masuk dengan kata sandi baru Anda.'
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui kata sandi.',
      error: err.message
    });
  }
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
  } else if (type === 'installs') {
    const rows = await db.prepare('SELECT id, version, device_id, device_model, os_version, ip, timestamp FROM install_logs WHERE verified = 1 ORDER BY id DESC').all();
    let csv = 'ID,Version,Device ID,Device Model,OS Version,IP Address,Timestamp\n';
    rows.forEach(r => {
      csv += `"${r.id}","${r.version}","${r.device_id}","${r.device_model}","${r.os_version}","${r.ip}","${r.timestamp}"\n`;
    });
    await recordAdminAudit(req, {
      category: 'data_export',
      action: 'EXPORT_INSTALL_LOGS',
      details: `Mengekspor ${rows.length} log pemasangan game`
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="poter_install_logs.csv"');
    return res.send(csv);
  } else {
    res.status(400).send('Tipe ekspor tidak dikenali.');
  }
});

// Master Telemetry & Log Reset Handler (Protected by double confirmation)
app.post('/api/admin/reset', requireAuth, async (req, res) => {
  try {
    const { type, versionId, confirmKeyword } = req.body || {};

    if (String(confirmKeyword || '').trim().toUpperCase() !== 'RESET') {
      return res.status(400).json({
        success: false,
        message: 'Kata kunci konfirmasi salah. Harap ketik RESET untuk melanjutkan.'
      });
    }

    let message = '';
    let auditAction = '';
    let auditDetails = '';

    await db.transaction(async tx => {
      if (type === 'version_downloads') {
        if (!versionId) throw new Error('ID versi wajib disertakan untuk reset hitungan versi.');
        const version = await tx.prepare('SELECT * FROM app_versions WHERE id = ?').get(versionId);
        if (!version) throw new Error('Versi game tidak ditemukan.');

        const deletedLogs = await tx.prepare('DELETE FROM download_logs WHERE version = ?').run(version.version_code);
        await tx.prepare('UPDATE app_versions SET download_count = 0 WHERE id = ?').run(versionId);

        auditAction = 'RESET_VERSION_DOWNLOADS';
        auditDetails = `Mereset hitungan unduhan versi ${version.version_code} menjadi 0 (membersihkan ${deletedLogs.changes || 0} baris log unduhan)`;
        message = `Hitungan unduhan versi ${version.version_code} berhasil direset ke 0.`;
      } else if (type === 'access_logs') {
        const deleted = await tx.prepare('DELETE FROM access_logs').run();
        auditAction = 'CLEAR_ACCESS_LOGS';
        auditDetails = `Membersihkan seluruh riwayat kunjungan web (${deleted.changes || 0} baris data)`;
        message = `Seluruh riwayat kunjungan web (${deleted.changes || 0} baris) berhasil dibersihkan.`;
      } else if (type === 'download_logs') {
        const deleted = await tx.prepare('DELETE FROM download_logs').run();
        await tx.prepare('UPDATE app_versions SET download_count = 0').run();
        auditAction = 'CLEAR_DOWNLOAD_LOGS';
        auditDetails = `Membersihkan seluruh log unduhan (${deleted.changes || 0} baris data) dan mereset hitungan seluruh versi ke 0`;
        message = `Seluruh log unduhan terverifikasi (${deleted.changes || 0} baris) berhasil dibersihkan dan hitungan seluruh versi diatur ulang ke 0.`;
      } else if (type === 'install_logs') {
        const deleted = await tx.prepare('DELETE FROM install_logs').run();
        auditAction = 'CLEAR_INSTALL_LOGS';
        auditDetails = `Membersihkan seluruh log telemetri pemasangan (${deleted.changes || 0} baris data)`;
        message = `Seluruh data telemetri pemasangan (${deleted.changes || 0} baris) berhasil dibersihkan.`;
      } else if (type === 'all_telemetry') {
        const deletedAccess = await tx.prepare('DELETE FROM access_logs').run();
        const deletedDownloads = await tx.prepare('DELETE FROM download_logs').run();
        const deletedInstalls = await tx.prepare('DELETE FROM install_logs').run();
        await tx.prepare('UPDATE app_versions SET download_count = 0').run();

        const totalCleared = (deletedAccess.changes || 0) + (deletedDownloads.changes || 0) + (deletedInstalls.changes || 0);
        auditAction = 'PURGE_ALL_TELEMETRY';
        auditDetails = `Pembersihan massal seluruh telemetri: ${deletedAccess.changes || 0} akses, ${deletedDownloads.changes || 0} unduhan, ${deletedInstalls.changes || 0} pemasangan`;
        message = `Pembersihan massal selesai. Total ${totalCleared} baris riwayat berhasil dihapus dan seluruh metrik kembali ke 0.`;
      } else {
        throw new Error('Tipe pengaturan ulang (reset type) tidak dikenali.');
      }
    });

    await recordAdminAudit(req, {
      category: 'data_maintenance',
      action: auditAction,
      details: auditDetails
    });

    res.json({ success: true, message });
  } catch (err) {
    console.error('Data reset error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Gagal memproses pengaturan ulang data.',
      error: err.message
    });
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

    let pushResult = null;
    if (is_latest) {
      pushResult = await sendPushToAllSubscribers({
        title: `Update Baru POTER EDUGAMES ${version_code}`,
        body: `Versi ${version_code} (${file_size}) kini tersedia! Ketuk untuk mengunduh pembaruan.`,
        url: '/#versi',
        version: version_code
      });
    }

    res.json({
      success: true,
      message: `Versi ${version_code} berhasil ditambahkan.`,
      pushNotified: pushResult
    });
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

    let pushResult = null;
    if (hasLatestUpdate && is_latest && !version.is_latest) {
      pushResult = await sendPushToAllSubscribers({
        title: `Update Baru POTER EDUGAMES ${updated.version_code}`,
        body: `Versi ${updated.version_code} (${updated.file_size}) kini menjadi versi utama terbaru! Ketuk untuk mengunduh.`,
        url: '/#versi',
        version: updated.version_code
      });
    }

    res.json({ success: true, message: 'Versi berhasil diperbarui.', data: updated, pushNotified: pushResult });
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

// ==============================================================
// WEB PUSH (NOTIFIKASI UPDATE VERSI KE HP & DEVICE LAIN)
// ==============================================================
let cachedVapidKeys = null;

function hashClientIp(req) {
  const rawIp = String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  return crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 32);
}

async function getVapidKeys() {
  if (cachedVapidKeys) return cachedVapidKeys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cachedVapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim()
    };
  } else {
    const pubRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_public_key'").get();
    const privRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_private_key'").get();
    if (pubRow?.value && privRow?.value) {
      cachedVapidKeys = { publicKey: pubRow.value, privateKey: privRow.value };
    } else {
      const generated = webpush.generateVAPIDKeys();
      await db.prepare(`
        INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run('vapid_public_key', generated.publicKey);
      await db.prepare(`
        INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run('vapid_private_key', generated.privateKey);
      cachedVapidKeys = generated;
    }
  }
  webpush.setVapidDetails('mailto:poteredugames@gmail.com', cachedVapidKeys.publicKey, cachedVapidKeys.privateKey);
  return cachedVapidKeys;
}

async function sendPushToAllSubscribers(payload) {
  try {
    await getVapidKeys();
    const subs = await db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions').all();
    if (!subs.length) return { sent: 0, failed: 0, total: 0 };

    const message = JSON.stringify({
      title: payload.title || 'Update Baru POTER EDUGAMES',
      body: payload.body || 'Versi terbaru telah tersedia!',
      url: payload.url || '/landing-liquid.html#versi',
      version: payload.version || '',
      icon: '/assets/poter-logo.png'
    });

    let sent = 0;
    let failed = 0;
    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message
        ).then(async () => {
          sent++;
          await db.prepare('UPDATE push_subscriptions SET last_notified_at = CURRENT_TIMESTAMP WHERE id = ?').run(sub.id);
        }).catch(async err => {
          failed++;
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          }
          throw err;
        })
      )
    );
    return { sent, failed, total: results.length };
  } catch (err) {
    console.error('Push broadcast error:', err.message);
    return { sent: 0, failed: 0, total: 0, error: err.message };
  }
}

app.get('/api/push/vapid-public-key', async (req, res) => {
  try {
    const keys = await getVapidKeys();
    res.json({ success: true, publicKey: keys.publicKey });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat kunci notifikasi.' });
  }
});

app.get('/api/push/status', async (req, res) => {
  try {
    const row = await db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get();
    res.json({ success: true, subscriberCount: Number(row?.count || 0) });
  } catch (err) {
    res.status(500).json({ success: false, subscriberCount: 0 });
  }
});

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { subscription, device_label } = req.body || {};
    const endpoint = String(subscription?.endpoint || '').trim();
    const p256dh = String(subscription?.keys?.p256dh || '').trim();
    const auth = String(subscription?.keys?.auth || '').trim();

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ success: false, message: 'Data langganan notifikasi tidak lengkap.' });
    }

    const ua = String(req.headers['user-agent'] || '').slice(0, 250);
    const parsed = parseUserAgent(ua);
    const label = String(device_label || `${parsed.os} • ${parsed.browser}`).slice(0, 80);
    const ipHash = hashClientIp(req);

    const existing = await db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
    if (existing) {
      await db.prepare(`
        UPDATE push_subscriptions SET p256dh = ?, auth = ?, device_label = ?, user_agent = ?, ip_hash = ?
        WHERE id = ?
      `).run(p256dh, auth, label, ua, ipHash, existing.id);
    } else {
      await db.prepare(`
        INSERT INTO push_subscriptions (endpoint, p256dh, auth, device_label, user_agent, ip_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(endpoint, p256dh, auth, label, ua, ipHash);
    }

    const row = await db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get();
    res.json({
      success: true,
      message: 'Notifikasi update versi aktif di perangkat ini.',
      totalSubscribers: Number(row?.count || 0)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mendaftarkan notifikasi perangkat.' });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint) return res.status(400).json({ success: false, message: 'Endpoint wajib diisi.' });
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    res.json({ success: true, message: 'Notifikasi perangkat dinonaktifkan.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menonaktifkan notifikasi.' });
  }
});

app.post('/api/push/test', async (req, res) => {
  try {
    await getVapidKeys();
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint) {
      return res.status(400).json({ success: false, message: 'Perangkat belum berlangganan notifikasi.' });
    }
    const sub = await db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Langganan perangkat tidak ditemukan. Aktifkan notifikasi terlebih dahulu.' });
    }

    const latest = await db.prepare('SELECT version_code FROM app_versions WHERE is_latest = 1 AND deleted_at IS NULL LIMIT 1').get();
    const versionText = latest?.version_code || 'v1.1.0';

    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: 'Notifikasi POTER EDUGAMES Aktif!',
        body: `Perangkat ini siap menerima info update versi terbaru (saat ini: ${versionText}).`,
        url: '/#versi',
        version: versionText,
        icon: '/assets/poter-logo.png'
      })
    );

    res.json({ success: true, message: 'Notifikasi uji coba berhasil dikirim ke perangkat ini!' });
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      const endpoint = String(req.body?.endpoint || '').trim();
      if (endpoint) await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
      return res.status(410).json({ success: false, message: 'Langganan browser sudah kedaluwarsa. Silakan aktifkan ulang.' });
    }
    res.status(500).json({ success: false, message: 'Gagal mengirim notifikasi uji coba: ' + err.message });
  }
});

app.post('/api/admin/push/broadcast', requireAuth, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    const version = String(req.body?.version || '').trim();
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Judul dan isi notifikasi wajib diisi.' });
    }
    const result = await sendPushToAllSubscribers({
      title,
      body,
      version,
      url: '/landing-liquid.html#versi'
    });
    await recordAdminAudit(req, {
      category: 'push_notifications',
      action: 'BROADCAST_UPDATE_PUSH',
      details: `Mengirim notifikasi "${title}" ke ${result.sent}/${result.total} perangkat`
    });
    res.json({ success: true, message: `Notifikasi dikirim ke ${result.sent} perangkat.`, result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menyiarkan notifikasi.' });
  }
});

// ==============================================================
// SARAN & ULASAN DENGAN ANTI-SPAM MULTI-LAPIS
// ==============================================================
const usedChallengeNonces = new Map();

function pruneExpiredNonces() {
  const now = Date.now();
  for (const [nonce, exp] of usedChallengeNonces.entries()) {
    if (exp < now) usedChallengeNonces.delete(nonce);
  }
}

function signChallengePayload(payload) {
  const secret = process.env.COOKIE_SECRET || cookieSecret;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyReviewChallenge(token, userAnswer) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'Token verifikasi tidak valid. Muat ulang pertanyaan.' };
  }
  const [encoded, sig] = token.split('.');
  const secret = process.env.COOKIE_SECRET || cookieSecret;
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return { ok: false, reason: 'Verifikasi anti-spam tidak cocok.' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'Data verifikasi rusak.' };
  }

  const now = Date.now();
  if (now - Number(payload.iat) > 15 * 60 * 1000) {
    return { ok: false, reason: 'Pertanyaan verifikasi kedaluwarsa. Silakan muat ulang.' };
  }
  if (now - Number(payload.iat) < 3000) {
    return { ok: false, reason: 'Pengiriman terlalu cepat. Mohon baca formulir sejenak sebelum mengirim.' };
  }
  pruneExpiredNonces();
  if (usedChallengeNonces.has(payload.nonce)) {
    return { ok: false, reason: 'Pertanyaan verifikasi sudah digunakan. Gunakan pertanyaan baru.' };
  }
  if (Number(userAnswer) !== Number(payload.ans)) {
    return { ok: false, reason: 'Jawaban hitungan verifikasi salah. Coba lagi.' };
  }

  usedChallengeNonces.set(payload.nonce, Number(payload.iat) + 15 * 60 * 1000);
  return { ok: true };
}

function sanitizePlainText(str = '') {
  return String(str).replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

function containsSpamSignals(text = '') {
  if (/(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|xyz|info|biz|ru|cn|click|top)\b)/i.test(text)) {
    return 'Tautan atau URL tidak diperbolehkan pada kolom ulasan untuk mencegah spam.';
  }
  if (/(.)\1{7,}/.test(text)) {
    return 'Teks terdeteksi mengandung pengulangan karakter berlebihan.';
  }
  return null;
}

app.get('/api/reviews/challenge', (req, res) => {
  const a = crypto.randomInt(2, 10);
  const b = crypto.randomInt(1, 9);
  const nonce = crypto.randomBytes(10).toString('hex');
  const token = signChallengePayload({ ans: a + b, iat: Date.now(), nonce });
  res.json({ success: true, question: `Berapa ${a} + ${b}?`, token });
});

app.get('/api/reviews', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT id, name, role, rating, category, message, created_at
      FROM reviews
      WHERE status = 'approved'
      ORDER BY created_at DESC, id DESC
      LIMIT 30
    `).all();
    const stats = await db.prepare(`
      SELECT COUNT(*) AS total, COALESCE(AVG(rating), 0) AS avg_rating
      FROM reviews
      WHERE status = 'approved'
    `).get();
    res.json({
      success: true,
      reviews: rows,
      stats: {
        total: Number(stats?.total || 0),
        averageRating: Number(Number(stats?.avg_rating || 0).toFixed(1))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat ulasan.' });
  }
});

app.post('/api/reviews', async (req, res) => {
  try {
    const {
      name, role, rating, category, message,
      website, challengeToken, challengeAnswer, fingerprint
    } = req.body || {};

    // 1. Honeypot check (hidden input filled by bots)
    if (website && String(website).trim() !== '') {
      return res.status(400).json({ success: false, message: 'Permintaan ditolak oleh filter keamanan.' });
    }

    // 2. Signed math challenge + minimum human fill time check
    const challengeCheck = verifyReviewChallenge(challengeToken, challengeAnswer);
    if (!challengeCheck.ok) {
      return res.status(400).json({ success: false, message: challengeCheck.reason });
    }

    // 3. Input validation & sanitization
    const cleanName = sanitizePlainText(name);
    const cleanMessage = sanitizePlainText(message);
    const cleanRole = ['Orang Tua', 'Guru / Pendidik', 'Lainnya'].includes(role) ? role : 'Orang Tua';
    const cleanCategory = ['Ulasan', 'Saran', 'Laporan'].includes(category) ? category : 'Ulasan';
    const numRating = Math.min(5, Math.max(1, parseInt(rating, 10) || 5));

    if (cleanName.length < 2 || cleanName.length > 50) {
      return res.status(400).json({ success: false, message: 'Nama harus antara 2 hingga 50 karakter.' });
    }
    if (cleanMessage.length < 10 || cleanMessage.length > 500) {
      return res.status(400).json({ success: false, message: 'Saran atau ulasan minimal 10 karakter dan maksimal 500 karakter.' });
    }

    const spamReason = containsSpamSignals(`${cleanName} ${cleanMessage}`);
    if (spamReason) {
      return res.status(400).json({ success: false, message: spamReason });
    }

    // 4. Rate limiting per IP & fingerprint (cooldown 3 minutes + max 3 per 24h)
    const ipHash = hashClientIp(req);
    const cleanFp = String(fingerprint || '').slice(0, 64);

    const recentSame = await db.prepare(`
      SELECT id FROM reviews
      WHERE (ip_hash = ? OR (fingerprint != '' AND fingerprint = ?))
        AND created_at >= datetime('now', '-3 minutes')
      LIMIT 1
    `).get(ipHash, cleanFp);
    if (recentSame) {
      return res.status(429).json({
        success: false,
        message: 'Mohon tunggu 3 menit sebelum mengirim saran atau ulasan berikutnya.'
      });
    }

    const dailyCountRow = await db.prepare(`
      SELECT COUNT(*) AS count FROM reviews
      WHERE ip_hash = ? AND created_at >= datetime('now', '-1 day')
    `).get(ipHash);
    if (Number(dailyCountRow?.count || 0) >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Batas pengiriman harian (maksimal 3 ulasan per hari) telah tercapai.'
      });
    }

    // 5. Duplicate message prevention (last 24 hours)
    const duplicate = await db.prepare(`
      SELECT id FROM reviews
      WHERE LOWER(message) = LOWER(?) AND created_at >= datetime('now', '-1 day')
      LIMIT 1
    `).get(cleanMessage);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: 'Saran atau ulasan yang sama sudah pernah dikirim sebelumnya.'
      });
    }

    await db.prepare(`
      INSERT INTO reviews (name, role, rating, category, message, ip_hash, fingerprint, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')
    `).run(cleanName, cleanRole, numRating, cleanCategory, cleanMessage, ipHash, cleanFp);

    res.json({
      success: true,
      message: 'Terima kasih! Saran dan ulasan Anda telah berhasil diterbitkan.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan ulasan.', error: err.message });
  }
});

app.get('/api/admin/reviews', requireAuth, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT id, name, role, category, message, status, created_at
      FROM reviews
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat daftar saran & ulasan.' });
  }
});

app.delete('/api/admin/reviews/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    await db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    await recordAdminAudit(req, {
      category: 'reviews_moderation',
      action: 'DELETE_REVIEW',
      details: `Menghapus ulasan ID #${id}`
    });
    res.json({ success: true, message: 'Ulasan berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus ulasan.' });
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
