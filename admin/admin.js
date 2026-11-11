(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------- Image settings: web/mobile quality, deliberately too small to print ----------
  const FULL_MAX = 1600, FULL_Q = 0.78;   // ~250-450 KB, ~5" at 300 dpi
  const THUMB_MAX = 600, THUMB_Q = 0.72;  // ~40-70 KB
  const PAINTINGS = 'data/paintings.json';
  const SITE = 'data/site.json';

  // ---------- Config ----------
  const CFG_KEY = 'gallery-admin-config';
  const loadCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; } };
  let cfg = loadCfg();
  const saveCfg = (c) => { cfg = c; localStorage.setItem(CFG_KEY, JSON.stringify(c)); };

  // Guess owner/repo when served from <owner>.github.io/<repo>/admin/
  function guessRepo() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return {};
    const seg = location.pathname.split('/').filter(Boolean);
    const repo = seg.length && seg[0] !== 'admin' ? seg[0] : `${m[1]}.github.io`;
    return { owner: m[1], repo };
  }
  const siteUrl = () => {
    const g = guessRepo();
    if (g.owner) return new URL('../', location.href).href;
    return cfg.repo?.toLowerCase() === `${cfg.owner?.toLowerCase()}.github.io`
      ? `https://${cfg.owner}.github.io/` : `https://${cfg.owner}.github.io/${cfg.repo}/`;
  };
  const rawUrl = (path) => `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${path}`;

  // ---------- GitHub API ----------
  class GhError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  async function gh(method, path, body) {
    const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch {}
      if (res.status === 401) msg = 'Token is invalid or expired. Open ⚙ and enter a new token.';
      if (res.status === 403 || res.status === 404) msg = `${msg} — check the token has access to ${cfg.owner}/${cfg.repo} with Contents: Read and write.`;
      throw new GhError(res.status, msg);
    }
    return res.status === 204 ? null : res.json();
  }

  const b64ToText = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const blobToB64 = (blob) => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });

  async function headSha() { return (await gh('GET', `/git/ref/heads/${encodeURIComponent(cfg.branch)}`)).object.sha; }
  async function readJson(path, ref) {
    try {
      const f = await gh('GET', `/contents/${path}?ref=${ref}`);
      return JSON.parse(b64ToText(f.content));
    } catch (e) { if (e.status === 404) return null; throw e; }
  }

  /**
   * Atomic commit with optimistic concurrency.
   * uploads: [{path, blob}]  – binary files, uploaded once.
   * mutate(json) -> { json, deletes?: [path] } – re-applied on fresh data if the branch moved.
   */
  async function commit(message, jsonPath, uploads, mutate) {
    busy('Uploading…');
    const blobs = [];
    for (const u of uploads) {
      const r = await gh('POST', '/git/blobs', { content: await blobToB64(u.blob), encoding: 'base64' });
      blobs.push({ path: u.path, mode: '100644', type: 'blob', sha: r.sha });
    }
    busy('Publishing…');
    for (let attempt = 0; attempt < 3; attempt++) {
      const parent = await headSha();
      const base = await gh('GET', `/git/commits/${parent}`);
      const current = await readJson(jsonPath, parent);
      const { json, deletes = [] } = mutate(current);
      const tree = [
        ...blobs,
        { path: jsonPath, mode: '100644', type: 'blob', content: JSON.stringify(json, null, 2) + '\n' },
        ...deletes.filter(Boolean).map((p) => ({ path: p, mode: '100644', type: 'blob', sha: null })),
      ];
      let newTree;
      try {
        newTree = await gh('POST', '/git/trees', { base_tree: base.tree.sha, tree });
      } catch (e) {
        // deleting a path that no longer exists fails; retry without deletes
        if (e.status === 422 && deletes.length) {
          newTree = await gh('POST', '/git/trees', { base_tree: base.tree.sha, tree: tree.filter((t) => t.sha !== null) });
        } else throw e;
      }
      const c = await gh('POST', '/git/commits', { message, tree: newTree.sha, parents: [parent] });
      try {
        await gh('PATCH', `/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { sha: c.sha, force: false });
        return json;
      } catch (e) {
        if (e.status === 422 && attempt < 2) continue; // branch moved: retry on top of it
        throw e;
      }
    }
  }

  // ---------- Image processing ----------
  async function decode(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  // Progressive halving gives much sharper results than a single big downscale.
  function resize(src, max) {
    let w = src.width, h = src.height;
    const scale = Math.min(1, max / Math.max(w, h));
    const tw = Math.round(w * scale), th = Math.round(h * scale);
    let cur = src;
    while (w / 2 > tw) {
      w = Math.round(w / 2); h = Math.round(h / 2);
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, w, h);
      cur = c;
    }
    const out = Object.assign(document.createElement('canvas'), { width: tw, height: th });
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tw, th); // flatten transparency
    ctx.drawImage(cur, 0, 0, tw, th);
    return out;
  }
  const toJpeg = (canvas, q) => new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Image encoding failed'))), 'image/jpeg', q));

  // Canvas re-encoding also strips EXIF metadata (GPS location, camera info).
  async function processImage(file) {
    const bmp = await decode(file);
    const fullC = resize(bmp, FULL_MAX);
    const [full, thumb] = await Promise.all([toJpeg(fullC, FULL_Q), toJpeg(resize(fullC, THUMB_MAX), THUMB_Q)]);
    bmp.close?.();
    return { full, thumb, width: fullC.width, height: fullC.height };
  }

  // ---------- UI helpers ----------
  const toastEl = $('#toast');
  let toastT;
  function toast(msg, err = false) {
    toastEl.textContent = msg; toastEl.classList.toggle('err', err); toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), err ? 7000 : 3500);
  }
  const busy = (text) => { $('#busy-text').textContent = text; $('#busy').hidden = false; };
  const idle = () => { $('#busy').hidden = true; };
  async function run(fn) {
    try { return await fn(); }
    catch (e) { console.error(e); toast(e.message || String(e), true); }
    finally { idle(); }
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const views = ['connect', 'list', 'edit', 'site'];
  let currentView = null;
  function showView(name, title) {
    currentView = name;
    views.forEach((v) => ($(`#view-${v}`).hidden = v !== name));
    $('#bar-title').textContent = title || 'Gallery Admin';
    $('#btn-back').hidden = name === 'list' || (name === 'connect' && !cfg.token);
    $('#btn-site').hidden = $('#btn-settings').hidden = name !== 'list';
    window.scrollTo(0, 0);
  }

  // ---------- State ----------
  let paintings = [];
  const localThumbs = new Map(); // path -> objectURL for just-uploaded images (raw CDN may lag)
  const thumbSrc = (p) => localThumbs.get(p.thumb) || rawUrl(p.thumb);

  const slug = (s) => (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'painting';
  const stamp = () => Date.now().toString(36);

  // ---------- Connect ----------
  function openConnect() {
    const f = $('#form-connect');
    const g = guessRepo();
    f.owner.value = cfg.owner || g.owner || '';
    f.repo.value = cfg.repo || g.repo || '';
    f.branch.value = cfg.branch || 'main';
    f.token.value = cfg.token || '';
    $('#btn-disconnect').hidden = !cfg.token;
    showView('connect', 'Connect');
  }
  $('#form-connect').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const next = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim(), token: f.token.value.trim() };
    run(async () => {
      busy('Checking access…');
      const prev = cfg; cfg = next;
      try {
        const repo = await gh('GET', '');
        if (repo.permissions && !repo.permissions.push) throw new Error('This token cannot write to the repository.');
        await headSha();
      } catch (err) { cfg = prev; throw err; }
      saveCfg(next);
      toast('Connected');
      await openList();
    });
  });
  $('#btn-disconnect').addEventListener('click', () => {
    if (!confirm('Remove the saved token from this device?')) return;
    localStorage.removeItem(CFG_KEY); cfg = {}; openConnect();
  });

  // ---------- List ----------
  async function refresh() {
    busy('Loading…');
    const data = await readJson(PAINTINGS, cfg.branch);
    paintings = data?.paintings || [];
  }
  async function openList(reload = true) {
    showView('list', 'Paintings');
    $('#site-link').href = siteUrl();
    await run(async () => { if (reload) await refresh(); renderList(); });
  }
  function renderList() {
    $('#list-empty').hidden = paintings.length > 0;
    $('#list').innerHTML = paintings.map((p, i) => `
      <li data-i="${i}">
        <img src="${esc(thumbSrc(p))}" alt="" loading="lazy">
        <div class="txt" data-edit="${i}">
          <div class="t">${esc(p.title)}</div>
          <div class="m">${esc([p.medium, p.width && p.height ? `${p.width}×${p.height} ${p.unit}` : '', p.year, p.status].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="ord">
          <button data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">&#9650;</button>
          <button data-move="1" ${i === paintings.length - 1 ? 'disabled' : ''} aria-label="Move down">&#9660;</button>
        </div>
      </li>`).join('');
    const mediums = [...new Set(paintings.map((p) => p.medium).filter(Boolean))];
    $('#mediums').innerHTML = mediums.map((m) => `<option value="${esc(m)}">`).join('');
  }
  $('#list').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return openEdit(paintings[+ed.dataset.edit]);
    const mv = e.target.closest('[data-move]');
    if (!mv) return;
    const p = paintings[+mv.closest('li').dataset.i];
    const delta = +mv.dataset.move;
    run(async () => {
      const json = await commit(`Reorder: ${p.title}`, PAINTINGS, [], (cur) => {
        const list = cur?.paintings || [];
        const i = list.findIndex((x) => x.id === p.id);
        const j = i + delta;
        if (i >= 0 && j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
        return { json: { ...cur, paintings: list } };
      });
      paintings = json.paintings; renderList();
    });
  });
  $('#btn-add').addEventListener('click', () => openEdit(null));

  // ---------- Edit ----------
  let editing = null;   // existing painting or null for new
  let pendingImage = null;

  function openEdit(p) {
    editing = p; pendingImage = null;
    const f = $('#form-edit');
    f.reset();
    for (const k of ['title', 'medium', 'width', 'height', 'year', 'status', 'description']) f.elements[k].value = p?.[k] ?? '';
    f.unit.value = p?.unit || 'cm';
    const img = $('#edit-preview');
    img.hidden = !p; $('#edit-noimg').hidden = !!p;
    if (p) img.src = thumbSrc(p);
    $('#photo-info').textContent = '';
    $('#btn-delete').hidden = !p;
    showView('edit', p ? 'Edit painting' : 'New painting');
  }

  async function setPhoto(file) {
    await run(async () => {
      busy('Preparing photo…');
      pendingImage = await processImage(file);
      const img = $('#edit-preview');
      img.src = URL.createObjectURL(pendingImage.thumb);
      img.hidden = false; $('#edit-noimg').hidden = true;
      const kb = (b) => Math.round(b.size / 1024);
      $('#photo-info').textContent = `Will upload ${pendingImage.width}×${pendingImage.height}px, ${kb(pendingImage.full)} KB (thumbnail ${kb(pendingImage.thumb)} KB).`;
    });
  }
  $$('[data-photo]').forEach((inp) => inp.addEventListener('change', () => { if (inp.files[0]) setPhoto(inp.files[0]); inp.value = ''; }));

  $('#form-edit').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (!editing && !pendingImage) return toast('Please add a photo of the painting.', true);
    const num = (v) => (v === '' ? null : Number(v));
    const fields = {
      title: f.elements.title.value.trim(),
      year: num(f.year.value),
      medium: f.medium.value.trim(),
      width: num(f.width.value),
      height: num(f.height.value),
      unit: f.unit.value,
      description: f.description.value.trim(),
      status: f.status.value.trim(),
    };
    run(async () => {
      const id = editing?.id || `${slug(fields.title)}-${stamp()}`;
      const uploads = [];
      let imgFields = {};
      if (pendingImage) {
        const v = stamp();
        imgFields = {
          image: `images/full/${id}-${v}.jpg`,
          thumb: `images/thumb/${id}-${v}.jpg`,
          imageWidth: pendingImage.width,
          imageHeight: pendingImage.height,
        };
        uploads.push({ path: imgFields.image, blob: pendingImage.full }, { path: imgFields.thumb, blob: pendingImage.thumb });
        localThumbs.set(imgFields.thumb, URL.createObjectURL(pendingImage.thumb));
      }
      const json = await commit(`${editing ? 'Update' : 'Add'} painting: ${fields.title}`, PAINTINGS, uploads, (cur) => {
        const list = cur?.paintings || [];
        const i = list.findIndex((x) => x.id === id);
        const old = i >= 0 ? list[i] : null;
        const updated = { id, ...(old || {}), ...fields, ...imgFields };
        if (old) list[i] = updated; else list.unshift(updated);
        const deletes = old && pendingImage ? [old.image, old.thumb] : [];
        return { json: { ...(cur || {}), paintings: list }, deletes };
      });
      paintings = json.paintings;
      toast('Published. The website updates within a minute or two.');
      openList(false);
    });
  });

  $('#btn-delete').addEventListener('click', () => {
    const p = editing;
    if (!p || !confirm(`Delete “${p.title}” from the website?`)) return;
    run(async () => {
      const json = await commit(`Delete painting: ${p.title}`, PAINTINGS, [], (cur) => {
        const list = (cur?.paintings || []);
        const old = list.find((x) => x.id === p.id);
        return { json: { ...cur, paintings: list.filter((x) => x.id !== p.id) }, deletes: old ? [old.image, old.thumb] : [] };
      });
      paintings = json.paintings;
      toast('Deleted.');
      openList(false);
    });
  });

  // ---------- Site settings ----------
  async function openSite() {
    showView('site', 'Site settings');
    await run(async () => {
      busy('Loading…');
      const s = (await readJson(SITE, cfg.branch)) || {};
      const f = $('#form-site');
      for (const k of ['artistName', 'tagline', 'about', 'email']) f.elements[k].value = s[k] || '';
    });
  }
  $('#form-site').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const vals = Object.fromEntries(['artistName', 'tagline', 'about', 'email'].map((k) => [k, f.elements[k].value.trim()]));
    run(async () => {
      await commit('Update site settings', SITE, [], (cur) => ({ json: { ...(cur || {}), ...vals } }));
      toast('Published.');
      openList(false);
    });
  });

  // ---------- Navigation ----------
  $('#btn-back').addEventListener('click', () => openList(false));
  $('#btn-settings').addEventListener('click', openConnect);
  $('#btn-site').addEventListener('click', openSite);

  // ---------- Android "Share to" support (see sw.js) ----------
  async function takeSharedFile() {
    if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return null;
    history.replaceState(null, '', location.pathname);
    const cache = await caches.open('share-target');
    const res = await cache.match('shared-image');
    if (!res) return null;
    await cache.delete('shared-image');
    return new File([await res.blob()], 'shared.jpg', { type: res.headers.get('Content-Type') || 'image/jpeg' });
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  (async () => {
    if (!cfg.token) return openConnect();
    const shared = await takeSharedFile();
    await openList();
    if (shared) { openEdit(null); setPhoto(shared); }
  })();
})();
