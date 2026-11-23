// 렌더링 엔진.
// 원칙: 레이어 원본 이미지는 읽기만 한다. 모든 보정과 효과는 사본 캔버스(필터 층)에 그려서 원본 위에 겹친다.

// ---------------- 유틸 ----------------
// 임시 캔버스는 기록해 두었다가 한 번에 비운다 (아이패드 Safari의 캔버스 메모리 한도 대비)
const TEMP_CANVASES = [];
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  TEMP_CANVASES.push(c);
  return c;
}
function keepCanvas(c) { c._keep = true; return c; }
function freeCanvas(c) { if (c) { c._keep = false; c.width = 0; c.height = 0; } }
function releaseTemps() { for (const c of TEMP_CANVASES) if (!c._keep) { c.width = 0; c.height = 0; } TEMP_CANVASES.length = 0; }
function copyCanvas(src) { const c = makeCanvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }
function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function hexA(hex, a) { const [r, g, b] = rgbOf(hex); return `rgba(${r},${g},${b},${a})`; }
function toHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function blendOnto(x, layer, mode, alpha) {
  if (alpha <= 0) return;
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none';
  x.globalCompositeOperation = mode; x.globalAlpha = clamp(alpha, 0, 1);
  x.drawImage(layer, 0, 0); x.restore();
}
function drawSource(x, img, w, h, flip) {
  if (flip) { x.save(); x.translate(w, 0); x.scale(-1, 1); x.drawImage(img, 0, 0, w, h); x.restore(); }
  else x.drawImage(img, 0, 0, w, h);
}
function maskWith(c, maskSrc) {
  const x = c.getContext('2d');
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none'; x.globalAlpha = 1;
  x.globalCompositeOperation = 'destination-in'; x.drawImage(maskSrc, 0, 0, c.width, c.height); x.restore();
  return c;
}
function fillSolid(w, h, color) { const c = makeCanvas(w, h), x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c; }
// 빛이 비추는 방향(화살표 각도) → 빛이 오는 쪽 단위벡터. 'front' = 정면
function lightFrom(dir) { if (dir === 'front') return null; const a = (dir + 180) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; }


// ---------------- CSS 필터 (Safari 등 ctx.filter가 없는 브라우저용 대체 구현 포함) ----------------
const NATIVE_FILTER = (() => { try { const x = document.createElement('canvas').getContext('2d'); x.filter = 'blur(2px)'; return x.filter === 'blur(2px)'; } catch { return false; } })();
// src를 CSS 필터 문자열 F로 처리한 새 캔버스(같은 크기)를 돌려준다
function filtered(src, F) {
  const w = src.width, h = src.height, out = makeCanvas(w, h), x = out.getContext('2d', { willReadFrequently: !NATIVE_FILTER });
  if (!F || F === 'none') { x.drawImage(src, 0, 0); return out; }
  if (NATIVE_FILTER) { x.filter = F; x.drawImage(src, 0, 0); x.filter = 'none'; return out; }
  x.drawImage(src, 0, 0);
  const ops = [...F.matchAll(/([a-z-]+)\(\s*([-\d.]+)\s*(px|%|deg)?\s*\)/g)].map(m => [m[1], +m[2]]);
  const color = ops.filter(o => o[0] !== 'blur'), blurOp = ops.find(o => o[0] === 'blur');
  if (color.length) {
    const id = x.getImageData(0, 0, w, h), d = id.data;
    // 3x4 색 행렬로 합성 (W3C filter effects 식)
    let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    const mul = (A, B) => { const R = []; for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) R[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c]; R[r * 4 + 3] = A[r * 4] * B[3] + A[r * 4 + 1] * B[7] + A[r * 4 + 2] * B[11] + A[r * 4 + 3]; } return R; };
    for (const [name, v0] of color) {
      let T;
      if (name === 'brightness') { const v = v0 / 100; T = [v, 0, 0, 0, 0, v, 0, 0, 0, 0, v, 0]; }
      else if (name === 'contrast') { const v = v0 / 100, o = (0.5 - 0.5 * v) * 255; T = [v, 0, 0, o, 0, v, 0, o, 0, 0, v, o]; }
      else if (name === 'saturate') { const s = v0 / 100; T = [.213 + .787 * s, .715 - .715 * s, .072 - .072 * s, 0, .213 - .213 * s, .715 + .285 * s, .072 - .072 * s, 0, .213 - .213 * s, .715 - .715 * s, .072 + .928 * s, 0]; }
      else if (name === 'hue-rotate') { const a = v0 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        T = [.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928, 0, .213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283, 0, .213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072, 0]; }
      else if (name === 'grayscale') { const g = 1 - Math.min(1, v0 / 100); T = [.2126 + .7874 * g, .7152 - .7152 * g, .0722 - .0722 * g, 0, .2126 - .2126 * g, .7152 + .2848 * g, .0722 - .0722 * g, 0, .2126 - .2126 * g, .7152 - .7152 * g, .0722 + .9278 * g, 0]; }
      else if (name === 'sepia') { const g = 1 - Math.min(1, v0 / 100); T = [.393 + .607 * g, .769 - .769 * g, .189 - .189 * g, 0, .349 - .349 * g, .686 + .314 * g, .168 - .168 * g, 0, .272 - .272 * g, .534 - .534 * g, .131 + .869 * g, 0]; }
      if (T) M = mul(T, M);
    }
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = M[0] * r + M[1] * g + M[2] * b + M[3]; d[i + 1] = M[4] * r + M[5] * g + M[6] * b + M[7]; d[i + 2] = M[8] * r + M[9] * g + M[10] * b + M[11];
    }
    x.putImageData(id, 0, 0);
  }
  if (blurOp && blurOp[1] > 0.3) boxBlur(out, blurOp[1]);
  return out;
}
// 가우시안 근사 (박스 흐림 3회, 알파 미리곱)
function boxBlur(c, sigma) {
  const x = c.getContext('2d', { willReadFrequently: true }), w = c.width, h = c.height;
  // 큰 반경은 축소해서 처리 (속도)
  const k = sigma > 6 ? Math.max(1, Math.floor(sigma / 3)) : 1;
  let work = c, ww = w, hh = h, s = sigma;
  if (k > 1) { ww = Math.max(1, Math.round(w / k)); hh = Math.max(1, Math.round(h / k)); work = makeCanvas(ww, hh); work.getContext('2d').drawImage(c, 0, 0, ww, hh); s = sigma / k; }
  const wx = work.getContext('2d', { willReadFrequently: true }), id = wx.getImageData(0, 0, ww, hh), d = id.data, n = ww * hh;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) { const a = d[i * 4 + 3] / 255; ch[3][i] = d[i * 4 + 3]; ch[0][i] = d[i * 4] * a; ch[1][i] = d[i * 4 + 1] * a; ch[2][i] = d[i * 4 + 2] * a; }
  const r = Math.max(1, Math.round(Math.sqrt(12 * s * s / 3 + 1) / 2)), tmp = new Float32Array(n);
  const pass = (a, b, horiz) => {
    const L = horiz ? ww : hh, M = horiz ? hh : ww, step = horiz ? 1 : ww, line = horiz ? ww : 1, inv = 1 / (2 * r + 1);
    for (let m = 0; m < M; m++) {
      const base = m * line; let acc = 0;
      for (let t = -r; t <= r; t++) acc += a[base + clamp(t, 0, L - 1) * step];
      for (let t = 0; t < L; t++) { b[base + t * step] = acc * inv; acc += a[base + Math.min(t + r + 1, L - 1) * step] - a[base + Math.max(t - r, 0) * step]; }
    }
  };
  for (const A of ch) for (let it = 0; it < 3; it++) { pass(A, tmp, true); pass(tmp, A, false); }
  for (let i = 0; i < n; i++) { const a = ch[3][i], ia = a > 0 ? 255 / a : 0; d[i * 4] = ch[0][i] * ia; d[i * 4 + 1] = ch[1][i] * ia; d[i * 4 + 2] = ch[2][i] * ia; d[i * 4 + 3] = a; }
  wx.putImageData(id, 0, 0);
  if (k > 1) { x.clearRect(0, 0, w, h); x.imageSmoothingQuality = 'high'; x.drawImage(work, 0, 0, w, h); }
}

// ---------------- 설정 기본값 ----------------
const TARGETS = [['character', '인물'], ['background', '배경'], ['all', '전체 화면']];
const BASIC_KEYS = { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, gamma: 1, blur: 0 };

function defaultSettings() {
  return {
    basic: { character: { ...BASIC_KEYS }, background: { ...BASIC_KEYS }, all: { ...BASIC_KEYS } },
    light: { intensity: 0, backlight: 0, rimOn: false, color: '#ffffff', dir: 90, depth: 5 },
    glow: 0,
    colors: [],                 // [{ id, amount, target }]
    autoColor: '#808080',
    effects: defaultEffects(),  // { type: { on, target, ...params } }
  };
}

// ---------------- 컬러 프리셋 ----------------
const COLOR_PRESETS = [
  { id: 'auto', name: '배경 색 따라가기' },
  { id: 'sunset', name: '노을', color: '#ff8a3d', mode: 'soft-light', k: 0.6, shade: '#5a2a6b' },
  { id: 'night', name: '밤', color: '#2b4c9b', mode: 'multiply', k: 0.5, shade: '#0b1030' },
  { id: 'dreamy', name: '몽환', color: '#c79bff', mode: 'soft-light', k: 0.55, shade: '#5b3d8a' },
  { id: 'daylight', name: '맑은 낮', color: '#fff2d6', mode: 'soft-light', k: 0.3 },
  { id: 'cloudy', name: '흐림', color: '#8a96a3', mode: 'color', k: 0.35 },
  { id: 'lamp', name: '실내 조명', color: '#ffb04a', mode: 'overlay', k: 0.35, shade: '#2a1a10' },
  { id: 'neon', name: '네온', color: '#6a2bd9', mode: 'soft-light', k: 0.6, shade: '#3a0a40' },
  { id: 'underwater', name: '물속', color: '#2fa8d8', mode: 'color', k: 0.45, shade: '#0a3050' },
  { id: 'pastel', name: '파스텔', color: '#ffc8dd', mode: 'soft-light', k: 0.45 },
  { id: 'cherry', name: '벚꽃', color: '#ffb7d0', mode: 'screen', k: 0.25, shade: '#7a3050' },
  { id: 'forest', name: '숲', color: '#5f8f4a', mode: 'soft-light', k: 0.5, shade: '#1a2a12' },
  { id: 'cyber', name: '사이버', color: '#00e0c0', mode: 'soft-light', k: 0.5, shade: '#300050' },
  { id: 'sepia', name: '세피아', color: '#a0703a', mode: 'color', k: 0.5 },
];

// ---------------- 처리 단계 ----------------
function applyBasic(c, b, unit) {
  const x = c.getContext('2d', { willReadFrequently: true }), w = c.width, h = c.height;
  const toned = b.brightness || b.contrast || b.saturation || b.hue;
  if (toned || b.blur > 0) {
    const t = copyCanvas(c);
    const tone = `brightness(${100 + b.brightness}%) contrast(${100 + b.contrast}%) saturate(${100 + b.saturation}%) hue-rotate(${b.hue}deg)`;
    x.save(); x.clearRect(0, 0, w, h);
    x.drawImage(filtered(t, tone + (b.blur > 0 ? ` blur(${b.blur * unit}px)` : '')), 0, 0);
    if (b.blur > 0) { x.globalCompositeOperation = 'destination-over'; x.drawImage(toned ? filtered(t, tone) : t, 0, 0); } // 흐림으로 투명해진 가장자리 메움
    x.restore();
  }
  if (b.exposure !== 0 || b.gamma !== 1) {
    const gain = Math.pow(2, b.exposure), inv = 1 / b.gamma, lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.pow(clamp(i / 255 * gain, 0, 1), inv) * 255;
    const id = x.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    x.putImageData(id, 0, 0);
  }
}

function applyColors(c, p, target, mask) {
  const x = c.getContext('2d'), w = c.width, h = c.height;
  for (const row of p.colors) {
    if (row.target !== target || row.amount <= 0) continue;
    const cp = row.id === 'auto' ? { color: p.autoColor, mode: 'soft-light', k: 0.6 } : COLOR_PRESETS.find(q => q.id === row.id);
    if (!cp || !cp.color) continue;
    const amt = row.amount / 100;
    let solid = fillSolid(w, h, cp.color); if (mask) maskWith(solid, mask);
    blendOnto(x, solid, cp.mode, amt * cp.k);
    if (cp.shade) {
      const s = makeCanvas(w, h), sx = s.getContext('2d'), g = sx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, hexA(cp.shade, 1)); g.addColorStop(0.7, hexA(cp.shade, 0));
      sx.fillStyle = g; sx.fillRect(0, 0, w, h); if (mask) maskWith(s, mask);
      blendOnto(x, s, 'multiply', amt * 0.35);
    }
  }
}

function applyLight(c, L, mask, unit) {
  const x = c.getContext('2d'), w = c.width, h = c.height, diag = Math.hypot(w, h);
  const from = lightFrom(L.dir);
  const grad = (color, a0, stop, reverse) => {
    const s = makeCanvas(w, h), sx = s.getContext('2d');
    const [fx, fy] = from || [0, -1], r = diag / 2;
    const A = [w / 2 + fx * r, h / 2 + fy * r], B = [w / 2 - fx * r, h / 2 - fy * r];
    const g = reverse ? sx.createLinearGradient(B[0], B[1], A[0], A[1]) : sx.createLinearGradient(A[0], A[1], B[0], B[1]);
    g.addColorStop(0, hexA(color, a0)); g.addColorStop(stop, hexA(color, 0));
    sx.fillStyle = g; sx.fillRect(0, 0, w, h); return maskWith(s, mask);
  };
  if (L.backlight > 0) {
    const [r, g, b] = rgbOf(L.color);
    const s = fillSolid(w, h, toHex(20 + r * 0.08, 20 + g * 0.08, 30 + b * 0.1)), sx = s.getContext('2d');
    if (from) {
      sx.globalCompositeOperation = 'destination-out';
      const rr = diag / 2, gg = sx.createLinearGradient(w / 2 + from[0] * rr, h / 2 + from[1] * rr, w / 2, h / 2);
      gg.addColorStop(0, 'rgba(0,0,0,.6)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
      sx.fillStyle = gg; sx.fillRect(0, 0, w, h);
    }
    blendOnto(x, maskWith(s, mask), 'multiply', L.backlight / 100 * 0.9);
  }
  if (L.intensity > 0) {
    const s = from ? grad(L.color, 1, 0.55) : maskWith(fillSolid(w, h, L.color), mask);
    blendOnto(x, s, from ? 'screen' : 'soft-light', L.intensity / 100 * (from ? 0.55 : 0.6));
  }
  if (L.rimOn && L.intensity > 0) {
    const off = Math.max(1, L.depth * unit * 1.4), blur = Math.max(0.8, off * 0.35);
    const s = fillSolid(w, h, L.color), sx = s.getContext('2d');
    sx.globalCompositeOperation = 'destination-out';
    if (from) sx.translate(-from[0] * off, -from[1] * off);
    sx.drawImage(filtered(mask, `blur(${from ? blur : off}px)`), 0, 0, w, h);
    sx.setTransform(1, 0, 0, 1, 0, 0);
    maskWith(s, mask);
    const k = L.intensity / 100;
    blendOnto(x, s, 'screen', k); blendOnto(x, s, 'lighter', k * 0.5);
  }
}

function applyGlow(c, amount, unit, mask) {
  if (amount <= 0) return;
  const s = filtered(c, `blur(${Math.max(2, 18 * unit)}px)`);
  if (mask) maskWith(s, mask);
  blendOnto(c.getContext('2d'), s, 'screen', amount / 100 * 0.7);
}

// ---------------- 레이어 필터 층 ----------------
// layer: { img, w, h, flip, role }, rs: 렌더 배율, docDiag: 문서 대각선(px, 배율 적용 전)
function buildLayerFilter(layer, rs, p, docDiag) {
  const target = layer.role;
  const w = Math.max(1, Math.round(layer.w * rs)), h = Math.max(1, Math.round(layer.h * rs));
  const unit = docDiag * rs / 1000;
  const mask = makeCanvas(w, h); drawSource(mask.getContext('2d'), layer.img, w, h, layer.flip);
  const c = copyCanvas(mask);
  const env = { unit, light: p.light, target, mask, seed: layer.seed || 1 };
  applyBasic(c, p.basic[target], unit);
  applyColors(c, p, target, mask);
  if (target === 'character') { applyLight(c, p.light, mask, unit); applyGlow(c, p.glow, unit, mask); }
  applyEffects(c, p, target, env);
  return maskWith(c, mask);
}

// 화면 전체 보정 (사본 위에 처리해서 원래 장면 위에 덮음)
function buildScenePass(base, p, rs, docDiag) {
  const b = p.basic.all;
  const anyBasic = Object.keys(BASIC_KEYS).some(k => b[k] !== BASIC_KEYS[k]);
  const anyColor = p.colors.some(r => r.target === 'all' && r.amount > 0);
  const anyFx = Object.values(p.effects).some(e => e.on && e.target === 'all');
  if (!anyBasic && !anyColor && !anyFx) return null;
  const c = copyCanvas(base), unit = docDiag * rs / 1000;
  applyBasic(c, b, unit);
  applyColors(c, p, 'all', null);
  applyEffects(c, p, 'all', { unit, light: p.light, target: 'all', mask: null, seed: 1 });
  return c;
}

// ---------------- 자동 맞춤 ----------------
function lum(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function satOf(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }
function stats(data, alphaWeighted) {
  let R = 0, G = 0, B = 0, W = 0, S = 0; const px = [];
  for (let i = 0; i < data.length; i += 4) {
    const wgt = alphaWeighted ? data[i + 3] / 255 : data[i + 3] / 255;
    if (wgt < 0.05) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    R += r * wgt; G += g * wgt; B += b * wgt; W += wgt; S += satOf(r, g, b) * wgt;
    px.push([lum(r, g, b), r, g, b]);
  }
  if (!W) return null;
  return { r: R / W, g: G / W, b: B / W, l: lum(R / W, G / W, B / W), s: S / W, px };
}
function avgOf(list) { let r = 0, g = 0, b = 0; for (const q of list) { r += q[1]; g += q[2]; b += q[3]; } const n = list.length || 1; return [r / n, g / n, b / n]; }

// bgRegion: 인물 주변의 배경(축소본), chr: 인물 축소본. 추측 기반 단순 규칙.
function autoMatch(bgRegion, chr) {
  const W = bgRegion.width, H = bgRegion.height;
  const bd = bgRegion.getContext('2d').getImageData(0, 0, W, H).data;
  const bg = stats(bd), il = stats(chr.getContext('2d').getImageData(0, 0, chr.width, chr.height).data);
  if (!bg || !il) return null;
  const area = (x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (bd[i + 3] < 10) continue; s += lum(bd[i], bd[i + 1], bd[i + 2]); n++; } return n ? s / n : 0; };
  const L = area(0, 0, W >> 1, H), R = area(W >> 1, 0, W, H), T = area(0, 0, W, H >> 1), B = area(0, H >> 1, W, H);
  const dx = R - L, dy = B - T, strength = Math.hypot(dx, dy);
  let dir = 'front';
  if (strength > 0.03) dir = (Math.round(((Math.atan2(-dy, -dx) * 180 / Math.PI + 360) % 360) / 45) * 45) % 360;
  bg.px.sort((a, b) => a[0] - b[0]);
  const n = bg.px.length, k = Math.max(1, Math.floor(n * 0.1));
  const bright = avgOf(bg.px.slice(n - k));
  const lc = (() => { const m = Math.max(...bright) || 1; return bright.map(v => 255 * Math.pow(v / m, 1.3)); })();
  const s = defaultSettings();
  Object.assign(s.basic.character, {
    brightness: Math.round(clamp((bg.l - il.l) * 60, -35, 25)),
    contrast: Math.round(clamp((lum(...bright) - bg.l) * 30 - 5, -15, 15)),
    saturation: Math.round(clamp((bg.s - il.s) * 60, -45, 25)),
  });
  // 배경 쪽도 살짝 흐리고 대비를 낮춰 인물이 떠 보이지 않게
  Object.assign(s.basic.background, { blur: 2, contrast: -6, saturation: Math.round(clamp((il.s - bg.s) * 30, -15, 10)) });
  Object.assign(s.light, {
    intensity: Math.round(clamp(30 + strength * 250, 30, 85)),
    backlight: Math.round(clamp((1 - bg.l) * 45 + (dir === 'front' ? 0 : 10), 5, 60)),
    rimOn: true, color: toHex(...lc), dir, depth: 5,
  });
  s.glow = bg.l > 0.6 ? 15 : 5;
  s.autoColor = toHex(bg.r, bg.g, bg.b);
  s.colors = [{ id: 'auto', amount: 70, target: 'character' }];
  s.effects.bloom.on = true; s.effects.bloom.amount = 20; s.effects.bloom.target = 'all';
  return s;
}

// ---------------- 빠른 느낌 ----------------
// (light.dir = 빛이 비추는 방향. 90 = 아래로, 즉 위에서 비춤)
const FEELS = [
  { id: 'auto', name: '배경에 자동 맞춤', swatch: 'linear-gradient(135deg,#6b76ff,#ffb36b)' },
  { id: 'sunset', name: '따뜻한 노을', swatch: '#ff8a3d', f: {
    chr: { brightness: 2, contrast: 5, saturation: 10, hue: -4 }, bg: { blur: 2 },
    light: { intensity: 45, backlight: 25, rimOn: true, color: '#ffb36b', dir: 180, depth: 6 }, glow: 10,
    colors: [['sunset', 75, 'character'], ['sunset', 30, 'background']], fx: { lightLeak: { amount: 35, hue: 25 } } } },
  { id: 'night', name: '차가운 밤', swatch: '#2b4c9b', f: {
    chr: { brightness: -18, contrast: 8, saturation: -28 }, bg: { blur: 2, brightness: -8 },
    light: { intensity: 25, backlight: 40, rimOn: true, color: '#8fb4ff', dir: 90, depth: 5 },
    colors: [['night', 70, 'character']], fx: { vignette: { amount: 45 } } } },
  { id: 'dreamy', name: '몽환적', swatch: '#c79bff', f: {
    chr: { brightness: 6, contrast: -12, saturation: -10, hue: 6 }, bg: { blur: 4, contrast: -10 },
    light: { intensity: 35, backlight: 10, rimOn: true, color: '#ffd6f5', dir: 135, depth: 8 }, glow: 40,
    colors: [['dreamy', 70, 'character'], ['dreamy', 40, 'background']], fx: { bloom: { amount: 40 }, mist: { amount: 25 } } } },
  { id: 'daylight', name: '맑은 낮', swatch: '#ffe9a8', f: {
    chr: { brightness: 4, contrast: 4, saturation: 6 }, bg: { blur: 1.5 },
    light: { intensity: 30, backlight: 5, rimOn: true, color: '#fff6dd', dir: 45, depth: 4 },
    colors: [['daylight', 70, 'character']] } },
  { id: 'backlit', name: '강한 역광', swatch: 'linear-gradient(135deg,#111,#fff)', f: {
    chr: { brightness: -5, contrast: 5 }, bg: { blur: 3 },
    light: { intensity: 100, backlight: 75, rimOn: true, color: '#ffffff', dir: 90, depth: 5 }, glow: 15,
    colors: [['auto', 50, 'character']], fx: { bloom: { amount: 35 } } } },
  { id: 'underwater', name: '물속', swatch: '#2fa8d8', f: {
    chr: { contrast: -5, saturation: -10 }, bg: { blur: 3 },
    light: { intensity: 40, backlight: 30, rimOn: true, color: '#bff3ff', dir: 90, depth: 6 }, glow: 20,
    colors: [['underwater', 80, 'character'], ['pastel', 30, 'all']], fx: { underwater: { amount: 50 }, godray: { amount: 40 } } } },
  { id: 'neon', name: '네온 도시', swatch: 'linear-gradient(135deg,#ff3fb4,#30d5ff)', f: {
    chr: { brightness: -10, contrast: 15, saturation: 20 }, bg: { blur: 3 },
    light: { intensity: 50, backlight: 35, rimOn: true, color: '#30d5ff', dir: 0, depth: 7 }, glow: 20,
    colors: [['neon', 75, 'character']], fx: { chromatic: { amount: 25 }, bloom: { amount: 30 } } } },
  { id: 'film', name: '필름 감성', swatch: '#a0703a', f: {
    chr: { contrast: -5, saturation: -10 }, bg: { blur: 1 },
    light: { intensity: 25, backlight: 10, rimOn: true, color: '#ffe0b0', dir: 135, depth: 4 },
    colors: [['sepia', 30, 'all']], fx: { grain: { amount: 40 }, vignette: { amount: 40 }, lightLeak: { amount: 30, hue: 20 } } } },
  { id: 'glitch', name: '글리치', swatch: 'linear-gradient(135deg,#f0f,#0ff)', f: {
    chr: { contrast: 10 }, bg: { blur: 1 },
    light: { intensity: 40, backlight: 30, rimOn: true, color: '#30d5ff', dir: 180, depth: 5 },
    colors: [['cyber', 50, 'all']], fx: { glitch: { amount: 50 }, chromatic: { amount: 40 }, scanlines: { amount: 35 }, grain: { amount: 25 } } } },
];
function feelSettings(id) {
  const f = FEELS.find(q => q.id === id).f, s = defaultSettings();
  Object.assign(s.basic.character, f.chr || {}); Object.assign(s.basic.background, f.bg || {});
  Object.assign(s.light, f.light || {}); s.glow = f.glow || 0;
  s.colors = (f.colors || []).map(([id, amount, target]) => ({ id, amount, target }));
  for (const k in (f.fx || {})) Object.assign(s.effects[k], { on: true }, f.fx[k]);
  return s;
}
