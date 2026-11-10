const { Resend } = require('resend');

const resendApiKey = process.env.RESEND_API_KEY || '';
const resend = resendApiKey ? new Resend(resendApiKey) : null;

async function sendPasswordResetEmail({ to, resetUrl }) {
  const fromAddress = process.env.EMAIL_FROM || 'POTER Edugames <onboarding@resend.dev>';

  const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Atur Ulang Kata Sandi</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #1E293B; }
        .card { max-width: 540px; margin: 0 auto; background: #FFFFFF; border-radius: 12px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .header { background: #1E3A8A; padding: 28px 24px; text-align: center; }
        .header h1 { color: #FFFFFF; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.02em; }
        .header p { color: #93C5FD; margin: 6px 0 0; font-size: 13px; }
        .body { padding: 32px 28px; line-height: 1.6; font-size: 15px; }
        .btn-wrap { text-align: center; margin: 30px 0; }
        .btn { display: inline-block; background-color: #1D4ED8; color: #FFFFFF !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; letter-spacing: 0.01em; box-shadow: 0 2px 4px rgba(29, 78, 216, 0.25); }
        .btn:hover { background-color: #1E40AF; }
        .note { background-color: #EFF6FF; border-left: 4px solid #3B82F6; padding: 14px 16px; border-radius: 4px; font-size: 13.5px; color: #1E40AF; margin: 24px 0; }
        .footer { padding: 20px 28px; background: #F1F5F9; border-top: 1px solid #E2E8F0; font-size: 12px; color: #64748B; text-align: center; line-height: 1.5; }
        .link-alt { word-break: break-all; color: #2563EB; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>POTER EDUGAMES</h1>
          <p>Portal Distribusi & Telemetri Resmi</p>
        </div>
        <div class="body">
          <p>Halo Administrator,</p>
          <p>Kami menerima permintaan untuk mengatur ulang kata sandi akun dashboard admin POTER Edugames yang terhubung ke email ini.</p>
          
          <div class="btn-wrap">
            <a href="${resetUrl}" class="btn" target="_blank" rel="noopener noreferrer">Atur Ulang Kata Sandi Saya</a>
          </div>

          <div class="note">
            <strong>Perhatian:</strong> Tautan pemulihan ini hanya berlaku selama <strong>15 menit</strong> dan hanya dapat digunakan 1 kali.
          </div>

          <p style="font-size: 13.5px; color: #475569;">
            Jika tombol di atas tidak dapat diklik, salin dan tempel tautan berikut ke peramban Anda:
            <br>
            <a href="${resetUrl}" class="link-alt">${resetUrl}</a>
          </p>

          <p style="font-size: 13px; color: #64748B; margin-top: 24px;">
            Jika Anda tidak meminta pengaturan ulang ini, Anda dapat mengabaikan email ini dengan aman. Kata sandi akun Anda tidak akan berubah.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} PT Poter Teknik Nusantara &bull; POTER Edugames Security
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Halo Administrator,\n\nKami menerima permintaan untuk mengatur ulang kata sandi dashboard admin POTER Edugames.\n\nBuka tautan berikut untuk membuat kata sandi baru (berlaku 15 menit):\n${resetUrl}\n\nJika Anda tidak meminta pengaturan ulang ini, abaikan email ini.\n\nPT Poter Teknik Nusantara`;

  if (!resend) {
    console.warn(`[MAILER] RESEND_API_KEY belum disetel. Simulasi pengiriman email ke ${to}:`);
    console.warn(`[MAILER] Tautan Reset: ${resetUrl}`);
    return { success: true, simulated: true };
  }

  const result = await resend.emails.send({
    from: fromAddress,
    to,
    subject: 'Atur Ulang Kata Sandi Admin - POTER Edugames',
    html,
    text
  });

  if (result.error) {
    console.error('[MAILER] Gagal mengirim email via Resend:', result.error);
    throw new Error(result.error.message || 'Gagal mengirim email reset.');
  }

  return { success: true, id: result.data?.id };
}

module.exports = { sendPasswordResetEmail };
