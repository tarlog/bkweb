// "See it on your wall": place a painting on the visitor's own interior photo.
// Privacy: the photo is decoded locally into a canvas. It is never uploaded, never put in
// storage, and the page's Content-Security-Policy forbids requests to any other site.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const room = $('#room');
  const canvas = $('#r-canvas');
  const ctx = canvas.getContext('2d');
  const MAX_PHOTO = 2400;          // working resolution for the room photo
  const SAMPLE_PX_PER_CM = 5;      // sample room is drawn ~4 m wide

  let bg = null;                   // canvas holding the room photo (or sample room)
  let isSample = true;
  let pxPerCm = null;              // scale of the room photo, once calibrated
  let idx = 0;                     // painting index in gallery.list
  let art = null;                  // loaded painting image
  const st = { x: 0, y: 0, w: 0 }; // painting centre and width, in room-photo pixels
  let frame = 'black';
  let view = { s: 1, ox: 0, oy: 0 };
  let cal = null;                  // calibration: { pts: [] }

  const toCm = (v, unit) => (unit === 'in' ? v * 2.54 : unit === 'mm' ? v / 10 : v);
  const painting = () => window.gallery.list[idx];
  const aspect = () => (art ? art.naturalWidth / art.naturalHeight : 4 / 3);

  const rr = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));

  // ---------- Room background ----------
  function sampleRoom() {
    const c = Object.assign(document.createElement('canvas'), { width: 2000, height: 1300 });
    const g = c.getContext('2d');
    const floorY = 1010;
    let gr = g.createLinearGradient(0, 0, 0, floorY);
    gr.addColorStop(0, '#ece7df'); gr.addColorStop(1, '#ddd5c9');
    g.fillStyle = gr; g.fillRect(0, 0, 2000, floorY);
    gr = g.createLinearGradient(0, floorY, 0, 1300);
    gr.addColorStop(0, '#a98461'); gr.addColorStop(1, '#7d5d40');
    g.fillStyle = gr; g.fillRect(0, floorY, 2000, 290);
    g.strokeStyle = 'rgba(60,40,25,.18)'; g.lineWidth = 2;
    for (let x = -400; x < 2400; x += 160) { g.beginPath(); g.moveTo(x, floorY); g.lineTo(x + (x - 1000) * 0.6, 1300); g.stroke(); }
    g.fillStyle = '#f4f1ec'; g.fillRect(0, floorY - 40, 2000, 40);           // skirting board
    g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(0, floorY - 2, 2000, 4);
    // simple sofa for a sense of scale (~200 cm wide, 85 cm tall)
    g.fillStyle = '#6f7d75';
    const sx = 500, sw = 1000, sy = floorY - 425;
    g.beginPath(); rr(g, sx, sy, sw, 250, 30); g.fill();
    g.fillStyle = '#7c8a82';
    g.beginPath(); rr(g, sx - 40, sy + 120, sw + 80, 230, 30); g.fill();
    g.fillStyle = '#4a3a2c';
    g.fillRect(sx + 20, floorY - 75, 24, 75); g.fillRect(sx + sw - 44, floorY - 75, 24, 75);
    return c;
  }

  async function loadPhoto(file) {
    let src;
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      const url = URL.createObjectURL(file);
      try { src = new Image(); src.src = url; await src.decode(); } finally { URL.revokeObjectURL(url); }
    }
    const k = Math.min(1, MAX_PHOTO / Math.max(src.width, src.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(src.width * k), height: Math.round(src.height * k) });
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    src.close?.();
    return c;
  }

  function setBackground(c, sample) {
    bg = c; isSample = sample;
    pxPerCm = sample ? SAMPLE_PX_PER_CM : null;
    st.x = bg.width / 2;
    st.y = bg.height * (sample ? 0.36 : 0.4);
    if (!applyRealSize()) st.w = bg.width * 0.3;
    $('#r-sample').hidden = sample;
    fit(); hint();
  }

  // ---------- Painting ----------
  function loadArt(i) {
    const list = window.gallery.list;
    idx = (i + list.length) % list.length;
    const p = painting();
    $('#r-title').textContent = p.title;
    return new Promise((ok) => {
      const img = new Image();
      img.onload = () => { art = img; applyRealSize(); syncSlider(); draw(); ok(); };
      img.onerror = () => ok();
      img.src = p.image;
    });
  }

  // Size the painting from its real dimensions when the room scale is known.
  function applyRealSize() {
    const p = painting();
    const ok = !!(pxPerCm && p?.width);
    $('#r-real').hidden = !ok;
    if (ok) { st.w = toCm(p.width, p.unit) * pxPerCm; syncSlider(); }
    return ok;
  }

  function frameGeom(w) {
    switch (frame) {
      case 'black': return [{ pad: Math.max(2, w * 0.012), fill: '#1d1d1d' }];
      case 'wood': return [{ pad: w * 0.045, fill: 'wood' }];
      case 'mat': return [{ pad: w * 0.016, fill: '#202020' }, { pad: w * 0.09, fill: '#f6f3ec' }];
      default: return [];
    }
  }

  // Draw room + painting. s/ox/oy map room-photo pixels to the target context.
  function render(g, s, ox, oy, overlay) {
    g.drawImage(bg, ox, oy, bg.width * s, bg.height * s);
    if (!art) return;
    const w = st.w * s, h = w / aspect();
    const cx = ox + st.x * s, cy = oy + st.y * s;
    const layers = frameGeom(w);
    const total = layers.reduce((a, l) => a + l.pad, 0);
    let x = cx - w / 2 - total, y = cy - h / 2 - total, fw = w + 2 * total, fh = h + 2 * total;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.38)'; g.shadowBlur = Math.max(4, w * 0.05); g.shadowOffsetY = Math.max(2, w * 0.02);
    g.fillStyle = '#000'; g.fillRect(x, y, fw, fh);
    g.restore();
    for (const l of layers) {
      if (l.fill === 'wood') {
        const gr = g.createLinearGradient(x, y, x + fw, y + fh);
        gr.addColorStop(0, '#8a5a32'); gr.addColorStop(0.5, '#a8703f'); gr.addColorStop(1, '#6e4524');
        g.fillStyle = gr;
      } else g.fillStyle = l.fill;
      g.fillRect(x, y, fw, fh);
      if (l.fill === 'wood') { g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = Math.max(1, l.pad * 0.12); g.strokeRect(x + l.pad - g.lineWidth / 2, y + l.pad - g.lineWidth / 2, fw - 2 * l.pad + g.lineWidth, fh - 2 * l.pad + g.lineWidth); }
      x += l.pad; y += l.pad; fw -= 2 * l.pad; fh -= 2 * l.pad;
    }
    g.drawImage(art, x, y, fw, fh);
    if (overlay && cal) {
      g.fillStyle = g.strokeStyle = '#ff3b30'; g.lineWidth = 3;
      const pts = cal.pts.map(([px, py]) => [ox + px * s, oy + py * s]);
      if (pts.length === 2) { g.beginPath(); g.moveTo(...pts[0]); g.lineTo(...pts[1]); g.stroke(); }
      pts.forEach(([px, py]) => { g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); });
    }
  }

  function fit() {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    if (!bg) return;
    const s = Math.min(canvas.width / bg.width, canvas.height / bg.height);
    view = { s, ox: (canvas.width - bg.width * s) / 2, oy: (canvas.height - bg.height * s) / 2 };
    draw();
  }

  function draw() {
    if (!bg) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    render(ctx, view.s, view.ox, view.oy, true);
  }

  // ---------- Controls ----------
  const slider = $('#r-size');
  const syncSlider = () => { if (bg) slider.value = (st.w / bg.width) * 100; };
  slider.addEventListener('input', () => { st.w = (slider.value / 100) * bg.width; draw(); });
  $('#r-frame').addEventListener('change', (e) => { frame = e.target.value; draw(); });
  $('#r-prev').addEventListener('click', () => loadArt(idx - 1));
  $('#r-next').addEventListener('click', () => loadArt(idx + 1));
  $('#r-real').addEventListener('click', () => { applyRealSize(); draw(); });
  $('#r-sample').addEventListener('click', () => setBackground(sampleRoom(), true));
  $('#r-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { setBackground(await loadPhoto(f), false); }
    catch { alert('Sorry, this photo could not be opened. Please try a JPEG or PNG image.'); }
  });

  function hint(text) {
    $('#r-hint').textContent = text ?? (isSample
      ? 'Tip: tap “Use my photo” to try your own room. Drag to move, pinch or scroll to resize.'
      : pxPerCm ? 'Drag to move, pinch or scroll to resize.'
        : 'Drag to move, pinch or scroll to resize. For true size, tap “Set real scale”.');
  }

  // Calibration: mark both ends of an object with known length.
  $('#r-cal-btn').addEventListener('click', () => {
    cal = { pts: [] };
    $('#r-cal').hidden = true;
    hint('Tap both ends of something whose length you know, e.g. a door (about 80 cm) or a sofa.');
    draw();
  });
  $('#r-cal').addEventListener('submit', (e) => {
    e.preventDefault();
    const len = parseFloat($('#r-cal-len').value);
    const [[x1, y1], [x2, y2]] = cal.pts;
    const px = Math.hypot(x2 - x1, y2 - y1);
    if (len > 0 && px > 0) { pxPerCm = px / len; applyRealSize(); }
    endCal();
  });
  room.addEventListener('click', (e) => { if (e.target.closest('[data-cal-cancel]')) endCal(); });
  function endCal() { cal = null; $('#r-cal').hidden = true; hint(); draw(); }

  // Pointer: drag to move, two fingers to pinch-resize, taps for calibration.
  const pointers = new Map();
  let gesture = null;
  const toPhoto = (e) => {
    const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width;
    return [((e.clientX - r.left) * dpr - view.ox) / view.s, ((e.clientY - r.top) * dpr - view.oy) / view.s];
  };
  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) gesture = { kind: 'move', start: pts[0], x: st.x, y: st.y };
    else if (pts.length === 2) {
      gesture = { kind: 'pinch', d: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]), w: st.w,
        mid: [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], x: st.x, y: st.y };
    }
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!bg) return;
    if (cal) {
      if (cal.pts.length < 2) cal.pts.push(toPhoto(e));
      if (cal.pts.length === 2) { $('#r-cal').hidden = false; $('#r-cal-len').focus(); hint(''); }
      draw();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toPhoto(e));
    startGesture();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, toPhoto(e));
    const pts = [...pointers.values()];
    if (gesture.kind === 'move' && pts.length === 1) {
      st.x = gesture.x + pts[0][0] - gesture.start[0];
      st.y = gesture.y + pts[0][1] - gesture.start[1];
    } else if (gesture.kind === 'pinch' && pts.length === 2) {
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      st.w = clampW(gesture.w * (d / gesture.d));
      st.x = gesture.x + (pts[0][0] + pts[1][0]) / 2 - gesture.mid[0];
      st.y = gesture.y + (pts[0][1] + pts[1][1]) / 2 - gesture.mid[1];
      syncSlider();
    }
    draw();
  });
  const endPointer = (e) => { pointers.delete(e.pointerId); gesture = null; if (pointers.size) startGesture(); };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  const clampW = (w) => Math.max(bg.width * 0.02, Math.min(bg.width * 0.95, w));
  canvas.addEventListener('wheel', (e) => {
    if (!bg) return;
    e.preventDefault();
    st.w = clampW(st.w * Math.exp(-e.deltaY * 0.0015));
    syncSlider(); draw();
  }, { passive: false });

  // Save the composed picture to the visitor's device (generated locally).
  $('#r-save').addEventListener('click', () => {
    const out = Object.assign(document.createElement('canvas'), { width: bg.width, height: bg.height });
    render(out.getContext('2d'), 1, 0, 0, false);
    out.toBlob((blob) => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${painting().id}-on-my-wall.jpg` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/jpeg', 0.9);
  });

  // ---------- Open / close ----------
  async function open() {
    if (!window.gallery.list.length) return;
    room.hidden = false;
    document.body.classList.add('room-open');
    document.body.style.overflow = 'hidden';
    if (!bg) setBackground(sampleRoom(), true); else fit();
    await loadArt(window.gallery.pos);
    applyRealSize();
    $('#r-frame').value = frame;
    draw();
  }
  function close() {
    room.hidden = true; endCal();
    document.body.classList.remove('room-open');
    document.body.style.overflow = '';
    if (idx !== window.gallery.pos) window.gallery.go(idx);
  }
  $('#i-wall').addEventListener('click', open);
  $('.r-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (room.hidden || e.target.closest?.('input, select')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') loadArt(idx + 1);
    else if (e.key === 'ArrowLeft') loadArt(idx - 1);
  });
  window.addEventListener('resize', () => { if (!room.hidden) fit(); });
})();
