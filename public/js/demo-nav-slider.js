(() => {
  const nav = document.querySelector('.sliding-nav');
  const indicator = nav?.querySelector('.nav-indicator');
  const links = nav ? [...nav.querySelectorAll('.sliding-link')] : [];

  if (!nav || !indicator || links.length === 0) return;

  const hashLink = links.find((link) => link.hash === window.location.hash);
  let activeLink = hashLink || nav.querySelector('.sliding-link.is-active') || links[0];
  let indicatorTarget = activeLink;
  let indicatorAnimation = null;

  links.forEach((link) => {
    const isActive = link === activeLink;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const moveIndicator = (link, immediate = false) => {
    if (!link) return;
    if (!immediate && link === indicatorTarget) return;

    const navRect = nav.getBoundingClientRect();
    const currentRect = indicator.getBoundingClientRect();
    const currentX = currentRect.left - navRect.left + nav.scrollLeft;
    const currentWidth = currentRect.width || link.offsetWidth;
    const targetX = link.offsetLeft;
    const targetWidth = link.offsetWidth;

    indicatorTarget = link;
    indicatorAnimation?.cancel();
    indicator.style.setProperty('--indicator-x', `${targetX}px`);
    indicator.style.setProperty('--indicator-width', `${targetWidth}px`);

    if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const currentCenter = currentX + currentWidth / 2;
    const targetCenter = targetX + targetWidth / 2;
    const middleWidth = Math.max(38, Math.min(currentWidth, targetWidth) * 0.68);
    const startSmallX = currentCenter - middleWidth / 2;
    const targetSmallX = targetCenter - middleWidth / 2;
    const settleWidth = targetWidth * 1.035;
    const settleX = targetCenter - settleWidth / 2;

    indicatorAnimation = indicator.animate([
      { width: `${currentWidth}px`, transform: `translate3d(${currentX}px, 0, 0) scaleY(1)`, filter: 'brightness(1)', borderRadius: '11px' },
      { width: `${middleWidth}px`, transform: `translate3d(${startSmallX}px, 0, 0) scaleY(.88)`, filter: 'brightness(1.1)', borderRadius: '18px', offset: 0.22 },
      { width: `${middleWidth}px`, transform: `translate3d(${targetSmallX}px, 0, 0) scaleY(.88)`, filter: 'brightness(1.1)', borderRadius: '18px', offset: 0.72 },
      { width: `${settleWidth}px`, transform: `translate3d(${settleX}px, 0, 0) scaleY(1.025)`, filter: 'brightness(1.05)', borderRadius: '12px', offset: 0.91 },
      { width: `${targetWidth}px`, transform: `translate3d(${targetX}px, 0, 0) scaleY(1)`, filter: 'brightness(1)', borderRadius: '11px' }
    ], {
      duration: 1250,
      easing: 'cubic-bezier(.2,.72,.18,1)',
      fill: 'none'
    });

    indicatorAnimation.addEventListener('finish', () => {
      indicatorAnimation = null;
    }, { once: true });
  };

  const setActive = (link) => {
    activeLink.classList.remove('is-active');
    activeLink.removeAttribute('aria-current');
    activeLink = link;
    activeLink.classList.add('is-active');
    activeLink.setAttribute('aria-current', 'page');
    moveIndicator(activeLink);
  };

  links.forEach((link) => {
    link.addEventListener('pointerenter', () => moveIndicator(link));
    link.addEventListener('focus', () => moveIndicator(link));
    link.addEventListener('click', (event) => {
      event.preventDefault();
      history.replaceState(null, '', link.hash);
      setActive(link);
    });
  });

  nav.addEventListener('pointerleave', () => moveIndicator(activeLink));
  nav.addEventListener('focusout', (event) => {
    if (!nav.contains(event.relatedTarget)) moveIndicator(activeLink);
  });

  window.addEventListener('resize', () => moveIndicator(activeLink, true));
  moveIndicator(activeLink, true);

  // Material Switcher: Kaca Plastik (Acrylic) vs Kaca Cair (Liquid)
  const btnMatPlastic = document.getElementById('btnMatPlastic');
  const btnMatLiquid = document.getElementById('btnMatLiquid');

  const setMaterial = (mat) => {
    nav.setAttribute('data-material', mat);
    btnMatPlastic?.classList.toggle('is-active', mat === 'plastic');
    btnMatPlastic?.setAttribute('aria-checked', String(mat === 'plastic'));
    btnMatLiquid?.classList.toggle('is-active', mat === 'liquid');
    btnMatLiquid?.setAttribute('aria-checked', String(mat === 'liquid'));
    moveIndicator(activeLink, true);
  };

  btnMatPlastic?.addEventListener('click', () => setMaterial('plastic'));
  btnMatLiquid?.addEventListener('click', () => setMaterial('liquid'));
})();
