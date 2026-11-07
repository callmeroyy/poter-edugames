// POTER EDUGAMES - Client Interactions, 3D Hologram Station, & Day/Night Pull-Cord

document.addEventListener('DOMContentLoaded', () => {
  // -----------------------------------------------------------
  // 1. Day / Night Pull-Cord Switcher (Drag Physics & Celestial Morph)
  // -----------------------------------------------------------
  const pullCordWrap = document.getElementById('pullCordWrap');
  const cordHandle = document.getElementById('cordHandle');
  const cordString = document.getElementById('cordString');
  const cordTooltip = document.getElementById('cordTooltip');
  const celestialOrb = document.getElementById('celestialOrb');

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

  applyTheme(currentTheme);

  // --- Drag-based Pull-Cord Interaction ---
  const PULL_THRESHOLD = 40;
  const MAX_PULL = 120;

  let cordDragging = false;
  let cordStartY = 0;
  let cordStartX = 0;
  let cordPullDist = 0;
  let cordBaseHeight = 85;

  function getPointerPos(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function cordDragStart(e) {
    if (!pullCordWrap || !cordHandle) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    cordDragging = true;
    cordStartY = pos.y;
    cordStartX = pos.x;
    cordPullDist = 0;
    cordBaseHeight = cordString.getBoundingClientRect().height;

    pullCordWrap.classList.add('is-dragging');
    pullCordWrap.classList.remove('is-snapping');

    // Remove transition for real-time feedback
    cordString.style.transition = 'none';
    cordHandle.style.transition = 'none';
  }

  function cordDragMove(e) {
    if (!cordDragging) return;
    const pos = getPointerPos(e);
    const deltaY = pos.y - cordStartY;
    const deltaX = pos.x - cordStartX;

    // Pull distance = max of downward pull or total displacement
    cordPullDist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    // Clamp the visual stretch (mostly care about downward)
    const visualPull = Math.max(0, Math.min(deltaY, MAX_PULL));

    // Rubber-band feel: diminishing returns past threshold
    let rubberPull;
    if (visualPull <= PULL_THRESHOLD) {
      rubberPull = visualPull;
    } else {
      rubberPull = PULL_THRESHOLD + (visualPull - PULL_THRESHOLD) * 0.4;
    }

    // Apply to cord string height and handle offset
    cordString.style.height = (cordBaseHeight + rubberPull) + 'px';
    cordHandle.style.transform = `translateY(${rubberPull}px)`;

    // The cord pivots from its ceiling anchor. A CSS-positive rotation moves
    // the bottom of a vertical element to the left, so the angle must be
    // inverted for the handle to follow the pointer naturally.
    const cordLength = cordBaseHeight + rubberPull;
    const pointerAngle = -(Math.atan2(deltaX, cordLength) * 180 / Math.PI);
    const sway = Math.max(-24, Math.min(24, pointerAngle));
    pullCordWrap.style.transform = `rotate(${sway}deg)`;
  }

  function cordDragEnd() {
    if (!cordDragging) return;
    cordDragging = false;
    pullCordWrap.classList.remove('is-dragging');
    pullCordWrap.classList.add('is-snapping');

    // Snap back
    cordString.style.transition = '';
    cordHandle.style.transition = '';
    cordString.style.height = '';
    cordHandle.style.transform = '';
    pullCordWrap.style.transform = '';

    // Did the user pull far enough to toggle?
    if (cordPullDist >= PULL_THRESHOLD) {
      const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);

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
    // Pointer events (mouse)
    cordHandle.addEventListener('mousedown', cordDragStart);
    window.addEventListener('mousemove', cordDragMove);
    window.addEventListener('mouseup', cordDragEnd);

    // Touch events
    cordHandle.addEventListener('touchstart', cordDragStart, { passive: false });
    window.addEventListener('touchmove', cordDragMove, { passive: true });
    window.addEventListener('touchend', cordDragEnd);

    // Keyboard: Enter/Space to toggle (no drag needed)
    cordHandle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
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
          qrDisplayArea.innerHTML = `
            <img src="${data.qr}" alt="QR Code Unduh APK POTER EDUGAMES" width="240" height="240" />
          `;
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

  // Handle Download Modal Helper
  function triggerDownloadHelper() {
    if (downloadModal) {
      setTimeout(() => {
        downloadModal.classList.add('active');
      }, 500);
    }
  }

  if (mainDownloadBtn) {
    mainDownloadBtn.addEventListener('click', () => {
      triggerDownloadHelper();
    });
  }

  if (navDownloadBtn) {
    navDownloadBtn.addEventListener('click', () => {
      triggerDownloadHelper();
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

  // Escape key closes open modals (Keyboard Accessibility - antislop R-32)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (qrModal) qrModal.classList.remove('active');
      if (downloadModal) downloadModal.classList.remove('active');
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
  // 3. Interactive 3D Hologram Learning Station
  // -----------------------------------------------------------
  const holoViewport = document.getElementById('holoViewport');
  const holoCube = document.getElementById('holoCube');
  const holoAngleTag = document.getElementById('holoAngleTag');
  const btnToggleHoloRotation = document.getElementById('btnToggleHoloRotation');
  const rotationIcon = document.getElementById('rotationIcon');
  const rotationText = document.getElementById('rotationText');
  const modeChips = document.querySelectorAll('.chip-mode');
  const holoModuleName = document.getElementById('holoModuleName');
  const holoModuleKicker = document.querySelector('.holo-module-kicker');

  let isAutoRotating = true;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let rotX = -18;
  let rotY = 0;
  let autoAngle = 0;
  let animFrameId = null;

  // Auto-rotation loop tracking real angle (0 to 360)
  function animateHolo() {
    if (isAutoRotating && !isDragging) {
      autoAngle = (autoAngle + 0.6) % 360;
      rotY = autoAngle;
      if (holoCube) {
        holoCube.style.transform = `rotateX(${rotX}deg) rotateY(${rotY.toFixed(1)}deg)`;
      }
      if (holoAngleTag) {
        holoAngleTag.textContent = `Rotasi: ${Math.round(rotY)}° / 360°`;
      }
    }
    animFrameId = requestAnimationFrame(animateHolo);
  }
  
  if (holoCube) {
    holoCube.style.animation = 'none';
  }
  animFrameId = requestAnimationFrame(animateHolo);

  // Play / Pause rotation toggle (Antislop R-19 / R-39 compliance)
  if (btnToggleHoloRotation) {
    btnToggleHoloRotation.addEventListener('click', () => {
      isAutoRotating = !isAutoRotating;
      if (isAutoRotating) {
        rotationIcon.textContent = '⏸';
        rotationText.textContent = 'Jeda Putaran';
      } else {
        rotationIcon.textContent = '▶';
        rotationText.textContent = 'Putar 360°';
      }
    });
  }

  // Drag / Touch to Rotate in 360 degrees
  if (holoViewport && holoCube) {
    function startDrag(clientX, clientY) {
      isDragging = true;
      startX = clientX;
      startY = clientY;
    }

    function onDrag(clientX, clientY) {
      if (!isDragging) return;
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;

      rotY = (rotY + deltaX * 0.8) % 360;
      if (rotY < 0) rotY += 360;

      rotX = Math.max(-50, Math.min(30, rotX - deltaY * 0.4));

      holoCube.style.transform = `rotateX(${rotX.toFixed(1)}deg) rotateY(${rotY.toFixed(1)}deg)`;
      autoAngle = rotY;

      if (holoAngleTag) {
        holoAngleTag.textContent = `Rotasi: ${Math.round(rotY)}° / 360°`;
      }

      startX = clientX;
      startY = clientY;
    }

    function stopDrag() {
      isDragging = false;
    }

    // Mouse Drag
    holoViewport.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup', stopDrag);

    // Touch Drag (Mobile & Tablet)
    holoViewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) {
        onDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchend', stopDrag);
  }

  // Hologram Mode Switcher (Dynamic Educational Themes)
  const hologramThemes = {
    spasial: {
      label: 'Eksplorasi Spasial',
      code: 'CORE 01',
      items: [
      { icon: '🧊', title: 'Spasial 3D', sub: 'Nalar Geometri' },
      { icon: '🧩', title: 'Teka-Teki', sub: 'Susun Balok' },
      { icon: '📐', title: 'Sudut Ruang', sub: 'Perspektif Anak' },
      { icon: '📦', title: 'Rapikan!', sub: 'Klasifikasi Objek' },
      { icon: '🎨', title: 'Warna Bentuk', sub: 'Koordinasi Visual' },
      { icon: '💎', title: 'Kristal Nalar', sub: 'Eksplorasi Bentuk' }
      ]
    },
    sains: {
      label: 'Laboratorium Sains',
      code: 'CORE 02',
      items: [
      { icon: '🪐', title: 'Tata Surya', sub: 'Orbit Planet' },
      { icon: '🌍', title: 'Bumi & Alam', sub: 'Sains Geografi' },
      { icon: '🔬', title: 'Molekul Mikro', sub: 'Struktur Dasar' },
      { icon: '☀️', title: 'Energi Surya', sub: 'Sumber Kehidupan' },
      { icon: '🌱', title: 'Tumbuh Kembang', sub: 'Biologi Anak' },
      { icon: '🚀', title: 'Antariksa', sub: 'Fisika Sederhana' }
      ]
    },
    logika: {
      label: 'Mesin Logika',
      code: 'CORE 03',
      items: [
      { icon: '🧠', title: 'Logika Nalar', sub: 'Analisis Masalah' },
      { icon: '🔢', title: 'Pola Angka', sub: 'Matematika Riang' },
      { icon: '⚖️', title: 'Timbangan', sub: 'Bandingkan Berat' },
      { icon: '🚗', title: 'Buka Jalan', sub: 'Strategi Berpikir' },
      { icon: '💡', title: 'Daya Ingat', sub: 'Konsentrasi' },
      { icon: '🎯', title: 'Ketelitian', sub: 'Fokus Visual' }
      ]
    }
  };

  modeChips.forEach(chip => {
    chip.addEventListener('click', () => {
      modeChips.forEach(c => c.classList.remove('active'));
      modeChips.forEach(c => c.setAttribute('aria-selected', 'false'));
      chip.classList.add('active');
      chip.setAttribute('aria-selected', 'true');

      const mode = chip.getAttribute('data-mode');
      const themeData = hologramThemes[mode];
      if (!themeData) return;

      holoViewport.dataset.mode = mode;
      if (holoModuleName) holoModuleName.textContent = themeData.label;
      if (holoModuleKicker) holoModuleKicker.textContent = `MODUL AKTIF · ${themeData.code}`;

      const faces = holoCube.querySelectorAll('.holo-face');
      faces.forEach((face, idx) => {
        if (themeData.items[idx]) {
          const iconEl = face.querySelector('.holo-face-icon');
          const codeEl = face.querySelector('.holo-face-code');
          const titleEl = face.querySelector('.holo-face-title');
          const subEl = face.querySelector('.holo-face-sub');
          if (iconEl) iconEl.textContent = themeData.items[idx].icon;
          if (codeEl) codeEl.textContent = `${String(idx + 1).padStart(2, '0')} · ${mode.toUpperCase()}`;
          if (titleEl) titleEl.textContent = themeData.items[idx].title;
          if (subEl) subEl.textContent = themeData.items[idx].sub;
        }
      });

      holoCube.classList.remove('is-switching');
      void holoCube.offsetWidth;
      holoCube.classList.add('is-switching');
    });
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

        const latest = json.data.find(v => v.is_latest) || json.data[0];
        if (latest) {
          const specVersion = document.getElementById('specVersion');
          const specSize = document.getElementById('specSize');
          const specDate = document.getElementById('specDate');
          if (specVersion) specVersion.textContent = latest.version_code;
          if (specSize) specSize.textContent = latest.file_size;
          if (specDate) specDate.textContent = latest.release_date;
        }

        container.innerHTML = json.data.map(v => {
          const isLatest = v.is_latest === 1;
          const changelogItems = (v.changelog || []).map(item => `<li>${item}</li>`).join('');
          
          return `
            <div class="version-item ${isLatest ? 'highlight' : ''}">
              <div class="version-info">
                <div class="version-header-line">
                  <span class="version-number">${v.version_code}</span>
                  ${isLatest ? '<span class="version-badge-rec">TERBARU - DIREKOMENDASIKAN</span>' : ''}
                </div>
                <div class="version-meta">
                  ${v.release_date} • ${v.file_size} • ${v.min_android}
                </div>
                <ul class="version-changelog">
                  ${changelogItems}
                </ul>
              </div>
              <a href="/download/${v.version_code}" class="btn-version-unduh ${isLatest ? '' : 'secondary'}">
                Unduh ${v.version_code}
              </a>
            </div>
          `;
        }).join('');

        container.querySelectorAll('.btn-version-unduh').forEach(btn => {
          btn.addEventListener('click', () => {
            triggerDownloadHelper();
          });
        });
      }
    } catch (err) {
      console.warn('Gagal memuat pembaruan versi dinamis:', err);
    }
  }

  loadDynamicVersions();
});
