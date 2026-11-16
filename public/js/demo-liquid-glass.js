// ==============================================================
// POTER EDUGAMES — DEMO UI KACA CAIR BENING (LIQUID GLASS LOGIC)
// Interaksi Fluida Kaca, Pantulan Kaustik, & Gelombang Riak
// ==============================================================

document.addEventListener('DOMContentLoaded', () => {
  const liquidCard = document.getElementById('liquidCard');
  const stageWrapper = document.getElementById('stageWrapper');
  const themeToggle = document.getElementById('themeToggle');
  const themeLabel = document.getElementById('themeLabel');
  const chipButtons = document.querySelectorAll('.chip-btn');
  const btnToggleCompare = document.getElementById('btnToggleCompare');
  const btnTriggerRipple = document.getElementById('btnTriggerRipple');
  const rippleCountTag = document.getElementById('rippleCountTag');
  const refractionValTag = document.getElementById('refractionValTag');
  const liquidCtaBtn = document.getElementById('liquidCtaBtn');

  let rippleCounter = 0;
  let isComparingFrosted = false;
  let currentPreset = 'dew'; // 'dew' | 'flow' | 'prism'

  // -------------------------------------------------------------
  // 1. Theme Toggle (Dark / Light)
  // -------------------------------------------------------------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('poter_liquid_theme', theme);
    if (themeLabel) {
      themeLabel.textContent = theme === 'light' ? 'Mode Siang' : 'Mode Malam';
    }
  }

  // Read saved theme or default to dark
  const savedTheme = localStorage.getItem('poter_liquid_theme') || 'dark';
  applyTheme(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // -------------------------------------------------------------
  // 2. Interactive Liquid Fluid Motion & Pointer Caustics
  // -------------------------------------------------------------
  let mouseTargetX = 50;
  let mouseTargetY = 50;
  let mouseCurrentX = 50;
  let mouseCurrentY = 50;
  let tiltTargetX = 0;
  let tiltTargetY = 0;
  let tiltCurrentX = 0;
  let tiltCurrentY = 0;
  let animFrameId = null;

  function updateFluidPhysics() {
    if (liquidCard && !isComparingFrosted) {
      // Viscous damping (lagging smooth fluid follow)
      const ease = currentPreset === 'flow' ? 0.08 : 0.14;
      mouseCurrentX += (mouseTargetX - mouseCurrentX) * ease;
      mouseCurrentY += (mouseTargetY - mouseCurrentY) * ease;
      tiltCurrentX += (tiltTargetX - tiltCurrentX) * ease;
      tiltCurrentY += (tiltTargetY - tiltCurrentY) * ease;

      liquidCard.style.setProperty('--mouse-x', `${mouseCurrentX.toFixed(2)}%`);
      liquidCard.style.setProperty('--mouse-y', `${mouseCurrentY.toFixed(2)}%`);
      liquidCard.style.setProperty('--liquid-tilt-x', `${tiltCurrentX.toFixed(2)}deg`);
      liquidCard.style.setProperty('--liquid-tilt-y', `${tiltCurrentY.toFixed(2)}deg`);
    }

    animFrameId = requestAnimationFrame(updateFluidPhysics);
  }

  animFrameId = requestAnimationFrame(updateFluidPhysics);

  // Track pointer on the stage or card
  if (stageWrapper && liquidCard) {
    function handlePointerMove(e) {
      if (isComparingFrosted) return;

      const rect = liquidCard.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      // Percentages for radial gradient reflection
      mouseTargetX = Math.max(0, Math.min(100, (x / rect.width) * 100));
      mouseTargetY = Math.max(0, Math.min(100, (y / rect.height) * 100));

      // 3D Tilt calculation (max 6 degrees for subtle liquid perspective)
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      tiltTargetY = ((x - centerX) / centerX) * 5;
      tiltTargetX = -((y - centerY) / centerY) * 5;

      // Dynamic organic border-radius morphing based on pointer quadrant
      const factorX = (mouseTargetX - 50) * 0.25;
      const factorY = (mouseTargetY - 50) * 0.25;

      liquidCard.style.setProperty('--liquid-wobble-1', `${Math.round(36 + factorX)}px`);
      liquidCard.style.setProperty('--liquid-wobble-2', `${Math.round(44 - factorY)}px`);
      liquidCard.style.setProperty('--liquid-wobble-3', `${Math.round(38 - factorX)}px`);
      liquidCard.style.setProperty('--liquid-wobble-4', `${Math.round(48 + factorY)}px`);
    }

    function handlePointerLeave() {
      // Smoothly spring back to rest state
      mouseTargetX = 50;
      mouseTargetY = 50;
      tiltTargetX = 0;
      tiltTargetY = 0;
      liquidCard.style.setProperty('--liquid-wobble-1', '36px');
      liquidCard.style.setProperty('--liquid-wobble-2', '44px');
      liquidCard.style.setProperty('--liquid-wobble-3', '38px');
      liquidCard.style.setProperty('--liquid-wobble-4', '48px');
    }

    stageWrapper.addEventListener('mousemove', handlePointerMove);
    stageWrapper.addEventListener('mouseleave', handlePointerLeave);

    stageWrapper.addEventListener('touchmove', handlePointerMove, { passive: true });
    stageWrapper.addEventListener('touchend', handlePointerLeave);
  }

  // -------------------------------------------------------------
  // 3. Liquid Ripple Wave Generator
  // -------------------------------------------------------------
  function createLiquidRipple(pageX, pageY) {
    if (!liquidCard) return;

    const rect = liquidCard.getBoundingClientRect();
    let posX = pageX ? (pageX - rect.left) : (rect.width / 2);
    let posY = pageY ? (pageY - rect.top) : (rect.height / 2);

    // Clamp coordinates inside card
    posX = Math.max(10, Math.min(rect.width - 10, posX));
    posY = Math.max(10, Math.min(rect.height - 10, posY));

    const ripple = document.createElement('span');
    ripple.className = 'liquid-ripple-wave';
    ripple.style.left = `${posX}px`;
    ripple.style.top = `${posY}px`;

    liquidCard.appendChild(ripple);

    // Update stats tag
    rippleCounter++;
    if (rippleCountTag) {
      rippleCountTag.textContent = `${rippleCounter}x Riak`;
    }

    // Clean up after animation finishes
    ripple.addEventListener('animationend', () => {
      ripple.remove();
    });
  }

  if (liquidCard) {
    liquidCard.addEventListener('click', (e) => {
      // Avoid triggering when clicking actual action links
      if (e.target.closest('a') || e.target.closest('button')) return;
      createLiquidRipple(e.clientX, e.clientY);
    });
  }

  if (btnTriggerRipple) {
    btnTriggerRipple.addEventListener('click', () => {
      createLiquidRipple(null, null);
    });
  }

  // -------------------------------------------------------------
  // 4. Preset Modes (Dew Drop / Molten Flow / Prismatic Lens)
  // -------------------------------------------------------------
  const presets = {
    dew: {
      transparency: 'rgba(14, 25, 45, 0.28)',
      blur: '14px',
      saturate: '190%',
      contrast: '110%',
      refractionLabel: '1.48 RI (Murni)'
    },
    flow: {
      transparency: 'rgba(10, 22, 42, 0.40)',
      blur: '20px',
      saturate: '165%',
      contrast: '105%',
      refractionLabel: '1.54 RI (Kental)'
    },
    prism: {
      transparency: 'rgba(18, 32, 58, 0.32)',
      blur: '12px',
      saturate: '210%',
      contrast: '115%',
      refractionLabel: '1.62 RI (Dispersi)'
    }
  };

  chipButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      chipButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const mode = btn.getAttribute('data-mode');
      currentPreset = mode;
      const conf = presets[mode];
      if (!conf || !liquidCard) return;

      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const bg = isLight ? conf.transparency.replace('14, 25, 45', '255, 255, 255').replace('0.28', '0.45') : conf.transparency;

      liquidCard.style.setProperty('--glass-transparency', bg);
      liquidCard.style.setProperty('--glass-blur', conf.blur);
      liquidCard.style.setProperty('--glass-saturate', conf.saturate);
      liquidCard.style.setProperty('--glass-contrast', conf.contrast);

      if (refractionValTag) {
        refractionValTag.textContent = conf.refractionLabel;
      }

      // Splash celebratory ripple on preset change
      createLiquidRipple(null, null);
    });
  });

  // -------------------------------------------------------------
  // 5. Comparison Toggle (Anti-Glass Bening vs Frosted Slop)
  // -------------------------------------------------------------
  if (btnToggleCompare && liquidCard) {
    btnToggleCompare.addEventListener('click', () => {
      isComparingFrosted = !isComparingFrosted;
      if (isComparingFrosted) {
        liquidCard.classList.add('is-frosted-slop');
        btnToggleCompare.textContent = 'Kembalikan ke Kaca Cair Bening';
        btnToggleCompare.style.background = 'rgba(239, 68, 68, 0.16)';
        btnToggleCompare.style.color = '#F87171';
        btnToggleCompare.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      } else {
        liquidCard.classList.remove('is-frosted-slop');
        btnToggleCompare.textContent = 'Bandingkan: Kaca Buram Biasa';
        btnToggleCompare.style.background = '';
        btnToggleCompare.style.color = '';
        btnToggleCompare.style.borderColor = '';
        createLiquidRipple(null, null);
      }
    });
  }

  // -------------------------------------------------------------
  // 6. Interactive CTA Button Click
  // -------------------------------------------------------------
  if (liquidCtaBtn) {
    liquidCtaBtn.addEventListener('click', (e) => {
      e.preventDefault();
      createLiquidRipple(e.clientX, e.clientY);
      const originalText = liquidCtaBtn.innerHTML;
      liquidCtaBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Sensasi Fluida Terdeteksi!
      `;
      setTimeout(() => {
        liquidCtaBtn.innerHTML = originalText;
      }, 2000);
    });
  }
});
