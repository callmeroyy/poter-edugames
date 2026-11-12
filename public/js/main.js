// POTER EDUGAMES - Client Interactions, Phone App Preview, & Day/Night Pull-Cord

document.addEventListener('DOMContentLoaded', () => {
  // -----------------------------------------------------------
  // 1. Day / Night Pull-Cord Switcher (Drag Physics & Celestial Morph)
  // -----------------------------------------------------------
  const pullCordWrap = document.getElementById('pullCordWrap');
  const cordHandle = document.getElementById('cordHandle');
  const cordString = document.getElementById('cordString');
  const cordThread = document.getElementById('cordThread');
  const cordThreadShadow = document.getElementById('cordThreadShadow');
  const cordThreadFiber = document.getElementById('cordThreadFiber');
  const cordTooltip = document.getElementById('cordTooltip');
  const celestialOrb = document.getElementById('celestialOrb');
  const cordPaths = [cordThreadShadow, cordThread, cordThreadFiber].filter(Boolean);

  // Load saved theme or time-based default
  let currentTheme = localStorage.getItem('poter_theme');
  if (!currentTheme) {
    const hour = new Date().getHours();
    currentTheme = (hour >= 18 || hour < 6) ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('poter_theme', theme);
    if (cordTooltip) {
      cordTooltip.textContent = theme === 'dark' 
        ? 'Tarik tali: Ganti Mode Siang (Matahari)' 
        : 'Tarik tali: Ganti Mode Malam (Bulan)';
    }
  }

  let themeAudioContext = null;

  function playThemeSound(theme) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      themeAudioContext ??= new AudioContextClass();
      if (themeAudioContext.state === 'suspended') themeAudioContext.resume();

      const now = themeAudioContext.currentTime;
      const notes = theme === 'dark' ? [523.25, 392] : [440, 659.25];

      notes.forEach((frequency, index) => {
        const start = now + (index * 0.11);
        const oscillator = themeAudioContext.createOscillator();
        const gain = themeAudioContext.createGain();

        oscillator.type = index === 0 ? 'sine' : 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.035, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

        oscillator.connect(gain);
        gain.connect(themeAudioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.3);
      });
    } catch (error) {
      console.warn('Suara tema tidak tersedia:', error);
    }
  }

  applyTheme(currentTheme);

  // --- Drag-based Pull-Cord Interaction ---
  const PULL_THRESHOLD = 40;
  const MIN_CORD_LENGTH = 28;
  const MAX_CORD_LENGTH = 190;
  const MAX_CORD_ANGLE = 72;

  let cordDragging = false;
  let cordStartY = 0;
  let cordStartX = 0;
  let cordPullDist = 0;
  let cordBaseHeight = 88;
  let cordCurve = 0;
  let activeCordPointerId = null;

  function drawCord(length, curve = 0) {
    if (!cordString || cordPaths.length === 0) return;
    const safeLength = Math.max(1, length);
    const controlX = 16 + curve;
    const path = `M16 0 Q${controlX.toFixed(2)} ${(safeLength * 0.52).toFixed(2)} 16 ${safeLength.toFixed(2)}`;
    cordString.setAttribute('viewBox', `0 0 32 ${safeLength.toFixed(2)}`);
    cordPaths.forEach(item => item.setAttribute('d', path));
  }

  function relaxCordCurve(fromCurve) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cordCurve = 0;
      drawCord(88, 0);
      return;
    }

    const startedAt = performance.now();
    const duration = 480;

    function step(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const decay = Math.cos(progress * Math.PI * 2.5) * Math.pow(1 - progress, 2);
      cordCurve = fromCurve * decay;
      drawCord(88, cordCurve);
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  drawCord(cordBaseHeight, 0);

  function cordDragStart(e) {
    if (!pullCordWrap || !cordHandle || !cordString) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    e.preventDefault();
    cordDragging = true;
    activeCordPointerId = e.pointerId;
    cordStartY = e.clientY;
    cordStartX = e.clientX;
    cordPullDist = 0;
    cordBaseHeight = cordString.getBoundingClientRect().height;
    cordHandle.setPointerCapture(e.pointerId);

    pullCordWrap.classList.add('is-dragging');
    pullCordWrap.classList.remove('is-snapping');

    cordString.style.transition = 'none';
  }

  function cordDragMove(e) {
    if (!cordDragging || e.pointerId !== activeCordPointerId) return;
    e.preventDefault();

    const deltaY = e.clientY - cordStartY;
    const deltaX = e.clientX - cordStartX;

    cordPullDist = Math.max(0, deltaY);
    const endpointY = Math.max(18, cordBaseHeight + deltaY);
    const requestedLength = Math.hypot(deltaX, endpointY);
    const cordLength = requestedLength > MAX_CORD_LENGTH
      ? MAX_CORD_LENGTH + Math.min(28, (requestedLength - MAX_CORD_LENGTH) * 0.12)
      : Math.max(MIN_CORD_LENGTH, requestedLength);
    const pointerAngle = -(Math.atan2(deltaX, endpointY) * 180 / Math.PI);
    const freeAngle = Math.max(-MAX_CORD_ANGLE, Math.min(MAX_CORD_ANGLE, pointerAngle));

    cordString.style.height = `${cordLength}px`;
    cordCurve += ((Math.max(-12, Math.min(12, deltaX * 0.14))) - cordCurve) * 0.38;
    drawCord(cordLength, cordCurve);
    pullCordWrap.style.transform = `rotate(${freeAngle}deg)`;
  }

  function cordDragEnd(e, allowToggle = true) {
    if (!cordDragging || e.pointerId !== activeCordPointerId) return;

    if (cordHandle.hasPointerCapture(e.pointerId)) {
      cordHandle.releasePointerCapture(e.pointerId);
    }

    cordDragging = false;
    activeCordPointerId = null;
    pullCordWrap.classList.remove('is-dragging');
    pullCordWrap.classList.add('is-snapping');

    cordString.style.transition = '';
    cordString.style.height = '';
    pullCordWrap.style.transform = '';
    relaxCordCurve(cordCurve);

    if (allowToggle && cordPullDist >= PULL_THRESHOLD) {
      const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
      playThemeSound(newTheme);

      // Burst animation on the celestial orb
      if (celestialOrb) {
        celestialOrb.classList.remove('burst');
        void celestialOrb.offsetWidth; // force reflow
        celestialOrb.classList.add('burst');
        celestialOrb.addEventListener('animationend', () => {
          celestialOrb.classList.remove('burst');
        }, { once: true });
      }

      const label = newTheme === 'dark' ? 'Mode Malam (Bulan) diaktifkan' : 'Mode Siang (Matahari) diaktifkan';
      showToast(`✨ ${label}`);
    }

    // Clean up snapping class after animation
    setTimeout(() => {
      pullCordWrap.classList.remove('is-snapping');
    }, 550);

    cordPullDist = 0;
  }

  if (cordHandle) {
    cordHandle.addEventListener('pointerdown', cordDragStart);
    cordHandle.addEventListener('pointermove', cordDragMove);
    cordHandle.addEventListener('pointerup', cordDragEnd);
    cordHandle.addEventListener('pointercancel', (e) => cordDragEnd(e, false));

    // Keyboard: Enter/Space to toggle (no drag needed)
    cordHandle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        playThemeSound(newTheme);
        if (celestialOrb) {
          celestialOrb.classList.remove('burst');
          void celestialOrb.offsetWidth;
          celestialOrb.classList.add('burst');
          celestialOrb.addEventListener('animationend', () => {
            celestialOrb.classList.remove('burst');
          }, { once: true });
        }
        const label = newTheme === 'dark' ? 'Mode Malam (Bulan) diaktifkan' : 'Mode Siang (Matahari) diaktifkan';
        showToast(`✨ ${label}`);
      }
    });
  }

  // -----------------------------------------------------------
  // 2. Modal & Navigation Elements
  // -----------------------------------------------------------
  const qrModal = document.getElementById('qrModal');
  const btnQrCode = document.getElementById('btnQrCode');
  const qrCloseBtn = document.getElementById('qrCloseBtn');
  const qrDisplayArea = document.getElementById('qrDisplayArea');

  const downloadModal = document.getElementById('downloadModal');
  const downloadCloseBtn = document.getElementById('downloadCloseBtn');
  const mainDownloadBtn = document.getElementById('mainDownloadBtn');
  const navDownloadBtn = document.getElementById('navDownloadBtn');

  const btnCopyLink = document.getElementById('btnCopyLink');
  const btnShareWa = document.getElementById('btnShareWa');
  const toastMessage = document.getElementById('toastMessage');

  // Show Toast Notification
  function showToast(message) {
    if (!toastMessage) return;
    toastMessage.textContent = message;
    toastMessage.classList.add('show');
    setTimeout(() => {
      toastMessage.classList.remove('show');
    }, 3200);
  }

  // Handle QR Modal
  if (btnQrCode && qrModal) {
    btnQrCode.addEventListener('click', async () => {
      qrModal.classList.add('active');
      qrDisplayArea.innerHTML = '<div style="padding: 30px; color: #64748b; font-size: 0.9rem;">Membuat kode QR resmi...</div>';
      
      try {
        const res = await fetch('/api/qr');
        const data = await res.json();
        if (data.success) {
          const qrImage = document.createElement('img');
          qrImage.src = data.qr;
          qrImage.alt = 'QR Code menuju halaman unduh POTER EDUGAMES';
          qrImage.width = 260;
          qrImage.height = 260;

          const fallbackLink = document.createElement('a');
          fallbackLink.href = data.url;
          fallbackLink.className = 'qr-fallback-link';
          fallbackLink.textContent = 'Buka halaman unduh di perangkat ini';

          qrDisplayArea.replaceChildren(qrImage, fallbackLink);
        } else {
          qrDisplayArea.innerHTML = '<div style="color: #dc2626; padding: 20px;">Gagal memuat kode QR.</div>';
        }
      } catch (err) {
        qrDisplayArea.innerHTML = '<div style="color: #dc2626; padding: 20px;">Gagal terhubung ke server.</div>';
      }
    });

    qrCloseBtn.addEventListener('click', () => {
      qrModal.classList.remove('active');
    });

    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) {
        qrModal.classList.remove('active');
      }
    });
  }

  const modalDownloadBtn = document.getElementById('modalDownloadBtn');

  // Telemetry: Deteksi dan kirim event klik tombol unduh seketika
  function trackDownloadClick(version, source) {
    const v = version || 'v1.1.0';
    const s = source || 'Tombol Unduh';
    try {
      const payload = JSON.stringify({ version: v, source: s, timestamp: new Date().toISOString() });
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
    } catch (err) {
      console.warn('Gagal mencatat klik unduh:', err);
    }
  }

  // Handle Download Action: Deteksi tombol ditekan + Tampilkan dialog
  function handleDownloadAction(version, source) {
    const v = version || 'v1.1.0';
    const s = source || 'Tombol Unduh';
    trackDownloadClick(v, s);
    showToast('📥 Unduhan terdeteksi: POTER EDUGAMES ' + v + ' (' + s + ')');
    if (downloadModal) {
      setTimeout(() => {
        downloadModal.classList.add('active');
      }, 500);
    }
  }

  if (mainDownloadBtn) {
    mainDownloadBtn.addEventListener('click', () => {
      const version = document.getElementById('specVersion')?.textContent?.trim() || 'v1.1.0';
      handleDownloadAction(version, 'Tombol Hero Utama');
    });
  }

  if (navDownloadBtn) {
    navDownloadBtn.addEventListener('click', () => {
      const version = document.getElementById('specVersion')?.textContent?.trim() || 'v1.1.0';
      handleDownloadAction(version, 'Navigasi Header');
    });
  }

  if (modalDownloadBtn) {
    modalDownloadBtn.addEventListener('click', () => {
      const version = document.getElementById('specVersion')?.textContent?.trim() || 'v1.1.0';
      handleDownloadAction(version, 'Modal Unduh Ulang');
    });
  }

  if (downloadCloseBtn && downloadModal) {
    downloadCloseBtn.addEventListener('click', () => {
      downloadModal.classList.remove('active');
    });

    downloadModal.addEventListener('click', (e) => {
      if (e.target === downloadModal) {
        downloadModal.classList.remove('active');
      }
    });
  }

  // -----------------------------------------------------------
  // Mobile Navigation Drawer (Android & Mobile Devices)
  // -----------------------------------------------------------
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const mobileNavDrawer = document.getElementById('mobileNavDrawer');
  const mobileDrawerBackdrop = document.getElementById('mobileDrawerBackdrop');
  const mobileDrawerClose = document.getElementById('mobileDrawerClose');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
  const mobileDrawerDownloadBtn = document.getElementById('mobileDrawerDownloadBtn');

  function openMobileMenu() {
    if (!mobileNavDrawer || !mobileMenuToggle) return;
    mobileNavDrawer.classList.add('is-open');
    mobileNavDrawer.setAttribute('aria-hidden', 'false');
    mobileDrawerBackdrop?.classList.add('is-open');
    mobileMenuToggle.setAttribute('aria-expanded', 'true');
    mobileMenuToggle.setAttribute('aria-label', 'Tutup menu navigasi');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileMenu() {
    if (!mobileNavDrawer || !mobileMenuToggle) return;
    mobileNavDrawer.classList.remove('is-open');
    mobileNavDrawer.setAttribute('aria-hidden', 'true');
    mobileDrawerBackdrop?.classList.remove('is-open');
    mobileMenuToggle.setAttribute('aria-expanded', 'false');
    mobileMenuToggle.setAttribute('aria-label', 'Buka menu navigasi');
    document.body.style.overflow = '';
  }

  mobileMenuToggle?.addEventListener('click', () => {
    const isOpen = mobileNavDrawer?.classList.contains('is-open');
    if (isOpen) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });

  mobileDrawerClose?.addEventListener('click', closeMobileMenu);
  mobileDrawerBackdrop?.addEventListener('click', closeMobileMenu);

  mobileNavLinks.forEach(link => {
    link.addEventListener('click', () => {
      closeMobileMenu();
    });
  });

  if (mobileDrawerDownloadBtn) {
    mobileDrawerDownloadBtn.addEventListener('click', () => {
      closeMobileMenu();
      const version = document.getElementById('specVersion')?.textContent?.trim() || 'v1.1.0';
      handleDownloadAction(version, 'Menu Drawer Mobile');
    });
  }

  // Escape key closes open modals and mobile menu (Keyboard Accessibility - antislop R-32)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (qrModal) qrModal.classList.remove('active');
      if (downloadModal) downloadModal.classList.remove('active');
      if (mobileNavDrawer && mobileNavDrawer.classList.contains('is-open')) {
        closeMobileMenu();
      }
    }
  });

  // Handle Copy Link
  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Tautan laman resmi berhasil disalin!');
      } catch (err) {
        const input = document.createElement('input');
        input.value = window.location.href;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('Tautan laman resmi berhasil disalin!');
      }
    });
  }

  // Handle WhatsApp Share Link
  if (btnShareWa) {
    const currentUrl = encodeURIComponent(window.location.href);
    btnShareWa.href = `https://api.whatsapp.com/send?text=Ayo%20unduh%20game%20edukasi%20resmi%20POTER%20EDUGAMES%20untuk%20anak%20PAUD%20hingga%20SD%20disini%3A%20${currentUrl}`;
  }

  // -----------------------------------------------------------
  // 3. Looping Phone Story
  // -----------------------------------------------------------
  const phoneDemo = document.querySelector('.phone-demo');
  const phoneDemoScenes = Array.from(document.querySelectorAll('.phone-scene'));
  const phoneScreen = document.getElementById('phoneScreen');
  const phoneDemoToggle = document.getElementById('phoneDemoToggle');
  const phoneDemoControlText = document.getElementById('phoneDemoControlText');
  const phoneDemoControlIcon = document.getElementById('phoneDemoControlIcon');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phoneDemoDurations = [1700, 3400, 3000, 2800, 1900];

  let phoneDemoIndex = 0;
  let phoneDemoTimer = null;
  let phoneDemoStartedAt = 0;
  let phoneDemoRemaining = phoneDemoDurations[0];
  let phoneDemoPaused = false;
  let phoneDemoHasStarted = false;

  function setPhoneDemoIcon(mode) {
    if (!phoneDemoControlIcon) return;
    const path = phoneDemoControlIcon.querySelector('path');
    if (!path) return;
    path.setAttribute('d', mode === 'pause' ? 'M9 5v14M15 5v14' : 'm8 5 11 7-11 7z');
  }

  function setPhoneDemoScene(index) {
    phoneDemoIndex = index;
    const activeSceneName = phoneDemoScenes[index]?.dataset.scene || '';
    const isBrandScene = activeSceneName === 'splash' || activeSceneName === 'outro';

    phoneScreen?.classList.toggle('is-brand-scene', isBrandScene);
    phoneScreen?.classList.toggle('is-outro-scene', activeSceneName === 'outro');

    phoneDemoScenes.forEach((scene, sceneIndex) => {
      const isActive = sceneIndex === index;
      scene.classList.toggle('is-active', isActive);
      scene.setAttribute('aria-hidden', String(!isActive));
    });

  }

  function schedulePhoneDemo() {
    if (prefersReducedMotion || phoneDemoPaused) return;

    phoneDemoStartedAt = performance.now();
    phoneDemoTimer = window.setTimeout(() => {
      const nextIndex = (phoneDemoIndex + 1) % phoneDemoScenes.length;
      setPhoneDemoScene(nextIndex);
      phoneDemoRemaining = phoneDemoDurations[nextIndex];
      schedulePhoneDemo();
    }, phoneDemoRemaining);
  }

  function startPhoneDemo() {
    window.clearTimeout(phoneDemoTimer);
    phoneDemoIndex = 0;
    phoneDemoRemaining = phoneDemoDurations[0];
    phoneDemoPaused = false;
    phoneDemoHasStarted = true;
    phoneDemo?.classList.remove('is-paused');
    setPhoneDemoScene(0);

    if (phoneDemoControlText) phoneDemoControlText.textContent = 'Jeda animasi';
    if (phoneDemoToggle) {
      phoneDemoToggle.setAttribute('aria-label', 'Jeda animasi POTER');
    }
    setPhoneDemoIcon('pause');
    schedulePhoneDemo();
  }

  function pausePhoneDemo() {
    if (!phoneDemoTimer) return;

    const elapsed = performance.now() - phoneDemoStartedAt;
    phoneDemoRemaining = Math.max(0, phoneDemoRemaining - elapsed);
    window.clearTimeout(phoneDemoTimer);
    phoneDemoTimer = null;
    phoneDemoPaused = true;
    phoneDemo?.classList.add('is-paused');

    if (phoneDemoControlText) phoneDemoControlText.textContent = 'Lanjutkan animasi';
    if (phoneDemoToggle) {
      phoneDemoToggle.setAttribute('aria-label', 'Lanjutkan animasi POTER');
    }
    setPhoneDemoIcon('play');
  }

  function resumePhoneDemo() {
    phoneDemoPaused = false;
    phoneDemo?.classList.remove('is-paused');

    if (phoneDemoControlText) phoneDemoControlText.textContent = 'Jeda animasi';
    if (phoneDemoToggle) {
      phoneDemoToggle.setAttribute('aria-label', 'Jeda animasi POTER');
    }
    setPhoneDemoIcon('pause');
    schedulePhoneDemo();
  }

  if (phoneDemoScenes.length > 0) {
    setPhoneDemoScene(prefersReducedMotion ? 1 : 0);

    if (prefersReducedMotion) {
      if (phoneDemoControlText) phoneDemoControlText.textContent = 'Tampilan Berikutnya';
      if (phoneDemoToggle) phoneDemoToggle.setAttribute('aria-label', 'Lihat tampilan aplikasi berikutnya');
      setPhoneDemoIcon('play');
    } else if ('IntersectionObserver' in window && phoneDemo) {
      const phoneDemoObserver = new IntersectionObserver((entries, observer) => {
        if (entries.some(entry => entry.isIntersecting) && !phoneDemoHasStarted) {
          startPhoneDemo();
          observer.disconnect();
        }
      }, { threshold: 0.35 });
      phoneDemoObserver.observe(phoneDemo);
    } else {
      startPhoneDemo();
    }
  }

  phoneDemoToggle?.addEventListener('click', () => {
    if (prefersReducedMotion) {
      const nextIndex = (phoneDemoIndex + 1) % phoneDemoScenes.length;
      setPhoneDemoScene(nextIndex);
      return;
    }

    if (!phoneDemoHasStarted) {
      startPhoneDemo();
    } else if (phoneDemoPaused) {
      resumePhoneDemo();
    } else {
      pausePhoneDemo();
    }
  });

  // -----------------------------------------------------------
  // 4. Dynamic Versions Loading
  // -----------------------------------------------------------
  async function loadDynamicVersions() {
    try {
      const res = await fetch('/api/versions');
      const json = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        const container = document.getElementById('versionsContainer');
        if (!container) return;

        const enabledVersions = json.data.filter(v => v.download_enabled !== 0);
        const latest = enabledVersions.find(v => v.is_latest === 1) || enabledVersions[0] || null;
        const displayVersion = latest || json.data.find(v => v.is_latest === 1) || json.data[0];
        if (displayVersion) {
          const specVersion = document.getElementById('specVersion');
          const specSize = document.getElementById('specSize');
          const specDate = document.getElementById('specDate');
          if (specVersion) specVersion.textContent = displayVersion.version_code;
          if (specSize) specSize.textContent = displayVersion.file_size;
          if (specDate) specDate.textContent = displayVersion.release_date;
        }

        [mainDownloadBtn, navDownloadBtn, modalDownloadBtn].forEach(button => {
          if (!button) return;
          const label = button.querySelector('.download-button-label');
          if (label && !label.dataset.enabledLabel) label.dataset.enabledLabel = label.textContent.trim();
          if (latest) {
            button.href = `/download/${latest.version_code}`;
            button.classList.remove('download-disabled');
            button.removeAttribute('aria-disabled');
            button.removeAttribute('tabindex');
            if (label) label.textContent = label.dataset.enabledLabel;
          } else {
            button.removeAttribute('href');
            button.classList.add('download-disabled');
            button.setAttribute('aria-disabled', 'true');
            button.setAttribute('tabindex', '-1');
            if (label) label.textContent = 'Unduhan Tidak Tersedia';
          }
        });

        container.innerHTML = json.data.map(v => {
          const isLatest = v.is_latest === 1;
          const downloadEnabled = v.download_enabled !== 0;
          const changelogItems = (v.changelog || []).map(item => `<li>${item}</li>`).join('');
          
          return `
            <div class="version-item ${isLatest ? 'highlight' : ''}">
              <div class="version-info">
                <div class="version-header-line">
                  <span class="version-number">${v.version_code}</span>
                  ${isLatest ? '<span class="version-badge-rec">TERBARU - DIREKOMENDASIKAN</span>' : ''}
                  ${!downloadEnabled ? '<span class="version-badge-off">UNDUHAN NONAKTIF</span>' : ''}
                </div>
                <div class="version-meta">
                  ${v.release_date} • ${v.file_size} • ${v.min_android}
                </div>
                <ul class="version-changelog">
                  ${changelogItems}
                </ul>
              </div>
              ${downloadEnabled
                ? `<a href="/download/${v.version_code}" class="btn-version-unduh ${isLatest ? '' : 'secondary'}">Unduh ${v.version_code}</a>`
                : '<span class="btn-version-unduh is-disabled" aria-label="Unduhan versi ini dinonaktifkan">Tidak tersedia</span>'}
            </div>
          `;
        }).join('');

        container.querySelectorAll('a.btn-version-unduh').forEach(btn => {
          btn.addEventListener('click', () => {
            const href = btn.getAttribute('href') || '';
            const ver = href.split('/').pop() || 'v1.1.0';
            handleDownloadAction(ver, 'Daftar Versi: ' + ver);
          });
        });

        const openedFromQr = new URLSearchParams(window.location.search).get('download') === 'qr';
        if (openedFromQr && latest && downloadModal) {
          const modalTitle = document.getElementById('downloadModalTitle');
          const modalDescription = downloadModal.querySelector('.modal-desc');
          if (modalTitle) modalTitle.textContent = 'QR Berhasil Dipindai';
          if (modalDescription) {
            modalDescription.textContent = `POTER EDUGAMES ${latest.version_code} siap diunduh. Ketuk tombol di bawah untuk mulai mengunduh APK.`;
          }
          const modalLabel = modalDownloadBtn?.querySelector('.download-button-label');
          if (modalLabel) modalLabel.textContent = `Unduh APK ${latest.version_code}`;
          downloadModal.classList.add('active');
          window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
        }
      }
    } catch (err) {
      console.warn('Gagal memuat pembaruan versi dinamis:', err);
    }
  }

  loadDynamicVersions();

  // ------------------------------------------------------------------
  // PWA REGISTRATION & INSTALL PROMPT
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
    if (btnInstallPwa) btnInstallPwa.style.display = 'inline-flex';
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
        if (choice.outcome === 'accepted') deferredInstallPrompt = null;
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
  // WEB PUSH NOTIFICATIONS (UPDATE VERSI KE HP & DEVICE LAIN)
  // ------------------------------------------------------------------
  const btnTogglePush = document.getElementById('btnTogglePush');
  const btnTestPush = document.getElementById('btnTestPush');
  const pushStatusText = document.getElementById('pushStatusText');

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
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
      pushStatusText.textContent = 'Aktifkan notifikasi agar HP atau perangkat ini langsung mendapat pemberitahuan saat versi APK terbaru dirilis.';
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
        if (!keyJson.success || !keyJson.publicKey) throw new Error('Kunci server notifikasi tidak tersedia.');
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
        if (pushStatusText) pushStatusText.textContent = json.message || 'Notifikasi uji coba dikirim!';
      } catch (_) {
        if (pushStatusText) pushStatusText.textContent = 'Gagal mengirim notifikasi uji coba.';
      } finally {
        btnTestPush.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------
  // SARAN & ULASAN DENGAN ANTI-SPAM (TANPA BINTANG)
  // ------------------------------------------------------------------
  function escapeReviewHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  async function loadReviews() {
    if (!reviewsListContainer) return;
    try {
      const res = await fetch('/api/reviews');
      const json = await res.json();
      if (!json.success) return;

      const total = json.stats?.total || 0;
      if (reviewsTotalCountEl) reviewsTotalCountEl.textContent = `${total} Masukan Terverifikasi`;

      if (!json.reviews || json.reviews.length === 0) {
        reviewsListContainer.innerHTML = '<p class="reviews-empty-text">Belum ada saran atau ulasan. Jadilah orang tua atau guru pertama yang berbagi pengalaman!</p>';
        return;
      }

      reviewsListContainer.innerHTML = json.reviews.map((item) => {
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        return `
          <article class="review-item">
            <div class="review-item-head">
              <div>
                <div class="review-item-author">${escapeReviewHtml(item.name)}</div>
                <div class="review-item-meta">${escapeReviewHtml(item.role)}${dateStr ? ' • ' + escapeReviewHtml(dateStr) : ''}</div>
              </div>
              <span class="reviews-count-pill">${escapeReviewHtml(item.category)}</span>
            </div>
            <p class="review-item-body">${escapeReviewHtml(item.message)}</p>
          </article>
        `;
      }).join('');
    } catch (_) {
      reviewsListContainer.innerHTML = '<p class="reviews-empty-text">Gagal memuat daftar ulasan.</p>';
    }
  }

  if (reviewMessage && reviewCharCount) {
    reviewMessage.addEventListener('input', () => {
      reviewCharCount.textContent = `(${reviewMessage.value.length}/500)`;
    });
  }

  if (btnRefreshChallenge) btnRefreshChallenge.addEventListener('click', loadReviewChallenge);

  if (reviewForm) {
    reviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (reviewFeedback) {
        reviewFeedback.className = 'review-feedback';
        reviewFeedback.textContent = '';
      }
      if (btnSubmitReview) btnSubmitReview.disabled = true;

      const payload = {
        name: document.getElementById('reviewName')?.value || '',
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
        if (reviewCharCount) reviewCharCount.textContent = '(0/500)';
        await Promise.all([loadReviews(), loadReviewChallenge()]);
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
  loadReviews();
});
