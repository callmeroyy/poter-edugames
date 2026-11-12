// ==============================================================
// POTER EDUGAMES — LANDING PAGE KACA CAIR (LIQUID GLASS SCRIPT)
// Interaksi Telepon Realistis, Ganti Modul, Fisika Fluida, & Tema
// ==============================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. Theme Toggle (Day / Night)
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('poter_liquid_theme', theme);
    if (themeIcon) {
      themeIcon.innerHTML = theme === 'light'
        ? '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    }
  }

  const savedTheme = localStorage.getItem('poter_liquid_theme') || 'dark';
  applyTheme(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // 2. Liquid Glass Caustic Light Tracker on Smartphone Stage
  const smartphoneStage = document.getElementById('smartphoneStage');
  if (smartphoneStage) {
    let mouseX = 50;
    let mouseY = 50;

    smartphoneStage.addEventListener('mousemove', (e) => {
      const rect = smartphoneStage.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      mouseX = Math.max(0, Math.min(100, x));
      mouseY = Math.max(0, Math.min(100, y));
      smartphoneStage.style.setProperty('--mouse-x', `${mouseX.toFixed(1)}%`);
      smartphoneStage.style.setProperty('--mouse-y', `${mouseY.toFixed(1)}%`);
    });

    smartphoneStage.addEventListener('mouseleave', () => {
      smartphoneStage.style.setProperty('--mouse-x', '50%');
      smartphoneStage.style.setProperty('--mouse-y', '50%');
    });
  }

  // Liquid Ripple Generator & Caustic Tracker on All Crystal Glass Cards
  function createCardRipple(targetEl, clientX, clientY) {
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const x = clientX ? (clientX - rect.left) : (rect.width / 2);
    const y = clientY ? (clientY - rect.top) : (rect.height / 2);

    const ripple = document.createElement('span');
    ripple.className = 'liquid-ripple-wave';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;

    targetEl.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  const allGlassCards = document.querySelectorAll(
    '.liquid-game-card, .spec-glass-card, .hero-smartphone-stage, .version-glass-item, .step-liquid-card, .faq-liquid-card, .parent-monitor-card'
  );

  allGlassCards.forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      createCardRipple(card, e.clientX, e.clientY);
    });

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--mouse-x', `${x.toFixed(1)}%`);
      card.style.setProperty('--mouse-y', `${y.toFixed(1)}%`);
    });
  });

  // Dynamic SVG Optical Refraction on pointer movement
  const ambientTurbulence = document.getElementById('ambientTurbulence');
  const ambientDisplacement = document.getElementById('ambientDisplacement');
  if (ambientTurbulence && ambientDisplacement) {
    let lastX = 0, lastY = 0;
    window.addEventListener('mousemove', (e) => {
      const speed = Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
      const scale = Math.min(20, 8 + speed * 0.12);
      ambientDisplacement.setAttribute('scale', scale.toFixed(1));
    }, { passive: true });
  }

  // 3. Realistic Smartphone Live Game Scenes Switcher
  const gameScenes = {
    pasangkan: {
      tag: 'Modul Memori 2D',
      name: 'Pasangkan Kartu Bergambar',
      cards: ['🐱', '🐰', '🐱', '🐰'],
      hint: 'Ketuk kartu untuk mencocokkan pasangan!'
    },
    kelompokkan: {
      tag: 'Modul Klasifikasi',
      name: 'Memilah Kue & Warna',
      cards: ['🧁', '🍪', '🍩', '🍰'],
      hint: 'Kelompokkan kue sesuai warna dan bentuk!'
    },
    timbangan: {
      tag: 'Modul Nalar Berat',
      name: 'Timbangan Pasar Tradisional',
      cards: ['⚖️', '🍎', '⚖️', '🍉'],
      hint: 'Tentukan sisi mana yang lebih berat!'
    },
    bukajalan: {
      tag: 'Modul Strategi',
      name: 'Buka Jalan Mobil',
      cards: ['🚗', '🚧', '🚙', '🏁'],
      hint: 'Geser rintangan balok untuk membuka jalur!'
    }
  };

  const gameTabBtns = document.querySelectorAll('.game-tab-btn');
  const gameTagEl = document.getElementById('gameSceneTag');
  const gameNameEl = document.getElementById('gameSceneName');
  const sceneCardsContainer = document.getElementById('sceneCardsContainer');
  const sceneHintEl = document.getElementById('sceneCaptionHint');

  function renderGameScene(key) {
    const data = gameScenes[key];
    if (!data) return;

    if (gameTagEl) gameTagEl.textContent = data.tag;
    if (gameNameEl) gameNameEl.textContent = data.name;
    if (sceneHintEl) sceneHintEl.textContent = data.hint;

    if (sceneCardsContainer) {
      sceneCardsContainer.innerHTML = data.cards.map((icon, idx) => `
        <button type="button" class="interactive-card-tile" data-index="${idx}" aria-label="Kartu ${icon}">
          <span>${icon}</span>
        </button>
      `).join('');

      // Add bounce ripple animation when tapping cards in the smartphone
      sceneCardsContainer.querySelectorAll('.interactive-card-tile').forEach(card => {
        card.addEventListener('click', () => {
          card.style.transform = 'scale(0.88)';
          setTimeout(() => {
            card.style.transform = '';
          }, 150);
        });
      });
    }
  }

  gameTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      gameTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const gameKey = btn.getAttribute('data-game');
      renderGameScene(gameKey);
    });
  });

  // Initial render of first scene
  renderGameScene('pasangkan');

  // 4. Download Action Tracking
  function trackDownload(version = 'v1.1.0', source = 'Landing Page') {
    try {
      const payload = JSON.stringify({ version, source, timestamp: new Date().toISOString() });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/track/download-click', blob);
      } else {
        fetch('/api/track/download-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(() => {});
      }
    } catch (_) {}
  }

  const downloadModal = document.getElementById('downloadModal');
  const downloadCloseBtn = document.getElementById('downloadCloseBtn');

  function openDownloadHelper(version = 'v1.1.0', source = 'Tombol Unduh') {
    trackDownload(version, source);
    if (downloadModal) {
      setTimeout(() => {
        downloadModal.classList.add('active');
      }, 400);
    }
  }

  document.querySelectorAll('a[href^="/download"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const source = btn.getAttribute('data-source') || btn.textContent.trim();
      const href = btn.getAttribute('href');
      const version = href.includes('/download/') ? href.replace('/download/', '') : 'v1.1.0';
      openDownloadHelper(version, source);
    });
  });

  if (downloadCloseBtn && downloadModal) {
    downloadCloseBtn.addEventListener('click', () => {
      downloadModal.classList.remove('active');
    });
    downloadModal.addEventListener('click', (e) => {
      if (e.target === downloadModal) downloadModal.classList.remove('active');
    });
  }

  // 5. QR Code Modal
  const qrModal = document.getElementById('qrModal');
  const btnOpenQr = document.getElementById('btnOpenQr');
  const qrCloseBtn = document.getElementById('qrCloseBtn');
  const qrDisplay = document.getElementById('qrDisplay');

  if (btnOpenQr && qrModal) {
    btnOpenQr.addEventListener('click', async () => {
      qrModal.classList.add('active');
      if (qrDisplay) {
        qrDisplay.innerHTML = '<div style="padding: 24px; color: var(--text-subtle);">Membuat QR Code resmi...</div>';
      }
      try {
        const res = await fetch('/api/qr');
        const json = await res.json();
        if (json.success && qrDisplay) {
          qrDisplay.innerHTML = `<img src="${json.qr}" alt="QR Unduh APK POTER" width="220" height="220" style="border-radius: 12px; background: white; padding: 8px;">`;
        }
      } catch (_) {
        if (qrDisplay) qrDisplay.innerHTML = '<div style="color: #EF4444; padding: 20px;">Gagal memuat QR Code.</div>';
      }
    });

    if (qrCloseBtn) {
      qrCloseBtn.addEventListener('click', () => qrModal.classList.remove('active'));
    }
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.classList.remove('active');
    });
  }

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (downloadModal) downloadModal.classList.remove('active');
      if (qrModal) qrModal.classList.remove('active');
    }
  });

  // ------------------------------------------------------------------
  // 7. PWA REGISTRATION & INSTALL PROMPT (HP & DESKTOP)
  // ------------------------------------------------------------------
  let swRegistration = null;
  let deferredInstallPrompt = null;
  const btnInstallPwa = document.getElementById('btnInstallPwa');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        swRegistration = reg;
        syncPushSubscriptionUi();
      })
      .catch((err) => console.warn('Service Worker gagal terdaftar:', err));
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstallPwa) {
      btnInstallPwa.style.display = 'inline-flex';
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (btnInstallPwa) {
      btnInstallPwa.textContent = 'Web App Terpasang';
      btnInstallPwa.disabled = true;
    }
  });

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          deferredInstallPrompt = null;
        }
        return;
      }
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIos) {
        alert('Untuk memasang di iPhone/iPad: Ketuk ikon Bagikan (Share) di Safari, lalu pilih "Tambah ke Layar Utama" (Add to Home Screen).');
      } else if (window.matchMedia('(display-mode: standalone)').matches) {
        alert('POTER EDUGAMES sudah terpasang sebagai Web App di perangkat ini.');
      } else {
        alert('Buka menu browser (titik tiga di pojok kanan atas), lalu pilih "Instal aplikasi" atau "Tambahkan ke layar utama".');
      }
    });
  }

  // ------------------------------------------------------------------
  // 8. WEB PUSH NOTIFICATIONS (UPDATE VERSI KE HP & DEVICE LAIN)
  // ------------------------------------------------------------------
  const btnTogglePush = document.getElementById('btnTogglePush');
  const btnTestPush = document.getElementById('btnTestPush');
  const pushStatusText = document.getElementById('pushStatusText');

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function getActiveSubscription() {
    if (!swRegistration || !('PushManager' in window)) return null;
    return swRegistration.pushManager.getSubscription();
  }

  async function syncPushSubscriptionUi() {
    if (!btnTogglePush || !pushStatusText) return;
    if (!('Notification' in window) || !('PushManager' in window)) {
      pushStatusText.textContent = 'Browser ini belum mendukung Web Push Notification. Gunakan Chrome/Edge/Safari PWA versi terbaru.';
      btnTogglePush.disabled = true;
      return;
    }

    const sub = await getActiveSubscription();
    if (sub) {
      btnTogglePush.textContent = 'Notifikasi Aktif (Matikan)';
      btnTogglePush.classList.add('subscribed');
      if (btnTestPush) btnTestPush.style.display = 'inline-flex';
      pushStatusText.textContent = 'Perangkat ini terdaftar. Anda akan langsung menerima notifikasi jika ada update versi APK baru.';
    } else {
      btnTogglePush.textContent = 'Aktifkan Notifikasi';
      btnTogglePush.classList.remove('subscribed');
      if (btnTestPush) btnTestPush.style.display = 'none';
      pushStatusText.textContent = 'Aktifkan notifikasi agar HP atau komputer ini langsung mendapat pemberitahuan otomatis saat versi APK terbaru dirilis.';
    }
  }

  if (btnTogglePush) {
    btnTogglePush.addEventListener('click', async () => {
      if (!swRegistration) {
        alert('Service Worker sedang disiapkan, mohon coba beberapa detik lagi.');
        return;
      }
      btnTogglePush.disabled = true;
      try {
        const existingSub = await getActiveSubscription();
        if (existingSub) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: existingSub.endpoint })
          });
          await existingSub.unsubscribe();
          await syncPushSubscriptionUi();
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          pushStatusText.textContent = 'Izin notifikasi ditolak di browser. Silakan izinkan notifikasi di setelan situs browser Anda.';
          return;
        }

        const keyRes = await fetch('/api/push/vapid-public-key');
        const keyJson = await keyRes.json();
        if (!keyJson.success || !keyJson.publicKey) {
          throw new Error('Kunci server notifikasi tidak tersedia.');
        }

        const newSub = await swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey)
        });

        const subRes = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: newSub.toJSON() })
        });
        const subJson = await subRes.json();
        if (!subJson.success) throw new Error(subJson.message || 'Gagal berlangganan.');

        await syncPushSubscriptionUi();
      } catch (err) {
        if (pushStatusText) pushStatusText.textContent = err.message || 'Gagal mengaktifkan notifikasi.';
      } finally {
        btnTogglePush.disabled = false;
      }
    });
  }

  if (btnTestPush) {
    btnTestPush.addEventListener('click', async () => {
      btnTestPush.disabled = true;
      try {
        const sub = await getActiveSubscription();
        if (!sub) return;
        const res = await fetch('/api/push/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
        const json = await res.json();
        if (pushStatusText) {
          pushStatusText.textContent = json.message || 'Notifikasi uji coba dikirim!';
        }
      } catch (err) {
        if (pushStatusText) pushStatusText.textContent = 'Gagal mengirim notifikasi uji coba.';
      } finally {
        btnTestPush.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------
  // 9. DYNAMIC VERSIONS LOADER
  // ------------------------------------------------------------------
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function loadLiveVersions() {
    const stack = document.getElementById('versionsStack');
    if (!stack) return;
    try {
      const res = await fetch('/api/versions');
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data) || json.data.length === 0) return;

      stack.innerHTML = json.data.map((v) => {
        let items = [];
        try {
          items = Array.isArray(v.changelog) ? v.changelog : JSON.parse(v.changelog || '[]');
        } catch {
          items = String(v.changelog || '').split('\n').filter(Boolean);
        }
        const isLatest = Boolean(v.is_latest);
        const listHtml = items.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
        return `
          <div class="version-glass-item${isLatest ? ' highlight' : ''}">
            <div class="version-info-left">
              <div class="version-tag-row">
                <span class="version-code-num">${escapeHtml(v.version_code)}</span>
                ${isLatest ? '<span class="version-badge-rec">TERBARU - DIREKOMENDASIKAN</span>' : ''}
              </div>
              <div class="version-submeta">
                ${escapeHtml(v.release_date)} • ${escapeHtml(v.file_size)} • ${escapeHtml(v.min_android)}
              </div>
              <ul class="version-changelog-list">${listHtml}</ul>
            </div>
            <a href="/download/${encodeURIComponent(v.version_code)}" class="btn-download-version${isLatest ? '' : ' secondary'}" data-source="Arsip Versi ${escapeHtml(v.version_code)}">
              Unduh APK ${escapeHtml(v.version_code)}
            </a>
          </div>
        `;
      }).join('');
    } catch (_) {}
  }

  loadLiveVersions();

  // ------------------------------------------------------------------
  // 10. SARAN & ULASAN DENGAN ANTI-SPAM (TANPA BINTANG)
  // ------------------------------------------------------------------
  const whatsappShareBtn = document.getElementById('whatsappShareBtn');
  if (whatsappShareBtn) {
    const shareText = `Ayo unduh game edukasi resmi POTER EDUGAMES untuk anak PAUD hingga SD disini: ${window.location.origin}/`;
    whatsappShareBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  }

  const reviewForm = document.getElementById('reviewForm');
  const reviewMessage = document.getElementById('reviewMessage');
  const reviewCharCount = document.getElementById('reviewCharCount');
  const challengeQuestionEl = document.getElementById('reviewChallengeQuestion');
  const challengeTokenEl = document.getElementById('reviewChallengeToken');
  const challengeAnswerEl = document.getElementById('reviewChallengeAnswer');
  const btnRefreshChallenge = document.getElementById('btnRefreshChallenge');
  const reviewFeedback = document.getElementById('reviewFeedback');
  const btnSubmitReview = document.getElementById('btnSubmitReview');
  const reviewsListContainer = document.getElementById('reviewsListContainer');
  const reviewsTotalCountEl = document.getElementById('reviewsTotalCount');

  const reviewAnonymous = document.getElementById('reviewAnonymous');
  const reviewNameInput = document.getElementById('reviewName');
  const btnLoadMoreReviews = document.getElementById('btnLoadMoreReviews');
  const reviewsInviteNote = document.getElementById('reviewsInviteNote');
  let reviewsOffset = 0;
  const REVIEWS_PAGE_SIZE = 5;

  if (reviewAnonymous && reviewNameInput) {
    reviewAnonymous.addEventListener('change', () => {
      if (reviewAnonymous.checked) {
        reviewNameInput.value = 'Anonim';
        reviewNameInput.disabled = true;
      } else {
        reviewNameInput.value = '';
        reviewNameInput.disabled = false;
        reviewNameInput.focus();
      }
    });
  }

  function getDeviceFingerprint() {
    let fp = localStorage.getItem('poter_fp');
    if (!fp) {
      fp = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem('poter_fp', fp);
    }
    return fp;
  }

  async function loadReviewChallenge() {
    if (!challengeQuestionEl || !challengeTokenEl) return;
    try {
      const res = await fetch('/api/reviews/challenge');
      const json = await res.json();
      if (json.success) {
        challengeQuestionEl.textContent = json.question;
        challengeTokenEl.value = json.token;
        if (challengeAnswerEl) challengeAnswerEl.value = '';
      }
    } catch (_) {
      challengeQuestionEl.textContent = 'Gagal memuat verifikasi';
    }
  }

  async function loadReviews(append = false) {
    if (!reviewsListContainer) return;
    if (!append) reviewsOffset = 0;
    try {
      const res = await fetch(`/api/reviews?limit=${REVIEWS_PAGE_SIZE}&offset=${reviewsOffset}`);
      const json = await res.json();
      if (!json.success) return;

      const total = json.stats?.total || 0;
      if (reviewsTotalCountEl) reviewsTotalCountEl.textContent = `${total} Masukan Masuk`;
      const statUlasan = document.getElementById('statUlasanCount');
      const statSaran = document.getElementById('statSaranCount');
      const statLaporan = document.getElementById('statLaporanCount');
      if (statUlasan) statUlasan.textContent = String(json.stats?.ulasanCount || 0);
      if (statSaran) statSaran.textContent = String(json.stats?.saranCount || 0);
      if (statLaporan) statLaporan.textContent = String(json.stats?.laporanCount || 0);
      if (reviewsInviteNote) reviewsInviteNote.style.display = total < 3 ? 'block' : 'none';
      if (btnLoadMoreReviews) btnLoadMoreReviews.style.display = json.hasMore ? 'block' : 'none';

      const items = json.reviews || [];
      if (!append && items.length === 0) {
        reviewsListContainer.innerHTML = '<p class="reviews-empty-hint">Belum ada saran atau ulasan. Jadilah yang pertama memberi ulasan untuk orang tua dan guru lainnya!</p>';
        return;
      }

      const html = items.map((item) => {
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        return `
          <article class="review-item-card">
            <div class="review-item-head">
              <div>
                <div class="review-item-author">${escapeHtml(item.name)}</div>
                <div class="review-item-meta">${escapeHtml(item.role)}${dateStr ? ' • ' + escapeHtml(dateStr) : ''}</div>
              </div>
              <span class="reviews-total-pill" style="font-size: 0.72rem; padding: 3px 9px;">${escapeHtml(item.category)}</span>
            </div>
            <p class="review-item-body">${escapeHtml(item.message)}</p>
          </article>
        `;
      }).join('');

      if (append) {
        reviewsListContainer.insertAdjacentHTML('beforeend', html);
      } else {
        reviewsListContainer.innerHTML = html;
      }
      reviewsOffset += items.length;
    } catch (_) {
      if (!append) reviewsListContainer.innerHTML = '<p class="reviews-empty-hint">Gagal memuat daftar ulasan.</p>';
    }
  }

  if (btnLoadMoreReviews) {
    btnLoadMoreReviews.addEventListener('click', () => loadReviews(true));
  }

  if (reviewMessage && reviewCharCount) {
    reviewMessage.addEventListener('input', () => {
      reviewCharCount.textContent = `(${reviewMessage.value.length}/500)`;
    });
  }

  if (btnRefreshChallenge) {
    btnRefreshChallenge.addEventListener('click', loadReviewChallenge);
  }

  if (reviewForm) {
    reviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (reviewFeedback) {
        reviewFeedback.className = 'review-feedback';
        reviewFeedback.textContent = '';
      }
      if (btnSubmitReview) btnSubmitReview.disabled = true;

      const isAnon = Boolean(reviewAnonymous?.checked);
      const payload = {
        name: isAnon ? 'Anonim' : (reviewNameInput?.value || ''),
        anonymous: isAnon,
        role: document.getElementById('reviewRole')?.value || 'Orang Tua',
        category: document.getElementById('reviewCategory')?.value || 'Ulasan',
        message: reviewMessage?.value || '',
        website: document.getElementById('reviewWebsite')?.value || '',
        challengeToken: challengeTokenEl?.value || '',
        challengeAnswer: challengeAnswerEl?.value || '',
        fingerprint: getDeviceFingerprint()
      };

      try {
        const res = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          if (reviewFeedback) {
            reviewFeedback.className = 'review-feedback error';
            reviewFeedback.textContent = json.message || 'Gagal mengirim ulasan.';
          }
          await loadReviewChallenge();
          return;
        }

        if (reviewFeedback) {
          reviewFeedback.className = 'review-feedback success';
          reviewFeedback.textContent = json.message;
        }
        reviewForm.reset();
        if (reviewNameInput) {
          reviewNameInput.value = '';
          reviewNameInput.disabled = false;
        }
        if (reviewAnonymous) reviewAnonymous.checked = false;
        if (reviewCharCount) reviewCharCount.textContent = '(0/500)';
        await Promise.all([loadReviews(false), loadReviewChallenge()]);
      } catch (_) {
        if (reviewFeedback) {
          reviewFeedback.className = 'review-feedback error';
          reviewFeedback.textContent = 'Terjadi gangguan koneksi saat mengirim ulasan.';
        }
      } finally {
        if (btnSubmitReview) btnSubmitReview.disabled = false;
      }
    });
  }

  loadReviewChallenge();
  loadReviews(false);
});
