const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const vp = $('#vp'), vctx = vp.getContext('2d');

const S = {
  doc: { w: 1920, h: 1080 },
  layers: [],            // 0 = 맨 아래. { id, name, img, role, x, y, w, h, flip, visible, locked, opacity, ver, alpha }
  sel: null,
  view: { zoom: 0.5, ox: 0, oy: 0 },
  p: defaultSettings(),
  strength: 1,
  compare: false,        // true면 보정 숨기고 원본만
  feel: null,
  basicTab: 'character',
  fxTab: -1,
  interacting: false,
  lockRatio: false,      // 터치용 비율 고정 (Shift와 같은 역할)
};
let nextId = 1;
let opacitySync = null;  // 레이어 불투명도 슬라이더 동기화 (아래에서 만듦)
const filterCache = new Map();
let sceneCache = { key: '', canvas: null };

// ======================= 레이어 =======================
function newLayer(name) {
  const L = { id: nextId++, name: name || `레이어 ${nextId - 1}`, img: null, role: 'none', x: 0, y: 0, w: 0, h: 0,
    flip: false, visible: true, locked: false, opacity: 1, ver: 0, alpha: null, autoName: !name };
  const i = selIndex();
  S.layers.splice(i >= 0 ? i + 1 : S.layers.length, 0, L);
  S.sel = L.id;
  changed(); return L;
}
function selLayer() { return S.layers.find(l => l.id === S.sel) || null; }
function selIndex() { return S.layers.findIndex(l => l.id === S.sel); }

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('이미지를 읽을 수 없습니다: ' + file.name));
    img.src = URL.createObjectURL(file);
  });
}
function hasTransparency(img) {
  const c = makeCanvas(64, 64), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, 64, 64); const d = x.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) return true;
  return false;
}
function buildAlphaMap(img) {
  const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = makeCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return { w, h, a };
}
// 이미지를 레이어에 넣는다. 캔버스 크기는 바꾸지 않는다.
async function putImage(L, file) {
  const img = await loadImage(file);
  const fresh = !L.img;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (fresh) {
    const k = Math.min(1, S.doc.w / nw, S.doc.h / nh); // 캔버스보다 크면 안에 들어오게만 줄임
    L.w = nw * k; L.h = nh * k; L.x = (S.doc.w - L.w) / 2; L.y = (S.doc.h - L.h) / 2;
    if (L.role === 'none') L.role = hasTransparency(img) ? 'character' : 'background'; // 추측: 투명 = 인물
  } else { // 기존 자리의 가운데와 높이를 유지
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2; L.h = L.h || nh; L.w = L.h * nw / nh; L.x = cx - L.w / 2; L.y = cy - L.h / 2;
  }
  L.img = img; L.ver++; L.alpha = buildAlphaMap(img);
  if (L.autoName) L.name = file.name;
  filterCache.delete(L.id);
  changed();
  status(`'${file.name}'을(를) ${L.name === file.name ? '레이어' : `'${L.name}'`}에 넣었어요. (${roleName(L.role)} 레이어)`);
}
async function openFiles(files, target) {
  files = [...files].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  try {
    let L = target || selLayer();
    for (let i = 0; i < files.length; i++) {
      if (!L || (i > 0)) L = newLayer();
      await putImage(L, files[i]);
    }
    if (S.layers.filter(l => l.img).length === 1) fitView();
  } catch (e) { status(e.message); }
}
function roleName(r) { return r === 'character' ? '인물' : r === 'background' ? '배경' : '일반'; }

// ---------- 레이어 패널 ----------
const icon = (id, cls = '') => `<svg class="ic ${cls}"><use href="#i-${id}"/></svg>`;
function renderLayers() {
  if (ldrag && ldrag.active) return; // 끌어서 옮기는 중에는 다시 그리지 않음
  const box = $('#layerList'); box.innerHTML = '';
  if (!S.layers.length) { box.innerHTML = '<div class="empty-note">레이어가 없어요.<br>아래 ＋ 버튼을 누르거나<br>이미지를 창에 끌어 놓으세요.</div>'; }
  for (const L of [...S.layers].reverse()) {
    const r = document.createElement('div');
    r.className = 'lrow' + (L.id === S.sel ? ' sel' : '') + (L.visible ? '' : ' off'); r.dataset.id = L.id;
    r.title = '끌어서 순서 바꾸기 · 이름을 두 번 클릭하면 이름 바꾸기 · 오른쪽 클릭: 메뉴';
    r.innerHTML = `<button class="eye" title="보이기/숨기기">${icon(L.visible ? 'eye' : 'eye-off')}</button>
      <div class="thumb">${L.img ? `<img src="${L.img.src}" draggable="false" alt="">` : ''}</div>
      <div class="lmain"><div class="lname"></div>
        <div class="lmeta"><span class="tag ${L.role}">${roleName(L.role)}</span>${L.opacity < 1 ? `<span class="meta">${Math.round(L.opacity * 100)}%</span>` : ''}${L.flip ? '<span class="meta">반전</span>' : ''}</div></div>
      <button class="lock ${L.locked ? 'on' : ''}" title="잠금 (움직이지 않게)">${icon(L.locked ? 'lock' : 'unlock')}</button>`;
    r.querySelector('.lname').textContent = L.name + (L.img ? '' : ' (비어 있음)');
    r.onclick = e => {
      if (suppressClick) return;
      if (e.target.closest('.eye')) { L.visible = !L.visible; changed(); return; }
      if (e.target.closest('.lock')) { L.locked = !L.locked; changed(); return; }
      if (e.target.closest('input') || S.sel === L.id) return;
      // 목록을 다시 만들지 않고 선택만 바꿈 (그래야 이름 두 번 클릭이 동작)
      S.sel = L.id; $$('#layerList .lrow').forEach(x => x.classList.toggle('sel', +x.dataset.id === L.id));
      syncLayerProps(); draw();
    };
    r.oncontextmenu = e => { e.preventDefault(); S.sel = L.id; changed(); openCtxMenu(e.clientX, e.clientY); };
    r.querySelector('.lname').ondblclick = e => {
      const el = e.currentTarget, inp = document.createElement('input'); inp.type = 'text'; inp.value = L.name;
      el.innerHTML = ''; el.appendChild(inp); inp.focus(); inp.select();
      const done = () => { L.name = inp.value.trim() || L.name; L.autoName = false; renderLayers(); };
      inp.onblur = done; inp.onkeydown = k => { if (k.key === 'Enter') inp.blur(); if (k.key === 'Escape') { inp.value = L.name; inp.blur(); } };
    };
    // 레이어 줄 위로 이미지 파일 바로 끌어 놓기
    r.ondragover = e => { e.preventDefault(); e.stopPropagation(); r.classList.add('dropping'); };
    r.ondragleave = () => r.classList.remove('dropping');
    r.ondrop = e => { e.preventDefault(); e.stopPropagation(); r.classList.remove('dropping'); $('#stage').classList.remove('drag'); S.sel = L.id; openFiles(e.dataTransfer.files, L); };
    box.appendChild(r);
  }
  const nc = S.layers.filter(l => l.role === 'character' && l.img).length, nb = S.layers.filter(l => l.role === 'background' && l.img).length;
  $('#roleSummary').innerHTML = `인물 <b>${nc}</b> · 배경 <b>${nb}</b>` +
    (!nc || !nb ? ' — 인물과 배경을 하나 이상 지정하면 자동 맞춤을 쓸 수 있어요.' : '');
  syncLayerProps();
}

// 선택한 레이어의 속성 줄 (필터 대상 + 불투명도): 클립 스튜디오/포토샵의 레이어 패널 윗줄처럼
function syncLayerProps() {
  const L = selLayer();
  $('#layerProps').classList.toggle('disabled', !L);
  $$('#roleSeg button').forEach(b => b.classList.toggle('on', !!L && L.role === b.dataset.role));
  if (opacitySync) opacitySync();
}
$$('#roleSeg button').forEach(b => b.onclick = () => {
  const L = selLayer(); if (!L) return status('레이어를 먼저 선택하세요.');
  L.role = b.dataset.role; filterCache.delete(L.id); changed();
  status(`'${L.name}'을(를) ${roleName(L.role)} 레이어로 지정했어요.`);
});

// ---------- 레이어 끌어서 순서 바꾸기 ----------
// 마우스: 누른 채 4px 이상 움직이면 시작. 터치: 0.28초 길게 누른 뒤 움직이면 시작 (그냥 쓸면 목록 스크롤).
let ldrag = null, suppressClick = false;
const LIST = $('#layerList');
LIST.addEventListener('pointerdown', e => {
  const row = e.target.closest('.lrow');
  if (!row || e.button !== 0 || e.target.closest('button, input')) return;
  ldrag = { id: +row.dataset.id, row, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, pid: e.pointerId, active: false, touch: e.pointerType === 'touch' };
  if (ldrag.touch) { const d = ldrag; d.timer = setTimeout(() => { if (ldrag === d) startLayerDrag(); }, 280); }
});
window.addEventListener('pointermove', e => {
  if (!ldrag || e.pointerId !== ldrag.pid) return;
  ldrag.x = e.clientX; ldrag.y = e.clientY;
  if (!ldrag.active) {
    const dist = Math.hypot(e.clientX - ldrag.x0, e.clientY - ldrag.y0);
    if (ldrag.touch) { if (dist > 8) { clearTimeout(ldrag.timer); ldrag = null; } return; }
    if (dist < 4) return;
    startLayerDrag();
  }
  moveLayerDrag();
});
window.addEventListener('pointerup', e => { if (ldrag && e.pointerId === ldrag.pid) endLayerDrag(true); });
window.addEventListener('pointercancel', e => { if (ldrag && e.pointerId === ldrag.pid) endLayerDrag(false); });
LIST.addEventListener('touchmove', e => { if (ldrag && ldrag.active) e.preventDefault(); }, { passive: false });
function startLayerDrag() {
  const d = ldrag, rect = d.row.getBoundingClientRect();
  d.active = true; suppressClick = true;
  d.ghost = d.row.cloneNode(true); d.ghost.classList.add('ghost'); d.ghost.removeAttribute('title');
  Object.assign(d.ghost.style, { width: rect.width + 'px', left: rect.left + 'px', top: rect.top + 'px' });
  d.offY = d.y0 - rect.top;
  document.body.appendChild(d.ghost); document.body.classList.add('reordering');
  d.row.classList.add('dragging');
  d.line = document.createElement('div'); d.line.className = 'dropline'; LIST.appendChild(d.line);
  moveLayerDrag();
}
function moveLayerDrag() {
  const d = ldrag, lr = LIST.getBoundingClientRect();
  d.ghost.style.top = clamp(d.y - d.offY, lr.top - 20, lr.bottom - 20) + 'px';
  if (d.y < lr.top + 28) LIST.scrollTop -= 10; else if (d.y > lr.bottom - 28) LIST.scrollTop += 10;
  const rows = $$('#layerList .lrow');
  let k = rows.findIndex(r => { const b = r.getBoundingClientRect(); return d.y < b.top + b.height / 2; });
  if (k < 0) k = rows.length;
  d.k = k;
  const top = k < rows.length ? rows[k].offsetTop : (rows.length ? rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight : 0);
  d.line.style.top = (top - 1) + 'px';
  const di = rows.indexOf(d.row);
  d.line.hidden = (k === di || k === di + 1); // 제자리면 표시 안 함
}
function endLayerDrag(commit) {
  const d = ldrag; ldrag = null; clearTimeout(d.timer);
  if (!d.active) return;
  d.ghost.remove(); d.line.remove(); d.row.classList.remove('dragging'); document.body.classList.remove('reordering');
  setTimeout(() => { suppressClick = false; }, 0);
  if (commit) {
    const order = [...S.layers].reverse(), di = order.findIndex(l => l.id === d.id);
    let k = d.k; if (k > di) k--;
    if (k !== di && di >= 0) {
      const [L] = order.splice(di, 1); order.splice(k, 0, L);
      S.layers = order.reverse(); S.sel = L.id;
      changed(); status(`'${L.name}' 레이어의 순서를 바꿨어요.`); return;
    }
    const L = S.layers.find(l => l.id === d.id); if (L) S.sel = L.id;
  }
  changed();
}

// ---------- 오른쪽 클릭 메뉴 ----------
function openCtxMenu(x, y) {
  const m = $('#ctxMenu'), L = selLayer(); if (!L) return;
  closeMenus();
  $$('#ctxMenu [data-role]').forEach(b => b.classList.toggle('checked', b.dataset.role === L.role));
  $('#ctxLock').classList.toggle('checked', L.locked);
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, innerWidth - w - 6) + 'px'; m.style.top = Math.min(y, innerHeight - h - 6) + 'px';
}
$('#docInfo').onclick = () => cmd('canvasSize');
$('#zoomInfo').onclick = () => cmd('zoomFit');

// ======================= 뷰포트 / 그리기 =======================
const dpr = () => window.devicePixelRatio || 1;
function fitView() {
  const r = $('#stage').getBoundingClientRect(), pad = 40;
  const z = Math.min((r.width - pad * 2) / S.doc.w, (r.height - pad * 2) / S.doc.h);
  S.view.zoom = Math.max(0.02, z); S.view.ox = (r.width - S.doc.w * S.view.zoom) / 2; S.view.oy = (r.height - S.doc.h * S.view.zoom) / 2;
  draw();
}
function zoomAt(k, sx, sy) {
  const v = S.view, nz = clamp(v.zoom * k, 0.02, 16);
  v.ox = sx - (sx - v.ox) * nz / v.zoom; v.oy = sy - (sy - v.oy) * nz / v.zoom; v.zoom = nz; draw();
}
function docDiag() { return Math.hypot(S.doc.w, S.doc.h); }
function filterKey(L, rs) {
  const p = S.p, role = L.role;
  const fx = Object.entries(p.effects).filter(([, f]) => f.on && f.target === role);
  return JSON.stringify([role, p.basic[role], p.colors.filter(c => c.target === role), p.autoColor, p.light,
    role === 'character' ? p.glow : 0, fx, Math.round(L.w * rs), Math.round(L.h * rs), L.flip, L.ver, S.doc]);
}
function getLayerFilter(L, rs) {
  const key = filterKey(L, rs), c = filterCache.get(L.id);
  if (c && c.key === key) return c.canvas;
  const canvas = keepCanvas(buildLayerFilter(L, rs, S.p, docDiag()));
  if (c) freeCanvas(c.canvas);
  filterCache.set(L.id, { key, canvas });
  return canvas;
}
function drawOriginal(x, L, rs) {
  const X = L.x * rs, Y = L.y * rs, W = L.w * rs, H = L.h * rs;
  if (L.flip) { x.save(); x.translate(X + W, Y); x.scale(-1, 1); x.drawImage(L.img, 0, 0, W, H); x.restore(); }
  else x.drawImage(L.img, X, Y, W, H);
}
// 장면 합성: 원본 → (보정 켜짐이면) 레이어별 필터 층 → 화면 전체 보정 층
function composeScene(rs, withFx) {
  const c = makeCanvas(S.doc.w * rs, S.doc.h * rs), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  for (const L of S.layers) {
    if (!L.visible || !L.img) continue;
    x.globalAlpha = L.opacity; drawOriginal(x, L, rs);
    if (withFx && L.role !== 'none' && S.strength > 0) {
      x.globalAlpha = L.opacity * S.strength;
      x.drawImage(getLayerFilter(L, rs), L.x * rs, L.y * rs, L.w * rs, L.h * rs);
    }
  }
  x.globalAlpha = 1;
  if (withFx && S.strength > 0) {
    const pass = buildScenePass(c, S.p, rs, docDiag());
    if (pass) { x.globalAlpha = S.strength; x.drawImage(pass, 0, 0); }
  }
  return c;
}
function getScene() {
  const rs = Math.min(1, S.view.zoom * dpr() * (S.interacting ? 0.6 : 1));
  const key = JSON.stringify([rs, S.compare, S.strength, S.p, S.doc, S.layers.map(l => [l.id, l.x, l.y, l.w, l.h, l.flip, l.visible, l.role, l.opacity, l.ver])]);
  if (sceneCache.key !== key) { const old = sceneCache.canvas; sceneCache = { key, canvas: keepCanvas(composeScene(rs, !S.compare)) }; freeCanvas(old); }
  return sceneCache.canvas;
}
let checker = null;
function draw() {
  if (draw.raf) return;
  draw.raf = requestAnimationFrame(() => { draw.raf = 0; drawNow(); });
}
function drawNow() {
  const r = $('#stage').getBoundingClientRect(), d = dpr();
  if (vp.width !== Math.round(r.width * d) || vp.height !== Math.round(r.height * d)) { vp.width = Math.round(r.width * d); vp.height = Math.round(r.height * d); }
  const x = vctx, v = S.view;
  x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#151517'; x.fillRect(0, 0, vp.width, vp.height);
  x.setTransform(d, 0, 0, d, 0, 0);
  const W = S.doc.w * v.zoom, H = S.doc.h * v.zoom;
  // 캔버스 바깥으로 나간 선택 레이어는 흐리게 보여줌
  const L = selLayer();
  if (L && L.img && L.visible) {
    x.save(); x.globalAlpha = 0.28; x.translate(v.ox, v.oy); x.scale(v.zoom, v.zoom); drawOriginal(x, L, 1); x.restore();
  }
  if (!checker) { checker = keepCanvas(makeCanvas(16, 16)); const c = checker.getContext('2d'); c.fillStyle = '#2c2d33'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#37383f'; c.fillRect(0, 0, 8, 8); c.fillRect(8, 8, 8, 8); }
  x.fillStyle = x.createPattern(checker, 'repeat'); x.fillRect(v.ox, v.oy, W, H);
  x.imageSmoothingQuality = 'high';
  x.drawImage(getScene(), v.ox, v.oy, W, H);
  x.strokeStyle = '#000'; x.lineWidth = 1; x.strokeRect(v.ox - 0.5, v.oy - 0.5, W + 1, H + 1);
  if (L && L.img) {
    const [sx, sy] = toScreen(L.x, L.y), sw = L.w * v.zoom, sh = L.h * v.zoom;
    x.strokeStyle = L.locked ? '#888' : '#7b86ff'; x.lineWidth = 1.2; x.setLineDash([5, 4]); x.strokeRect(sx, sy, sw, sh); x.setLineDash([]);
    if (!L.locked) for (const h of handles(L)) { x.fillStyle = '#fff'; x.strokeStyle = '#4b68ff'; x.fillRect(h.sx - 4.5, h.sy - 4.5, 9, 9); x.strokeRect(h.sx - 4.5, h.sy - 4.5, 9, 9); }
  }
  releaseTemps();
  $('#zoomInfo').textContent = `${Math.round(v.zoom * 100)}%`;
  $('#docInfo').textContent = `${S.doc.w} × ${S.doc.h}`;
  $('#compareBadge').hidden = !S.compare;
}
function toScreen(x, y) { return [S.view.ox + x * S.view.zoom, S.view.oy + y * S.view.zoom]; }
function toDoc(e) { const r = vp.getBoundingClientRect(); return { x: (e.clientX - r.left - S.view.ox) / S.view.zoom, y: (e.clientY - r.top - S.view.oy) / S.view.zoom, sx: e.clientX - r.left, sy: e.clientY - r.top }; }
function handles(L) {
  const out = [];
  for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) {
    if (!hx && !hy) continue;
    const [sx, sy] = toScreen(L.x + L.w * (hx + 1) / 2, L.y + L.h * (hy + 1) / 2);
    out.push({ hx, hy, sx, sy });
  }
  return out;
}
const CURSORS = { '-1,-1': 'nwse-resize', '1,1': 'nwse-resize', '1,-1': 'nesw-resize', '-1,1': 'nesw-resize', '0,-1': 'ns-resize', '0,1': 'ns-resize', '-1,0': 'ew-resize', '1,0': 'ew-resize' };
function handleAt(p, touch) { const L = selLayer(), r = touch ? 18 : 8; if (!L || !L.img || L.locked) return null; return handles(L).find(h => Math.abs(h.sx - p.sx) < r && Math.abs(h.sy - p.sy) < r) || null; }
function hitLayer(p) {
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const L = S.layers[i];
    if (!L.visible || !L.img) continue;
    if (p.x < L.x || p.y < L.y || p.x > L.x + L.w || p.y > L.y + L.h) continue;
    let u = (p.x - L.x) / L.w; if (L.flip) u = 1 - u; const v = (p.y - L.y) / L.h, a = L.alpha;
    if (a.a[clamp(Math.floor(v * a.h), 0, a.h - 1) * a.w + clamp(Math.floor(u * a.w), 0, a.w - 1)] > 20) return L;
  }
  return null;
}

// ======================= 마우스 =======================
let drag = null, spaceDown = false;
const touches = new Map(); // 손가락 두 개: 확대/축소 + 화면 이동
function pinchInfo() { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
vp.addEventListener('pointerdown', e => {
  try { vp.setPointerCapture(e.pointerId); } catch {}
  const p = toDoc(e);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: p.sx, y: p.sy });
    if (touches.size === 2) {
      if (drag && drag.L && drag.start) Object.assign(drag.L, drag.start); // 한 손가락으로 움직이던 것은 되돌림
      const q = pinchInfo(); drag = { mode: 'pinch', d0: q.d, mx0: q.mx, my0: q.my, z0: S.view.zoom, ox0: S.view.ox, oy0: S.view.oy };
      S.interacting = true; draw(); return;
    }
    if (touches.size > 2) return;
  }
  if (e.button === 1 || spaceDown) { drag = { mode: 'pan', sx: p.sx, sy: p.sy, ox: S.view.ox, oy: S.view.oy }; return; }
  const h = handleAt(p, e.pointerType === 'touch'), L = selLayer();
  if (h) {
    drag = { mode: 'resize', L, h, x0: L.x, y0: L.y, w0: L.w, h0: L.h, start: { x: L.x, y: L.y, w: L.w, h: L.h } };
  } else {
    const hit = (L && L.img && !L.locked && p.x >= L.x && p.y >= L.y && p.x <= L.x + L.w && p.y <= L.y + L.h && e.altKey) ? L : hitLayer(p);
    if (hit) { S.sel = hit.id; renderLayers(); if (!hit.locked) drag = { mode: 'move', L: hit, dx: p.x - hit.x, dy: p.y - hit.y, start: { x: hit.x, y: hit.y } }; }
    else { S.sel = null; renderLayers(); }
  }
  S.interacting = !!drag; draw();
});
vp.addEventListener('pointermove', e => {
  const p = toDoc(e);
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: p.sx, y: p.sy });
  if (drag && drag.mode === 'pinch') {
    if (touches.size < 2) return;
    const q = pinchInfo(), nz = clamp(drag.z0 * q.d / drag.d0, 0.02, 16);
    const px = (drag.mx0 - drag.ox0) / drag.z0, py = (drag.my0 - drag.oy0) / drag.z0;
    S.view.zoom = nz; S.view.ox = q.mx - px * nz; S.view.oy = q.my - py * nz; draw(); return;
  }
  if (!drag) { const h = handleAt(p); vp.style.cursor = spaceDown ? 'grab' : h ? CURSORS[`${h.hx},${h.hy}`] : (hitLayer(p) ? 'move' : 'default'); return; }
  if (drag.mode === 'pan') { S.view.ox = drag.ox + p.sx - drag.sx; S.view.oy = drag.oy + p.sy - drag.sy; draw(); return; }
  const L = drag.L;
  if (drag.mode === 'move') {
    L.x = p.x - drag.dx; L.y = p.y - drag.dy;
    if (e.shiftKey || S.lockRatio) { // Shift(또는 비율 고정 켜짐): 캔버스 가장자리/가운데에 맞춤
      const snap = 10 / S.view.zoom, cand = (v, size, D) => [[0, 0], [D - size, 0], [(D - size) / 2, 0]].map(q => q[0]).find(t => Math.abs(v - t) < snap);
      const sx = cand(L.x, L.w, S.doc.w), sy = cand(L.y, L.h, S.doc.h); if (sx !== undefined) L.x = sx; if (sy !== undefined) L.y = sy;
    }
  } else { // 크기 조절: Shift = 비율 고정, 아니면 자유롭게(가로/세로만 늘리기 가능)
    const { hx, hy } = drag.h, { x0, y0, w0, h0 } = drag;
    const ax = hx === 1 ? x0 : x0 + w0, ay = hy === 1 ? y0 : y0 + h0;
    let w = hx ? Math.max(4, (p.x - ax) * hx) : w0, h = hy ? Math.max(4, (p.y - ay) * hy) : h0;
    if (e.shiftKey || S.lockRatio) {
      if (hx && hy) { const s = Math.max(w / w0, h / h0); w = w0 * s; h = h0 * s; }
      else if (hx) h = h0 * w / w0; else w = w0 * h / h0;
    }
    L.w = w; L.h = h;
    L.x = hx === 1 ? ax : hx === -1 ? ax - w : x0 + (w0 - w) / 2;
    L.y = hy === 1 ? ay : hy === -1 ? ay - h : y0 + (h0 - h) / 2;
  }
  draw();
});
function endPointer(e) {
  touches.delete(e.pointerId);
  if (!drag) return;
  if (drag.mode === 'pinch') { if (touches.size === 0) { drag = null; S.interacting = false; draw(); } return; }
  const was = drag.mode; drag = null; S.interacting = false; if (was !== 'pan') afterMove(); else draw();
}
vp.addEventListener('pointerup', endPointer);
vp.addEventListener('pointercancel', endPointer);
vp.addEventListener('wheel', e => { e.preventDefault(); const p = toDoc(e); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.sx, p.sy); }, { passive: false });
window.addEventListener('resize', () => draw());
function afterMove() { if (S.feel === 'auto') runAuto(true); changed(); }

// ---------- 파일 끌어 놓기 ----------
window.addEventListener('dragover', e => { e.preventDefault(); $('#stage').classList.add('drag'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $('#stage').classList.remove('drag'); });
window.addEventListener('drop', e => { e.preventDefault(); $('#stage').classList.remove('drag'); openFiles(e.dataTransfer.files); });
$('#openFile').onchange = e => { openFiles(e.target.files); e.target.value = ''; };

// ======================= 명령 / 메뉴 / 단축키 =======================
function cmd(name) {
  const L = selLayer(), i = selIndex();
  switch (name) {
    case 'open': $('#openFile').click(); break;
    case 'newLayer': newLayer(); break;
    case 'dupLayer': if (L) { const c = { ...L, id: nextId++, name: L.name + ' 복사', x: L.x + 20, y: L.y + 20 }; S.layers.splice(i + 1, 0, c); S.sel = c.id; changed(); } break;
    case 'delLayer': if (L) { S.layers.splice(i, 1); filterCache.delete(L.id); S.sel = (S.layers[i] || S.layers[i - 1] || {}).id ?? null; changed(); } break;
    case 'roleCharacter': if (L) { L.role = 'character'; changed(); } break;
    case 'roleBackground': if (L) { L.role = 'background'; changed(); } break;
    case 'roleNone': if (L) { L.role = 'none'; changed(); } break;
    case 'fitCover': case 'fitContain': case 'fitNatural': if (L && L.img) {
      const nw = L.img.naturalWidth, nh = L.img.naturalHeight;
      const k = name === 'fitNatural' ? 1 : (name === 'fitCover' ? Math.max : Math.min)(S.doc.w / nw, S.doc.h / nh);
      L.w = nw * k; L.h = nh * k; L.x = (S.doc.w - L.w) / 2; L.y = (S.doc.h - L.h) / 2; afterMove(); } break;
    case 'flip': if (L) { L.flip = !L.flip; afterMove(); } break;
    case 'up': if (L && i < S.layers.length - 1) { S.layers.splice(i, 1); S.layers.splice(i + 1, 0, L); changed(); } break;
    case 'down': if (L && i > 0) { S.layers.splice(i, 1); S.layers.splice(i - 1, 0, L); changed(); } break;
    case 'canvasSize': openSizeDialog(); break;
    case 'rename': { const n = document.querySelector('.lrow.sel .lname'); if (n) n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); break; }
    case 'togglePanel': $('#layersPanel').classList.toggle('collapsed'); layoutChanged(); break;
    case 'toggleDock': { const w = $('#winComp'); if (isDocked(w) && !w.hidden && !$('#dock').classList.contains('collapsed')) { $('#dock').classList.add('collapsed'); layoutChanged(); } else { $('#dock').classList.remove('collapsed'); showWin('winComp'); } break; }
    case 'togglePanels': { // 포토샵/클립 스튜디오의 Tab: 패널 모두 숨기기/보이기
      const lp = $('#layersPanel'), dk = $('#dock'), hide = !(lp.classList.contains('collapsed') && dk.classList.contains('collapsed'));
      lp.classList.toggle('collapsed', hide); dk.classList.toggle('collapsed', hide); layoutChanged(); break; }
    case 'lockRatio': S.lockRatio = !S.lockRatio; $('#ratioBtn').classList.toggle('on', S.lockRatio); $('#ratioItem').classList.toggle('checked', S.lockRatio); status(S.lockRatio ? '비율 고정 켜짐: 크기를 바꿀 때 가로세로 비율이 유지돼요.' : '비율 고정 꺼짐: 가로나 세로만 늘릴 수 있어요.'); break;
    case 'lockLayer': if (L) { L.locked = !L.locked; changed(); } break;
    case 'export': exportPng(); break;
    case 'winComp': { const w = $('#winComp'); if (!w.hidden && !(isDocked(w) && $('#dock').classList.contains('collapsed'))) hideWin(w); else { $('#dock').classList.remove('collapsed'); showWin('winComp'); } break; }
    case 'winFx': { const w = $('#winFx'); if (w.hidden) showWin('winFx'); else hideWin(w); break; }
    case 'dockComp': { const w = $('#winComp'); dockWin(w, !isDocked(w)); showWin('winComp'); break; }
    case 'resetWins': resetWins(); break;
    case 'zoomFit': fitView(); break;
    case 'zoom100': { const r = vp.getBoundingClientRect(); zoomAt(1 / S.view.zoom, r.width / 2, r.height / 2); break; }
    case 'zoomIn': { const r = vp.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); break; }
    case 'zoomOut': { const r = vp.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); break; }
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (b) { closeMenus(); cmd(b.dataset.cmd); return; }
  if (!e.target.closest('#ctxMenu')) $('#ctxMenu').hidden = true;
  const m = e.target.closest('.menu > button');
  if (m) { const menu = m.parentElement, open = menu.classList.contains('open'); closeMenus(); if (!open) menu.classList.add('open'); return; }
  if (!e.target.closest('.drop')) closeMenus();
});
$$('.menu').forEach(m => m.addEventListener('mouseenter', () => { if ($('.menu.open') && !m.classList.contains('open')) { closeMenus(); m.classList.add('open'); } }));
function closeMenus() { $$('.menu.open').forEach(m => m.classList.remove('open')); $('#ctxMenu').hidden = true; syncMenuChecks(); }
function syncMenuChecks() {
  const comp = $('#winComp'), compShown = !comp.hidden && !(isDocked(comp) && $('#dock').classList.contains('collapsed'));
  $('#panelItem').classList.toggle('checked', !$('#layersPanel').classList.contains('collapsed'));
  $('#compItem').classList.toggle('checked', compShown);
  $('#fxItem').classList.toggle('checked', !$('#winFx').hidden);
  $('#dockItem').textContent = isDocked(comp) ? '합성 패널 떼어내기 (떠 있는 창으로)' : '합성 패널 오른쪽에 붙이기';
}
document.addEventListener('contextmenu', e => { if (!e.target.closest('.lrow, input, textarea')) e.preventDefault(); });

window.addEventListener('keydown', e => {
  const typing = e.target.matches('input[type=text], input[type=number]');
  const onControl = e.target.matches('input[type=range], select'); // 슬라이더/선택칸에 있을 땐 방향키·Delete를 그 칸이 씀
  if (e.code === 'Space' && !typing) { spaceDown = true; if (!drag) vp.style.cursor = 'grab'; e.preventDefault(); }
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'o') { e.preventDefault(); cmd('open'); }
  else if (ctrl && e.shiftKey && k === 'n') { e.preventDefault(); cmd('newLayer'); }
  else if (ctrl && e.altKey && k === 'c') { e.preventDefault(); cmd('canvasSize'); }
  else if (ctrl && k === 's') { e.preventDefault(); cmd('export'); }
  else if (ctrl && k === 'j') { e.preventDefault(); cmd('dupLayer'); }
  else if (ctrl && k === '0') { e.preventDefault(); cmd('zoomFit'); }
  else if (ctrl && k === '1') { e.preventDefault(); cmd('zoom100'); }
  else if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); cmd('zoomIn'); }
  else if (ctrl && k === '-') { e.preventDefault(); cmd('zoomOut'); }
  else if (ctrl && k === ']') { e.preventDefault(); cmd('up'); }
  else if (ctrl && k === '[') { e.preventDefault(); cmd('down'); }
  else if (typing) return;
  else if (k === 'f' || k === 'ㄹ') toggleCompare();
  else if (k === 'tab' && !ctrl && !e.altKey) { e.preventDefault(); cmd('togglePanels'); }
  else if (k === 'escape') { closeMenus(); $('#sizeModal').hidden = true; }
  else if (onControl) return;
  else if (k === 'delete') cmd('delLayer');
  else if (k.startsWith('arrow')) {
    const L = selLayer(); if (!L || L.locked) return; e.preventDefault();
    const s = e.shiftKey ? 10 : 1; if (k === 'arrowleft') L.x -= s; if (k === 'arrowright') L.x += s; if (k === 'arrowup') L.y -= s; if (k === 'arrowdown') L.y += s;
    draw(); clearTimeout(afterMove.t); afterMove.t = setTimeout(afterMove, 200);
  }
});
window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; vp.style.cursor = 'default'; } });

// ---------- 보정 전/후 ----------
function toggleCompare() { S.compare = !S.compare; $('#compareBtn').classList.toggle('on', S.compare); status(S.compare ? '보정 전: 원본만 보이는 중이에요. 다시 누르면 보정이 돌아와요.' : ''); draw(); }
$('#compareBtn').onclick = toggleCompare;
$('#exportTop').onclick = () => cmd('export');

// ======================= 패널 · 떠 있는 창 · 도킹 =======================
// 합성 패널은 기본으로 오른쪽에 붙어 있고(프리미어/포토샵의 속성 패널처럼), 제목줄을 끌면 떠 있는 창이 된다.
// 떠 있는 창을 화면 오른쪽 끝으로 끌어다 놓으면 다시 붙는다.
const WKEY = 'illustblend.windows2', LKEY = 'illustblend.layout';
const DOCK = $('#dock');
function readWins() { try { return JSON.parse(localStorage.getItem(WKEY)) || {}; } catch { return {}; } }
function isDocked(w) { return w.parentElement === DOCK; }
function saveWin(w) {
  const all = readWins(), prev = all[w.id] || {};
  const rec = { docked: isDocked(w), hidden: w.hidden, min: w.classList.contains('min'), float: prev.float || null };
  if (!rec.docked) rec.float = { left: w.offsetLeft, top: w.offsetTop, width: w.offsetWidth, height: !rec.min && w.style.height ? parseInt(w.style.height) : (prev.float?.height ?? null) };
  all[w.id] = rec; try { localStorage.setItem(WKEY, JSON.stringify(all)); } catch {}
}
function placeFloat(w, f) {
  const def = Object.fromEntries(w.dataset.def.split(',').map(s => s.split(':')).map(([k, v]) => [k, +v]));
  const width = Math.min(f?.width || def.w, innerWidth - 16);
  w.style.width = width + 'px';
  w.style.left = (f ? f.left : def.left !== undefined ? def.left : innerWidth - width - def.right) + 'px';
  w.style.top = (f ? f.top : def.top) + 'px';
  w.style.height = f?.height ? f.height + 'px' : '';
}
function dockWin(w, on, quiet) {
  if (on) { DOCK.appendChild(w); w.classList.add('docked'); w.removeAttribute('style'); DOCK.classList.remove('collapsed'); }
  else { document.body.appendChild(w); w.classList.remove('docked'); placeFloat(w, readWins()[w.id]?.float); keepInView(w); front(w); }
  if (!quiet) saveWin(w);
  layoutChanged();
}
function hideWin(w) {
  w.hidden = true; saveWin(w); layoutChanged();
  status('닫은 창은 메뉴의 창 → ' + w.dataset.title + '으로 다시 열 수 있어요.');
}
function showWin(id) {
  const w = $('#' + id); w.hidden = false; w.classList.remove('min');
  if (isDocked(w)) DOCK.classList.remove('collapsed'); else { front(w); keepInView(w); }
  saveWin(w); layoutChanged();
}
function resetWins() {
  try { localStorage.removeItem(WKEY); localStorage.removeItem(LKEY); } catch {}
  for (const k of Object.keys(LAYOUT)) delete LAYOUT[k]; applyLayout();
  $('#layersPanel').classList.remove('collapsed');
  for (const w of $$('.fwin')) { w.classList.remove('min'); if (w.dataset.dock) dockWin(w, true, true); else { placeFloat(w, null); keepInView(w); } }
  showWin('winComp');
}
function front(w) { $$('.fwin').forEach(o => o.classList.toggle('front', o === w)); }
function keepInView(w) {
  if (isDocked(w)) return;
  const top = $('#menubar').offsetHeight;
  w.style.left = clamp(w.offsetLeft, Math.min(0, innerWidth - w.offsetWidth), innerWidth - 80) + 'px';
  w.style.top = clamp(w.offsetTop, top, innerHeight - 40) + 'px';
}
// 패널이 보이거나 숨겨지면 캔버스 영역 크기가 바뀜
function layoutChanged() {
  const dockUsed = [...DOCK.children].some(c => !c.hidden);
  document.body.classList.toggle('dock-off', !dockUsed || DOCK.classList.contains('collapsed'));
  document.body.classList.toggle('layers-off', $('#layersPanel').classList.contains('collapsed'));
  $$('.narrow-r').forEach(b => b.classList.toggle('on', !document.body.classList.contains('dock-off')));
  $$('.narrow-l').forEach(b => b.classList.toggle('on', !document.body.classList.contains('layers-off')));
  syncMenuChecks(); draw();
}
for (const w of $$('.fwin')) {
  const saved = readWins()[w.id];
  if (w.dataset.dock && saved?.docked !== false) dockWin(w, true, true);
  else placeFloat(w, saved?.float);
  if (saved) { w.hidden = saved.hidden; w.classList.toggle('min', !!saved.min); }
  w.addEventListener('pointerdown', () => { if (!isDocked(w)) front(w); });
  const head = w.querySelector('.fhead');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY, pid = e.pointerId;
    let started = !isDocked(w), sx = e.clientX - w.offsetLeft, sy = e.clientY - w.offsetTop, near = false;
    const mv = ev => {
      if (ev.pointerId !== pid) return;
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
        const r = w.getBoundingClientRect(); // 붙어 있던 창을 끌면 떼어냄
        dockWin(w, false, true);
        w.style.width = r.width + 'px'; w.style.height = '';
        sx = x0 - r.left; sy = y0 - r.top; started = true;
      }
      w.style.left = ev.clientX - sx + 'px'; w.style.top = ev.clientY - sy + 'px'; keepInView(w);
      if (w.dataset.dock) { near = ev.clientX > innerWidth - 56; $('#dockHint').hidden = !near; w.classList.toggle('will-dock', near); }
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      $('#dockHint').hidden = true; w.classList.remove('will-dock');
      if (!started) return;
      if (near) { dockWin(w, true); status('합성 패널을 오른쪽에 붙였어요.'); } else saveWin(w);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  head.ondblclick = e => { if (e.target.closest('button')) return; w.classList.toggle('min'); saveWin(w); };
  w.querySelector('.fmin').onclick = () => { w.classList.toggle('min'); saveWin(w); };
  w.querySelector('.fclose').onclick = () => hideWin(w);
  const pop = w.querySelector('.fpop'); if (pop) pop.onclick = () => cmd('dockComp');
  w.addEventListener('pointerup', () => { if (!isDocked(w)) saveWin(w); });
}

// 패널 너비 조절 (경계선 끌기, 두 번 클릭 = 기본 너비)
const LAYOUT = (() => { try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch { return {}; } })();
function applyLayout() {
  const b = $('#body');
  if (LAYOUT.lw) b.style.setProperty('--layers-w', LAYOUT.lw + 'px'); else b.style.removeProperty('--layers-w');
  if (LAYOUT.dw) b.style.setProperty('--dock-w', LAYOUT.dw + 'px'); else b.style.removeProperty('--dock-w');
}
function saveLayout() { try { localStorage.setItem(LKEY, JSON.stringify(LAYOUT)); } catch {} }
for (const [el, key, panel, dir] of [[$('#splitL'), 'lw', $('#layersPanel'), 1], [$('#splitR'), 'dw', DOCK, -1]]) {
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId); el.classList.add('active');
    const w0 = panel.offsetWidth, x0 = e.clientX;
    const mv = ev => { LAYOUT[key] = Math.round(clamp(w0 + dir * (ev.clientX - x0), 220, 560)); applyLayout(); draw(); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.classList.remove('active'); saveLayout(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
  el.ondblclick = () => { delete LAYOUT[key]; applyLayout(); saveLayout(); draw(); };
}
applyLayout();

// ======================= 합성 패널 컨트롤 =======================
const syncFns = [];
// 슬라이더 한 줄: 이름 | 막대 | 값. 값(파란 숫자)은 프리미어/AE처럼 좌우로 끌어서 바꾸거나 눌러서 직접 입력.
function slider(parent, getObj, key, label, min, max, step = 1, digits = 0, def, after = edited) {
  const d = document.createElement('div'); d.className = 'ctl';
  d.innerHTML = `<span class="lab" title="${label}">${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><input class="num" type="text" inputmode="decimal" title="좌우로 끌어서 조절 (Shift: 크게, Ctrl: 미세하게) · 눌러서 직접 입력">`;
  const r = d.querySelector('input[type=range]'), n = d.querySelector('.num');
  const dv = def ?? (min < 0 ? 0 : min);
  if (dv > min && dv < max && min >= 0) r.dataset.zero = dv; // 감마처럼 기본값이 가운데인 값은 그 점부터 채움
  const set = v => { v = clamp(+v, min, max); if (isNaN(v)) return; getObj()[key] = v; after(); };
  r.addEventListener('input', () => set(r.value));
  r.addEventListener('pointerdown', () => { S.interacting = true; });
  r.addEventListener('change', () => { S.interacting = false; draw(); });
  n.addEventListener('change', () => set(n.value));
  n.addEventListener('keydown', e => {
    if (e.key === 'Enter') n.blur();
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(+getObj()[key] + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)); n.select(); }
  });
  n.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || document.activeElement === n || e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, v0 = +getObj()[key], per = Math.max(step, (max - min) / 300); let moved = false;
    n.setPointerCapture(e.pointerId);
    const mv = ev => {
      const dx = ev.clientX - x0; if (!moved && Math.abs(dx) < 3) return;
      if (!moved) { moved = true; S.interacting = true; document.body.classList.add('scrubbing'); }
      set(Math.round((v0 + dx * per * (ev.shiftKey ? 10 : ev.ctrlKey ? 0.1 : 1)) / step) * step);
    };
    const up = () => {
      n.removeEventListener('pointermove', mv); n.removeEventListener('pointerup', up); n.removeEventListener('pointercancel', up);
      document.body.classList.remove('scrubbing');
      if (moved) { S.interacting = false; draw(); } else { n.focus(); n.select(); }
    };
    n.addEventListener('pointermove', mv); n.addEventListener('pointerup', up); n.addEventListener('pointercancel', up);
  });
  r.addEventListener('dblclick', () => set(dv));
  d.querySelector('.lab').addEventListener('dblclick', () => set(dv));
  r.title = '더블클릭하면 기본값';
  parent.appendChild(d);
  const sync = () => { const v = getObj()[key]; r.value = v; paintRange(r); if (document.activeElement !== n) n.value = (+v).toFixed(digits); };
  syncFns.push(sync); d.sync = sync;
  return d;
}
// 막대의 채워진 부분 (0점 또는 기본값에서 현재 값까지)
function paintRange(r) {
  const min = +r.min, max = +r.max, span = (max - min) || 1, v = +r.value;
  const z = r.dataset.zero !== undefined ? +r.dataset.zero : clamp(0, min, max);
  r.style.setProperty('--a', (Math.min(z, v) - min) / span * 100 + '%');
  r.style.setProperty('--b', (Math.max(z, v) - min) / span * 100 + '%');
}
document.addEventListener('input', e => { if (e.target.matches('input[type=range]')) paintRange(e.target); });
function edited() { S.feel = null; syncUI(); draw(); }

// 레이어 불투명도 (레이어 패널 윗줄)
{
  const box = $('#opacityBox');
  const ctl = slider(box, () => ({ get v() { const L = selLayer(); return L ? Math.round(L.opacity * 100) : 100; }, set v(x) { const L = selLayer(); if (L) L.opacity = x / 100; } }),
    'v', '불투명도', 0, 100, 1, 0, 100, () => { ctl.sync(); draw(); clearTimeout(ctl.t); ctl.t = setTimeout(renderLayers, 150); });
  syncFns.splice(syncFns.indexOf(ctl.sync), 1); // 보정 값과 따로 동기화
  ctl.querySelector('.num').insertAdjacentHTML('afterend', '<span class="unit">%</span>');
  opacitySync = ctl.sync;
}

// 빠른 느낌
for (const f of FEELS) {
  const b = document.createElement('button'); b.className = 'feel'; b.dataset.id = f.id;
  b.innerHTML = `<i style="background:${f.swatch}"></i>${f.name}`;
  b.onclick = () => {
    if (f.id === 'auto') { if (!runAuto(false)) return; }
    else S.p = feelSettings(f.id);
    S.feel = f.id; if (S.compare) toggleCompare(); syncUI(); renderColorRows(); draw();
  };
  $('#feels').appendChild(b);
}
// 자동 맞춤: 맨 위 인물 레이어 주변의 배경 레이어들을 읽어서 값 결정
function runAuto(quiet) {
  const chr = [...S.layers].reverse().find(l => l.role === 'character' && l.img && l.visible);
  const bgs = S.layers.filter(l => l.role === 'background' && l.img && l.visible);
  if (!chr || !bgs.length) { if (!quiet) status('자동 맞춤은 인물 레이어와 배경 레이어가 하나씩 이상 있어야 해요.'); return false; }
  const pad = 0.35, N = 64, rx = chr.x - chr.w * pad, ry = chr.y - chr.h * pad, rw = chr.w * (1 + 2 * pad), rh = chr.h * (1 + 2 * pad);
  const region = makeCanvas(N, N), rc = region.getContext('2d', { willReadFrequently: true });
  rc.setTransform(N / rw, 0, 0, N / rh, -rx * N / rw, -ry * N / rh);
  for (const b of bgs) drawOriginal(rc, b, 1);
  const small = makeCanvas(N, Math.max(1, Math.round(N * chr.h / chr.w)));
  drawSource(small.getContext('2d', { willReadFrequently: true }), chr.img, small.width, small.height, chr.flip);
  const s = autoMatch(region, small);
  if (!s) return false;
  S.p = s; S.feel = 'auto'; syncUI(); renderColorRows();
  return true;
}

// 기본 보정 (대상 탭)
for (const [t, name] of TARGETS) {
  const b = document.createElement('button'); b.textContent = name; b.dataset.t = t;
  b.onclick = () => { S.basicTab = t; syncUI(); };
  $('#basicTabs').appendChild(b);
}
const B = () => S.p.basic[S.basicTab];
slider($('#basic'), B, 'brightness', '밝기', -100, 100);
slider($('#basic'), B, 'contrast', '대비', -100, 100);
slider($('#basic'), B, 'saturation', '채도', -100, 100);
slider($('#basic'), B, 'hue', '색조', -180, 180);
slider($('#basic'), B, 'exposure', '노출', -2, 2, 0.05, 2);
slider($('#basic'), B, 'gamma', '감마', 0.3, 3, 0.01, 2, 1);
slider($('#basic'), B, 'blur', '흐림', 0, 30, 0.5, 1);

// 조명
const LT = () => S.p.light;
slider($('#lightA'), LT, 'intensity', '빛 세기', 0, 100);
slider($('#lightA'), LT, 'backlight', '역광 그림자', 0, 100);
slider($('#lightB'), LT, 'depth', '테두리 두께', 1, 30, 1, 0, 5);
$('#rimOn').onchange = e => { S.p.light.rimOn = e.target.checked; edited(); };
$('#lightColor').oninput = e => { S.p.light.color = e.target.value; edited(); };
for (const [v, t] of [[225, '↖'], [270, '↑'], [315, '↗'], [180, '←'], ['front', '☀'], [0, '→'], [135, '↙'], [90, '↓'], [45, '↘']]) {
  const b = document.createElement('button'); b.textContent = t; b.dataset.v = v; b.title = v === 'front' ? '정면에서 비춤' : '';
  b.onclick = () => { S.p.light.dir = v === 'front' ? 'front' : +v; edited(); };
  $('#dirGrid').appendChild(b);
}

// 효과: 글로우 + 컬러 프리셋 줄
slider($('#glowBox'), () => S.p, 'glow', '글로우 (인물)', 0, 100);
function renderColorRows() {
  const box = $('#colorRows'); box.innerHTML = '';
  S.p.colors.forEach((row, i) => {
    const d = document.createElement('div'); d.className = 'crow';
    const sel = document.createElement('select');
    for (const c of COLOR_PRESETS) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); }
    sel.value = row.id; sel.onchange = () => { row.id = sel.value; edited(); };
    const tg = document.createElement('select'); tg.title = '적용 대상';
    for (const [t, n] of TARGETS) { const o = document.createElement('option'); o.value = t; o.textContent = n; tg.appendChild(o); }
    tg.value = row.target; tg.onchange = () => { row.target = tg.value; edited(); };
    const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = row.amount; r.title = `양 ${row.amount}`;
    r.oninput = () => { row.amount = +r.value; r.title = `양 ${row.amount}`; edited(); };
    const x = document.createElement('button'); x.className = 'x iconbtn'; x.innerHTML = icon('close'); x.title = '빼기';
    x.onclick = () => { S.p.colors.splice(i, 1); renderColorRows(); edited(); };
    d.append(sel, tg, r, x); box.appendChild(d);
  });
}
$('#addColor').onclick = () => { S.p.colors.push({ id: 'sunset', amount: 50, target: 'character' }); renderColorRows(); edited(); };
$('#openFx').onclick = () => showWin('winFx');
slider($('#strengthBox'), () => ({ get v() { return Math.round(S.strength * 100); }, set v(x) { S.strength = x / 100; } }), 'v', '필터 강도', 0, 100, 1, 0, 100);
$('#resetAll').onclick = () => { S.p = defaultSettings(); S.strength = 1; S.feel = null; renderColorRows(); syncUI(); draw(); status('보정 설정을 처음 상태로 돌렸어요. 레이어와 이미지는 그대로예요.'); };

// ======================= 효과 옵션 창 =======================
const fxCards = [];
['전체', '켜진 효과', ...FX_CATS].forEach((name, i) => {
  const b = document.createElement('button'); b.textContent = name; b.dataset.i = i - 2;
  b.onclick = () => { S.fxTab = i - 2; syncUI(); };
  $('#fxTabs').appendChild(b);
});
S.fxTab = -2;
for (const d of EFFECTS) {
  const card = document.createElement('div'); card.className = 'card';
  const F = () => S.p.effects[d.type];
  card.innerHTML = `<div class="head"><label class="check"><input type="checkbox" class="switch"> <b>${d.name}</b></label><select title="적용 대상"></select></div><div class="desc">${d.desc}</div>`;
  const cb = card.querySelector('input'), tg = card.querySelector('select');
  for (const [t, n] of TARGETS) { const o = document.createElement('option'); o.value = t; o.textContent = n; tg.appendChild(o); }
  cb.onchange = () => { F().on = cb.checked; edited(); };
  tg.onchange = () => { F().target = tg.value; edited(); };
  for (const [k, label, min, max, def] of d.params) slider(card, F, k, label, min, max, 1, 0, def);
  $('#fxCards').appendChild(card);
  fxCards.push({ d, card });
  syncFns.push(() => { cb.checked = F().on; tg.value = F().target; card.classList.toggle('on', F().on); });
}

function syncUI() {
  syncFns.forEach(f => f());
  $$('#colorRows input[type=range]').forEach(paintRange);
  $$('#basicTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === S.basicTab));
  $('#rimOn').checked = S.p.light.rimOn; $('#lightColor').value = S.p.light.color;
  $$('#dirGrid button').forEach(b => b.classList.toggle('on', String(S.p.light.dir) === b.dataset.v));
  $('#dirVal').textContent = S.p.light.dir === 'front' ? '정면' : S.p.light.dir + '°';
  $$('.feel').forEach(b => b.classList.toggle('on', b.dataset.id === S.feel));
  const n = Object.values(S.p.effects).filter(f => f.on).length;
  $('#fxCount').textContent = n ? `(${n}개 켜짐)` : '';
  $$('#fxTabs button').forEach(b => b.classList.toggle('on', +b.dataset.i === S.fxTab));
  for (const { d, card } of fxCards) card.hidden = !(S.fxTab === -2 || (S.fxTab === -1 ? S.p.effects[d.type].on : d.cat === S.fxTab));
}

// ======================= 내 프리셋 =======================
const PKEY = 'illustblend.presets2';
function readPresets() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } }
function writePresets(o) { try { localStorage.setItem(PKEY, JSON.stringify(o)); } catch { status('프리셋을 저장하지 못했어요.'); } }
function refreshPresetList(sel) {
  const list = $('#presetList'), names = Object.keys(readPresets());
  list.innerHTML = names.length ? '' : '<option value="">(저장된 프리셋 없음)</option>';
  for (const n of names) { const o = document.createElement('option'); o.value = o.textContent = n; list.appendChild(o); }
  if (sel) list.value = sel;
}
function mergeSettings(v) { // 예전/부분 설정도 안전하게 합침
  const s = defaultSettings();
  for (const t of Object.keys(s.basic)) Object.assign(s.basic[t], v.basic?.[t]);
  Object.assign(s.light, v.light); s.glow = v.glow ?? 0; s.colors = v.colors || []; s.autoColor = v.autoColor || s.autoColor;
  for (const k of Object.keys(s.effects)) Object.assign(s.effects[k], v.effects?.[k]);
  return s;
}
$('#savePreset').onclick = () => {
  const name = $('#presetName').value.trim(); if (!name) return status('프리셋 이름을 적어 주세요.');
  const all = readPresets(); all[name] = { p: S.p, strength: S.strength }; writePresets(all);
  $('#presetName').value = ''; refreshPresetList(name); status(`'${name}' 프리셋을 저장했어요.`);
};
$('#loadPreset').onclick = () => {
  const name = $('#presetList').value, v = readPresets()[name]; if (!v) return;
  S.p = mergeSettings(v.p); S.strength = v.strength ?? 1; S.feel = null;
  renderColorRows(); syncUI(); draw(); status(`'${name}' 프리셋을 불러왔어요.`);
};
$('#delPreset').onclick = () => { const name = $('#presetList').value; if (!name) return; const all = readPresets(); delete all[name]; writePresets(all); refreshPresetList(); status(`'${name}' 프리셋을 지웠어요.`); };

// ======================= 캔버스 크기 =======================
const SIZE_PRESETS = [['FHD 가로', 1920, 1080], ['FHD 세로', 1080, 1920], ['QHD', 2560, 1440], ['4K', 3840, 2160], ['정사각', 2048, 2048], ['A4 300dpi', 2480, 3508]];
for (const [n, w, h] of SIZE_PRESETS) { const b = document.createElement('button'); b.textContent = `${n} ${w}×${h}`; b.onclick = () => { $('#cw').value = w; $('#ch').value = h; }; $('#sizePresets').appendChild(b); }
{ const b = document.createElement('button'); b.textContent = '선택한 레이어 이미지 크기'; b.onclick = () => { const L = selLayer(); if (L?.img) { $('#cw').value = L.img.naturalWidth; $('#ch').value = L.img.naturalHeight; } else status('이미지가 들어 있는 레이어를 먼저 선택하세요.'); }; $('#sizePresets').appendChild(b); }
function openSizeDialog() { $('#cw').value = S.doc.w; $('#ch').value = S.doc.h; $('#sizeModal').hidden = false; $('#cw').focus(); }
$('#sizeCancel').onclick = () => { $('#sizeModal').hidden = true; };
$('#sizeOk').onclick = () => {
  const w = clamp(Math.round(+$('#cw').value), 16, 8000), h = clamp(Math.round(+$('#ch').value), 16, 8000);
  if (!w || !h) return;
  if ($('#keepCenter').checked) for (const L of S.layers) { L.x += (w - S.doc.w) / 2; L.y += (h - S.doc.h) / 2; }
  S.doc = { w, h }; $('#sizeModal').hidden = true; filterCache.clear(); fitView(); changed();
  status(`캔버스를 ${w}×${h}로 바꿨어요. 레이어 크기는 그대로예요.`);
};

// ======================= 내보내기 =======================
function status(t) { $('#status').textContent = t || ' '; }
let downloadsNS = null;
if (window.claude && window.claude.use) window.claude.use('downloads').then(d => { downloadsNS = d; }).catch(() => {});
async function exportPng() {
  if (!S.layers.some(l => l.img)) return status('먼저 레이어에 이미지를 넣어 주세요.');
  status('내보내는 중…');
  await new Promise(r => setTimeout(r, 30));
  const c = composeScene(1, true);
  const base = ([...S.layers].reverse().find(l => l.role === 'character' && l.img)?.name || 'result').replace(/\.[^.]+$/, '');
  const name = base + '_blend.png';
  try {
    if (window.native) {
      const r = await window.native.savePng(c.toDataURL('image/png'), name);
      status(r.ok ? '저장했어요: ' + r.filePath : '');
      return;
    }
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('이미지를 만들지 못했어요. 캔버스 크기를 줄여 보세요.');
    if (!downloadsNS && window.claude && window.claude.use) downloadsNS = await window.claude.use('downloads');
    if (downloadsNS) {
      try { await downloadsNS.save({ filename: name, data: blob }); status('저장했어요: ' + name); }
      catch (err) { status(err && err.code === 'declined' ? '저장을 취소했어요.' : '저장하지 못했어요: ' + (err && err.message || err)); }
    } else {
      // 아이패드/휴대폰: 공유 시트로 '이미지 저장' (사진 앱) 가능
      const file = new File([blob], name, { type: 'image/png' });
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); status('공유 시트에서 저장했어요.'); return; }
        catch (err) { if (err && err.name === 'AbortError') { status('저장을 취소했어요.'); return; } }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); status('저장했어요: ' + name);
    }
  } catch (err) { status(err.message || String(err)); }
  finally { releaseTemps(); filterCache.forEach(v => freeCanvas(v.canvas)); filterCache.clear(); draw(); }
}

// ======================= 시작 =======================
function changed() { renderLayers(); draw(); }
refreshPresetList(); renderColorRows(); syncUI(); renderLayers();
if (window.innerWidth < 760) $('#layersPanel').classList.add('collapsed');
if (window.innerWidth < 1100) DOCK.classList.add('collapsed'); // 좁은 화면(아이패드 세로 등)에선 합성 패널을 위에 덮는 서랍으로
layoutChanged();
requestAnimationFrame(fitView);
