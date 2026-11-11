(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const gallery = $('#gallery');
  const viewer = $('#viewer');
  let paintings = [];
  let current = -1;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const sizeText = (p) => (p.width && p.height ? `${p.width} × ${p.height} ${p.unit || 'cm'}` : '');
  const metaParts = (p) => [p.medium, sizeText(p), p.year, p.status].filter(Boolean);

  async function load() {
    const opts = { cache: 'no-cache' };
    const [site, data] = await Promise.all([
      fetch('data/site.json', opts).then((r) => r.json()).catch(() => ({})),
      fetch('data/paintings.json', opts).then((r) => r.json()),
    ]);
    applySite(site);
    paintings = data.paintings || [];
    renderGallery();
    route();
  }

  function applySite(site) {
    const name = site.artistName || 'Paintings';
    $('#artist-name').textContent = name;
    $('#tagline').textContent = site.tagline || '';
    $('#about-text').textContent = site.about || '';
    $('#contact').innerHTML = site.email ? `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>` : '';
    $('#copy').textContent = `© ${new Date().getFullYear()} ${name}`;
    document.title = site.tagline ? `${name} — ${site.tagline}` : name;
  }

  function renderGallery() {
    gallery.innerHTML = paintings.map((p, i) => {
      const ar = p.imageWidth && p.imageHeight ? p.imageWidth / p.imageHeight : 1.33;
      return `<a class="tile" href="#p/${encodeURIComponent(p.id)}" style="--ar:${ar.toFixed(4)}" data-i="${i}">
        <img src="${esc(p.thumb)}" alt="${esc(p.title)}" loading="lazy" decoding="async" onload="this.classList.add('loaded')">
        ${p.status ? `<span class="badge">${esc(p.status)}</span>` : ''}
        <span class="cap">${esc(p.title)}</span>
      </a>`;
    }).join('');
    // images cached before onload attribute ran
    gallery.querySelectorAll('img').forEach((img) => img.complete && img.classList.add('loaded'));
  }

  function show(i) {
    if (!paintings.length) return;
    current = (i + paintings.length) % paintings.length;
    const p = paintings[current];
    const img = $('#v-img');
    img.src = p.thumb;            // instant low-res placeholder
    const full = new Image();
    full.onload = () => { if (paintings[current] === p) img.src = p.image; };
    full.src = p.image;
    img.alt = p.title;
    $('#v-title').textContent = p.title;
    $('#v-meta').innerHTML = metaParts(p).map(esc).join('<br>');
    $('#v-desc').textContent = p.description || '';
    viewer.hidden = false;
    document.body.style.overflow = 'hidden';
    // preload neighbours
    [current + 1, current - 1].forEach((j) => { const n = paintings[(j + paintings.length) % paintings.length]; if (n) new Image().src = n.image; });
  }

  function hide() {
    viewer.hidden = true;
    document.body.style.overflow = '';
    current = -1;
  }

  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    const isAbout = h === 'about';
    $('#about').hidden = !isAbout;
    gallery.hidden = isAbout;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (isAbout ? 'about' : 'gallery')));
    if (h.startsWith('p/')) {
      const i = paintings.findIndex((p) => p.id === h.slice(2));
      if (i >= 0) return show(i);
    }
    if (!viewer.hidden) hide();
  }

  const go = (delta) => { const p = paintings[(current + delta + paintings.length) % paintings.length]; history.replaceState(null, '', `#p/${encodeURIComponent(p.id)}`); route(); };
  const close = () => { history.replaceState(null, '', location.pathname + location.search); route(); };

  window.addEventListener('hashchange', route);
  $('.v-close').addEventListener('click', close);
  $('.v-prev').addEventListener('click', () => go(-1));
  $('.v-next').addEventListener('click', () => go(1));
  viewer.addEventListener('click', (e) => { if (e.target === viewer || e.target.classList.contains('v-figure') || e.target.classList.contains('v-img-wrap')) close(); });
  document.addEventListener('keydown', (e) => {
    if (viewer.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  });

  // swipe on touch devices
  let tx = null, ty = null;
  viewer.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  viewer.addEventListener('touchend', (e) => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    tx = ty = null;
  });

  load().catch((err) => { gallery.textContent = 'Could not load paintings.'; console.error(err); });
})();
