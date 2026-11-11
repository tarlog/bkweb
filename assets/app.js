(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const track = $('#track');
  const viewer = $('#viewer');

  let all = [];          // every painting, in admin-defined order
  let list = [];         // paintings matching the keyword filter
  let slides = [];       // DOM nodes for `list`
  const selected = new Set(); // lower-cased keywords; a painting must have all of them
  let pos = 0;           // index of the centred painting in `list`
  let drag = 0;          // fractional offset while dragging
  let spacing = 300;     // px between centre and first neighbour

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (k) => String(k).trim().toLowerCase();
  const kws = (p) => (p.keywords || []).map(norm);
  const sizeText = (p) => (p.width && p.height ? `${p.width} × ${p.height} ${p.unit || 'cm'}` : '');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Loading ----------
  async function load() {
    const opts = { cache: 'no-cache' };
    const [site, data] = await Promise.all([
      fetch('data/site.json', opts).then((r) => r.json()).catch(() => ({})),
      fetch('data/paintings.json', opts).then((r) => r.json()),
    ]);
    applySite(site);
    all = data.paintings || [];
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

  // ---------- Routing: #about  |  #p=<id>&k=sea,trees ----------
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    const isAbout = h === 'about';
    $('#about').hidden = !isAbout;
    $('#gallery').hidden = isAbout;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (isAbout ? 'about' : 'gallery')));
    if (isAbout) return;
    const params = new URLSearchParams(h);
    selected.clear();
    (params.get('k') || '').split(',').map(norm).filter(Boolean).forEach((k) => selected.add(k));
    applyFilter(params.get('p'));
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (list[pos]) params.set('p', list[pos].id);
    if (selected.size) params.set('k', [...selected].join(','));
    history.replaceState(null, '', `#${params.toString()}`);
  }

  // ---------- Keyword filter ----------
  function applyFilter(keepId) {
    const prevId = keepId ?? list[pos]?.id;
    list = all.filter((p) => { const s = new Set(kws(p)); return [...selected].every((k) => s.has(k)); });
    const i = list.findIndex((p) => p.id === prevId);
    pos = i >= 0 ? i : 0;
    renderFilters();
    buildTrack();
    $('#empty').hidden = list.length > 0;
    stage.hidden = $('#info').hidden = list.length === 0;
    stage.classList.add('dragging'); // place slides instantly, no fly-in animation
    layout();
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('dragging')));
    renderInfo(false);
    writeHash();
  }

  function renderFilters() {
    const counts = new Map(); // norm -> {label, total}
    all.forEach((p) => (p.keywords || []).forEach((k) => {
      const n = norm(k);
      if (!n) return;
      const e = counts.get(n) || { label: k.trim(), total: 0 };
      e.total++; counts.set(n, e);
    }));
    if (!counts.size) { $('#filters').innerHTML = ''; return; }
    const inList = (n) => list.filter((p) => kws(p).includes(n)).length;
    const chips = [...counts.entries()]
      .sort((a, b) => b[1].total - a[1].total || a[1].label.localeCompare(b[1].label))
      .map(([n, e]) => {
        const on = selected.has(n);
        const c = on ? list.length : inList(n);
        return `<button class="chip" data-k="${esc(n)}" aria-pressed="${on}" ${!on && !c ? 'disabled' : ''}>${esc(e.label)}<small>${c}</small></button>`;
      });
    $('#filters').innerHTML =
      `<button class="chip" data-k="" aria-pressed="${!selected.size}">All<small>${all.length}</small></button>` + chips.join('');
  }

  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (!k) selected.clear();
    else if (selected.has(k)) selected.delete(k);
    else selected.add(k);
    applyFilter();
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { selected.clear(); applyFilter(); }
    const t = e.target.closest('[data-tag]');
    if (t) { selected.clear(); selected.add(t.dataset.tag); applyFilter(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  // ---------- Carousel ----------
  function buildTrack() {
    track.innerHTML = list.map((p, i) =>
      `<button class="slide" data-i="${i}" aria-label="${esc(p.title)}"><img src="${esc(p.thumb)}" alt="${esc(p.title)}" decoding="async" draggable="false"></button>`
    ).join('');
    slides = [...track.children];
  }

  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const mobile = W < 700;
    const maxW = W * (mobile ? 0.74 : 0.52), maxH = H * 0.86;
    spacing = W * (mobile ? 0.3 : 0.27);
    slides.forEach((el, i) => {
      const p = list[i];
      const ar = p.imageWidth && p.imageHeight ? p.imageWidth / p.imageHeight : 4 / 3;
      const w = Math.min(maxW, maxH * ar), h = w / ar;
      Object.assign(el.style, { width: `${w}px`, height: `${h}px`, marginLeft: `${-w / 2}px`, marginTop: `${-h / 2}px` });
    });
    position();
  }

  // Neighbours shrink, darken, turn slightly and stack behind the centre painting.
  function position() {
    const p = pos + drag;
    const centre = Math.round(p);
    slides.forEach((el, i) => {
      const d = i - p, a = Math.abs(d);
      if (a > 4.5) { el.style.visibility = 'hidden'; el.style.opacity = 0; return; }
      const x = Math.sign(d) * spacing * 2 * (1 - Math.pow(0.5, a));
      const scale = Math.pow(0.78, a);
      const rot = -clamp(d, -1, 1) * 24;
      el.style.visibility = 'visible';
      el.style.opacity = a > 3.5 ? 0 : 1;
      el.style.zIndex = String(100 - Math.round(a * 10));
      el.style.filter = `brightness(${1 - Math.min(a, 3) * 0.13})`;
      el.style.transform = `translateX(${x}px) translateZ(${-a * 90}px) rotateY(${rot}deg) scale(${scale})`;
      el.classList.toggle('center', i === centre);
      el.tabIndex = i === centre ? 0 : -1;
      el.setAttribute('aria-hidden', i === centre ? 'false' : 'true');
      if (a < 1.6) upgrade(el, list[i]);
    });
    $('.c-prev').disabled = centre <= 0;
    $('.c-next').disabled = centre >= list.length - 1;
  }

  // Swap the thumbnail for the full image once a painting gets close to the centre.
  function upgrade(el, p) {
    if (el.dataset.full) return;
    el.dataset.full = '1';
    const img = new Image();
    img.onload = () => { const t = el.querySelector('img'); if (t) t.src = p.image; };
    img.src = p.image;
  }

  function go(i) {
    if (!list.length) return;
    const next = clamp(Math.round(i), 0, list.length - 1);
    const changed = next !== pos;
    pos = next; drag = 0;
    position();
    if (changed) { renderInfo(true); writeHash(); }
    if (!viewer.hidden) showViewer();
  }

  let fadeT;
  function renderInfo(animate) {
    const p = list[pos];
    if (!p) return;
    const fill = () => {
      $('#counter').textContent = `${pos + 1} / ${list.length}`;
      $('#i-title').textContent = p.title;
      $('#i-meta').innerHTML = [p.medium, sizeText(p), p.year, p.status].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
      $('#i-desc').textContent = p.description || '';
      $('#i-tags').innerHTML = (p.keywords || []).map((k) => `<button class="chip" data-tag="${esc(norm(k))}">${esc(k)}</button>`).join('');
      $('#info').classList.remove('fade');
    };
    clearTimeout(fadeT);
    if (!animate) return fill();
    $('#info').classList.add('fade');
    fadeT = setTimeout(fill, 180);
  }

  // Click: side painting → bring to centre; centre painting → full screen.
  let suppressClick = false;
  track.addEventListener('click', (e) => {
    const el = e.target.closest('.slide');
    if (!el || suppressClick) return;
    const i = +el.dataset.i;
    if (i === pos) showViewer(); else go(i);
  });
  $('.c-prev').addEventListener('click', () => go(pos - 1));
  $('.c-next').addEventListener('click', () => go(pos + 1));

  // Drag / swipe with live follow.
  let startX = null, startT = 0, moved = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.c-nav')) return;
    startX = e.clientX; startT = performance.now(); moved = false; suppressClick = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < 8) return;
    moved = true;
    stage.classList.add('dragging');
    drag = clamp(-dx / spacing, -pos - 0.4, list.length - 1 - pos + 0.4);
    position();
  });
  const endDrag = (e) => {
    if (startX === null) return;
    const dx = (e.clientX ?? startX) - startX;
    const fast = Math.abs(dx) / Math.max(1, performance.now() - startT) > 0.4;
    startX = null;
    stage.classList.remove('dragging');
    if (!moved) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    let target = Math.round(pos + drag);
    if (target === pos && (fast || Math.abs(dx) > spacing * 0.2)) target = pos + (dx < 0 ? 1 : -1);
    go(target);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', () => { if (startX !== null) { startX = null; stage.classList.remove('dragging'); go(pos); } });

  // Horizontal trackpad / shift+wheel scrolling (vertical wheel keeps scrolling the page).
  let wheelAcc = 0, wheelLock = 0;
  stage.addEventListener('wheel', (e) => {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (!dx) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelAcc += dx;
    if (Math.abs(wheelAcc) > 40) { go(pos + Math.sign(wheelAcc)); wheelAcc = 0; wheelLock = now + 380; }
  }, { passive: false });

  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(layout, 100); });

  // ---------- Full-screen viewer ----------
  function showViewer() {
    const p = list[pos];
    if (!p) return;
    const img = $('#v-img');
    img.src = p.image; img.alt = p.title;
    viewer.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function hideViewer() { viewer.hidden = true; document.body.style.overflow = ''; }
  $('.v-close').addEventListener('click', hideViewer);
  $('.v-prev').addEventListener('click', () => go(pos - 1));
  $('.v-next').addEventListener('click', () => go(pos + 1));
  viewer.addEventListener('click', (e) => { if (e.target === viewer) hideViewer(); });
  let vx = null;
  viewer.addEventListener('touchstart', (e) => { vx = e.touches[0].clientX; }, { passive: true });
  viewer.addEventListener('touchend', (e) => {
    if (vx === null) return;
    const dx = e.changedTouches[0].clientX - vx; vx = null;
    if (Math.abs(dx) > 50) go(pos + (dx < 0 ? 1 : -1));
  });

  // ---------- Keyboard ----------
  document.addEventListener('keydown', (e) => {
    if ($('#gallery').hidden || e.target.closest?.('input, textarea')) return;
    if (!viewer.hidden && e.key === 'Escape') return hideViewer();
    if (e.key === 'ArrowRight') { e.preventDefault(); go(pos + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(pos - 1); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Enter' && document.activeElement === stage && viewer.hidden) showViewer();
  });

  window.addEventListener('hashchange', () => { route(); layout(); });
  load().catch((err) => { $('#empty').hidden = false; $('#empty').textContent = 'Could not load paintings.'; console.error(err); });
})();
