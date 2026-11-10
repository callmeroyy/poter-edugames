import { uploadPresigned } from '@vercel/blob/client';

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

function safePathPart(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

async function uploadApk({ file, versionCode, onProgress }) {
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.apk')) {
    throw new Error('Pilih berkas dengan ekstensi .apk.');
  }

  const safeVersion = safePathPart(versionCode, 'versi-baru');
  const pathname = `apks/${safeVersion}/POTER-EDUGAMES-${safeVersion}.apk`;

  return uploadPresigned(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/admin/apk-upload',
    clientPayload: JSON.stringify({ versionCode: String(versionCode || '').trim() }),
    contentType: APK_CONTENT_TYPE,
    multipart: file.size >= 100 * 1024 * 1024,
    onUploadProgress: typeof onProgress === 'function' ? onProgress : undefined
  });
}

window.PoterApkUpload = Object.freeze({ uploadApk });
