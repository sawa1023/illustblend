// 효과 라이브러리. 각 효과는 사본 캔버스 c 위에서만 동작한다 (원본 이미지는 건드리지 않음).
// env: { unit(1/1000 대각선 px), light, target, mask(레이어 모양 또는 null), seed }

const FX_CATS = ['흐림 · 선명', '노이즈 · 글리치', '빛', '분위기', '스타일'];

const EFFECTS = [
  // ---- 흐림 · 선명
  { type: 'blur', name: '가우시안 흐림', cat: 0, target: 'background', desc: '전체를 부드럽게 흐립니다. 배경에 쓰면 심도 표현이 됩니다.',
    params: [['amount', '세기', 0, 100, 40]],
    apply(c, f, e) { const t = copyCanvas(c), x = c.getContext('2d'); x.drawImage(filtered(t, `blur(${f.amount / 100 * 20 * e.unit}px)`), 0, 0); fillEdges(c, t); } },
  { type: 'motionBlur', name: '방향 흐림', cat: 0, target: 'background', desc: '한 방향으로 움직이는 듯한 잔상 흐림입니다.',
    params: [['amount', '거리', 0, 100, 40], ['angle', '각도', 0, 180, 0]],
    apply(c, f, e) {
      const t = copyCanvas(c), x = c.getContext('2d'), N = 14, d = f.amount / 100 * 40 * e.unit, a = f.angle * Math.PI / 180;
      const acc = makeCanvas(c.width, c.height), ax = acc.getContext('2d');
      for (let i = 0; i < N; i++) { const k = (i / (N - 1) - 0.5) * d; ax.globalAlpha = 1 / (i + 1); ax.drawImage(t, Math.cos(a) * k, Math.sin(a) * k); }
      x.drawImage(acc, 0, 0); fillEdges(c, t);
    } },
  { type: 'sharpen', name: '선명하게', cat: 0, target: 'character', desc: '윤곽을 또렷하게 만듭니다 (언샤프 마스크).',
    params: [['amount', '세기', 0, 100, 40]],
    apply(c, f, e) {
      const x = c.getContext('2d', { willReadFrequently: true }), w = c.width, h = c.height;
      const bl = filtered(c, `blur(${Math.max(1, 1.5 * e.unit)}px)`), bx = bl.getContext('2d', { willReadFrequently: true });
      const A = x.getImageData(0, 0, w, h), B = bx.getImageData(0, 0, w, h).data, d = A.data, k = f.amount / 100 * 1.5;
      for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) d[i + j] = d[i + j] + (d[i + j] - B[i + j]) * k;
      x.putImageData(A, 0, 0);
    } },
  { type: 'edgeDistort', name: '가장자리 흐림', cat: 0, target: 'all', desc: '화면 가장자리만 흐리고 번지게 해서 시선을 가운데로 모읍니다.',
    params: [['amount', '세기', 0, 100, 50]],
    apply(c, f, e) {
      const w = c.width, h = c.height, s = makeCanvas(w, h), sx = s.getContext('2d'), z = 1 + f.amount / 100 * 0.05;
      sx.drawImage(c, -(w * z - w) / 2, -(h * z - h) / 2, w * z, h * z);
      const sb = filtered(s, `blur(${f.amount / 100 * 14 * e.unit}px)`); sx.clearRect(0, 0, w, h); sx.drawImage(sb, 0, 0);
      sx.globalCompositeOperation = 'destination-in';
      const g = sx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); sx.fillStyle = g; sx.fillRect(0, 0, w, h);
      c.getContext('2d').drawImage(s, 0, 0);
    } },
  // ---- 노이즈 · 글리치
  { type: 'grain', name: '노이즈 (필름 그레인)', cat: 1, target: 'all', desc: '고운 입자 노이즈로 아날로그 질감을 더합니다.',
    params: [['amount', '세기', 0, 100, 35], ['size', '입자 크기', 1, 6, 1]],
    apply(c, f, e) { const s = makeCanvas(c.width, c.height), sx = s.getContext('2d'), k = Math.max(1, f.size * e.unit * 0.8);
      sx.imageSmoothingEnabled = f.size <= 1; sx.scale(k, k); sx.fillStyle = sx.createPattern(noiseTile(), 'repeat'); sx.fillRect(0, 0, c.width / k + 1, c.height / k + 1);
      if (e.mask) maskWith(s, e.mask); blendOnto(c.getContext('2d'), s, 'overlay', f.amount / 100 * 0.5); } },
  { type: 'glitch', name: '글리치', cat: 1, target: 'all', desc: '화면이 순간적으로 찢기듯 밀리고 색이 갈라지는 디지털 오류 느낌입니다.',
    params: [['amount', '세기', 0, 100, 40], ['seed', '패턴', 1, 50, 7]],
    apply(c, f, e) {
      const t = copyCanvas(c), x = c.getContext('2d'), w = c.width, h = c.height, R = rng(f.seed * 97), n = 4 + Math.round(f.amount / 100 * 18);
      for (let i = 0; i < n; i++) {
        const y = R() * h, sh = (2 + R() * 30) * e.unit, dx = (R() - 0.5) * f.amount / 100 * 120 * e.unit;
        x.clearRect(0, y, w, sh); x.drawImage(t, 0, y, w, sh, dx, y, w, sh);
      }
      channelShift(c, f.amount / 100 * 10 * e.unit, 0);
    } },
  { type: 'chromatic', name: '색수차', cat: 1, target: 'all', desc: '빨강과 파랑 채널을 어긋나게 해서 렌즈 번짐을 흉내 냅니다.',
    params: [['amount', '세기', 0, 100, 30]],
    apply(c, f, e) { channelShift(c, f.amount / 100 * 12 * e.unit, 0); } },
  { type: 'scanlines', name: 'VHS 주사선', cat: 1, target: 'all', desc: '옛 모니터처럼 가로 줄무늬를 겹칩니다.',
    params: [['amount', '세기', 0, 100, 35], ['gap', '간격', 2, 12, 4]],
    apply(c, f, e) { const s = makeCanvas(c.width, c.height), sx = s.getContext('2d'), g = Math.max(2, f.gap * e.unit * 0.8);
      sx.fillStyle = '#000'; for (let y = 0; y < c.height; y += g) sx.fillRect(0, y, c.width, g / 2);
      if (e.mask) maskWith(s, e.mask); blendOnto(c.getContext('2d'), s, 'multiply', f.amount / 100 * 0.6); } },
  { type: 'pixelate', name: '모자이크', cat: 1, target: 'all', desc: '큰 픽셀 블록으로 만듭니다.',
    params: [['amount', '블록 크기', 1, 100, 20]],
    apply(c, f, e) { const w = c.width, h = c.height, b = Math.max(2, f.amount * e.unit * 0.6), sw = Math.max(1, Math.round(w / b)), sh = Math.max(1, Math.round(h / b));
      const s = makeCanvas(sw, sh); s.getContext('2d').drawImage(c, 0, 0, sw, sh);
      const x = c.getContext('2d'); x.save(); x.clearRect(0, 0, w, h); x.imageSmoothingEnabled = false; x.drawImage(s, 0, 0, w, h); x.restore(); } },
  // ---- 빛
  { type: 'bloom', name: '블룸 (빛 번짐)', cat: 2, target: 'all', desc: '밝은 부분에서 빛이 부드럽게 번져 나옵니다.',
    params: [['amount', '세기', 0, 100, 35], ['size', '번짐 크기', 1, 100, 40]],
    apply(c, f, e) { const s = makeCanvas(c.width, c.height), sx = s.getContext('2d');
      sx.drawImage(filtered(c, 'brightness(70%) contrast(260%) saturate(120%)'), 0, 0);
      const s2 = filtered(s, `blur(${(4 + f.size / 100 * 40) * e.unit}px)`);
      if (e.mask) maskWith(s2, e.mask); blendOnto(c.getContext('2d'), s2, 'screen', f.amount / 100); } },
  { type: 'godray', name: '빛줄기', cat: 2, target: 'all', desc: '빛 방향에서 뻗어 나오는 빛줄기를 얹습니다.',
    params: [['amount', '세기', 0, 100, 50]],
    apply(c, f, e) { const W = c.width, H = c.height, diag = Math.hypot(W, H), from = lightFrom(e.light.dir) || [0, -1];
      const s = makeCanvas(W, H), x = s.getContext('2d'), R = rng(11);
      const sx = W / 2 + from[0] * diag * 0.6, sy = H / 2 + from[1] * diag * 0.6, base = Math.atan2(H / 2 - sy, W / 2 - sx);
      for (let i = 0; i < 16; i++) { const a = base + (R() - 0.5) * 0.9, wd = 0.006 + R() * 0.025;
        const g = x.createRadialGradient(sx, sy, 0, sx, sy, diag * 1.3);
        g.addColorStop(0, hexA(e.light.color, 0.55 + R() * 0.4)); g.addColorStop(1, hexA(e.light.color, 0));
        x.fillStyle = g; x.beginPath(); x.moveTo(sx, sy); x.arc(sx, sy, diag * 1.3, a - wd, a + wd); x.closePath(); x.fill(); }
      const sb = filtered(s, `blur(${diag * 0.006}px)`); if (e.mask) maskWith(sb, e.mask); blendOnto(c.getContext('2d'), sb, 'screen', f.amount / 100 * 0.8); } },
  { type: 'lightLeak', name: '빛 새어듦', cat: 2, target: 'all', desc: '필름 카메라처럼 따뜻한 빛이 가장자리로 스며듭니다.',
    params: [['amount', '세기', 0, 100, 50], ['hue', '색조', 0, 360, 20]],
    apply(c, f, e) { const W = c.width, H = c.height, diag = Math.hypot(W, H), s = makeCanvas(W, H), x = s.getContext('2d');
      const blob = (px, py, r, h2, a) => { const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `hsla(${h2},100%,60%,${a})`); g.addColorStop(1, `hsla(${h2},100%,60%,0)`); x.fillStyle = g; x.fillRect(0, 0, W, H); };
      blob(W * 0.02, H * 0.15, diag * 0.45, f.hue, 0.9); blob(0, H * 0.75, diag * 0.3, f.hue + 25, 0.6); blob(W, H * 0.05, diag * 0.25, f.hue - 15, 0.5);
      if (e.mask) maskWith(s, e.mask); blendOnto(c.getContext('2d'), s, 'screen', f.amount / 100 * 0.8); } },
  { type: 'leafShadow', name: '나뭇잎 그림자', cat: 2, target: 'character', desc: '나뭇잎 사이로 빛이 새는 얼룩 그림자를 얹습니다.',
    params: [['amount', '세기', 0, 100, 50], ['seed', '패턴', 1, 50, 7]],
    apply(c, f, e) { const w = c.width, h = c.height, s = makeCanvas(w, h), x = s.getContext('2d'), R = rng(f.seed);
      x.fillStyle = 'rgb(25,30,45)';
      const n = Math.round(30 + w * h / (e.unit * e.unit * 9000));
      for (let i = 0; i < Math.min(n, 400); i++) { x.beginPath(); x.ellipse(R() * w, R() * h, (20 + R() * 70) * e.unit, (12 + R() * 40) * e.unit, R() * Math.PI, 0, Math.PI * 2); x.fill(); }
      const sb = filtered(s, `blur(${Math.max(2, 10 * e.unit)}px)`); if (e.mask) maskWith(sb, e.mask); blendOnto(c.getContext('2d'), sb, 'multiply', f.amount / 100 * 0.75); } },
  { type: 'gloss', name: '광택', cat: 2, target: 'character', desc: '비스듬한 빛 반사 띠가 지나갑니다.',
    params: [['amount', '세기', 0, 100, 40]],
    apply(c, f, e) { const w = c.width, h = c.height, s = makeCanvas(w, h), x = s.getContext('2d'), g = x.createLinearGradient(0, 0, w, h);
      [[.28, 0], [.36, .9], [.42, 0], [.5, 0], [.54, .5], [.58, 0]].forEach(([o, a]) => g.addColorStop(o, `rgba(255,255,255,${a})`));
      x.fillStyle = g; x.fillRect(0, 0, w, h); if (e.mask) maskWith(s, e.mask); blendOnto(c.getContext('2d'), s, 'screen', f.amount / 100 * 0.6); } },
  // ---- 분위기
  { type: 'underwater', name: '물속 일렁임', cat: 3, target: 'all', desc: '물속처럼 일렁이는 빛 무늬를 겹칩니다.',
    params: [['amount', '세기', 0, 100, 50]],
    apply(c, f, e) { const W = c.width, H = c.height, s = makeCanvas(W, H), x = s.getContext('2d'), sc = 300 * e.unit / 256 * 1.3;
      x.setTransform(sc, 0, 0.25 * sc, sc, 0, 0); x.fillStyle = x.createPattern(causticTile(), 'repeat'); x.fillRect(-W, 0, W * 3 / sc, H / sc + 2);
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-in';
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,.25)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      if (e.mask) maskWith(s, e.mask); blendOnto(c.getContext('2d'), s, 'screen', f.amount / 100 * 0.6); } },
  { type: 'mist', name: '안개', cat: 3, target: 'all', desc: '아래쪽부터 뿌옇게 깔리는 습한 공기입니다.',
    params: [['amount', '세기', 0, 100, 40]],
    apply(c, f, e) { const W = c.width, H = c.height, s = makeCanvas(W, H), x = s.getContext('2d'), g = x.createLinearGradient(0, H, 0, 0);
      g.addColorStop(0, 'rgba(225,232,240,.95)'); g.addColorStop(0.55, 'rgba(225,232,240,.35)'); g.addColorStop(1, 'rgba(225,232,240,.1)');
      x.fillStyle = g; x.fillRect(0, 0, W, H); if (e.mask) maskWith(s, e.mask); blendOnto(c.getContext('2d'), s, 'screen', f.amount / 100 * 0.7); } },
  { type: 'vignette', name: '비네팅', cat: 3, target: 'all', desc: '가장자리를 어둡게 해서 시선을 가운데로 모읍니다.',
    params: [['amount', '세기', 0, 100, 50]],
    apply(c, f, e) { const W = c.width, H = c.height, s = makeCanvas(W, H), x = s.getContext('2d');
      const g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      if (e.mask) maskWith(s, e.mask); blendOnto(c.getContext('2d'), s, 'multiply', f.amount / 100 * 0.85); } },
  // ---- 스타일
  { type: 'speedLines', name: '만화 집중선', cat: 4, target: 'all', desc: '화면 바깥에서 가운데로 모이는 집중선을 그립니다.',
    params: [['amount', '세기', 0, 100, 50], ['count', '선 개수', 20, 200, 90]],
    apply(c, f, e) { const W = c.width, H = c.height, s = makeCanvas(W, H), x = s.getContext('2d'), R = rng(5), cx = W / 2, cy = H / 2, r = Math.hypot(W, H) / 2;
      x.fillStyle = '#fff';
      for (let i = 0; i < f.count; i++) { const a = R() * Math.PI * 2, wd = (0.002 + R() * 0.006), inner = r * (0.45 + R() * 0.3);
        x.beginPath(); x.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner); x.lineTo(cx + Math.cos(a - wd) * r * 1.2, cy + Math.sin(a - wd) * r * 1.2); x.lineTo(cx + Math.cos(a + wd) * r * 1.2, cy + Math.sin(a + wd) * r * 1.2); x.fill(); }
      if (e.mask) maskWith(s, e.mask); blendOnto(c.getContext('2d'), s, 'source-over', f.amount / 100 * 0.85); } },
  { type: 'posterize', name: '포스터화', cat: 4, target: 'all', desc: '색 단계를 줄여 일러스트/판화 같은 느낌을 냅니다.',
    params: [['amount', '단계 수', 2, 16, 6]],
    apply(c, f) { const x = c.getContext('2d', { willReadFrequently: true }), id = x.getImageData(0, 0, c.width, c.height), d = id.data, n = f.amount - 1;
      for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) d[i + j] = Math.round(d[i + j] / 255 * n) / n * 255;
      x.putImageData(id, 0, 0); } },
  { type: 'monotone', name: '흑백 / 세피아', cat: 4, target: 'all', desc: '색을 빼서 흑백이나 세피아 톤으로 만듭니다.',
    params: [['amount', '세기', 0, 100, 60], ['sepia', '세피아', 0, 100, 0]],
    apply(c, f) { const t = filtered(c, `grayscale(100%) sepia(${f.sepia}%)`), x = c.getContext('2d'); x.save(); x.globalAlpha = f.amount / 100;
      x.globalCompositeOperation = 'source-atop'; x.drawImage(t, 0, 0); x.restore(); } },
];

function defaultEffects() {
  const o = {};
  for (const d of EFFECTS) { o[d.type] = { on: false, target: d.target }; for (const [k, , , , def] of d.params) o[d.type][k] = def; }
  return o;
}

function applyEffects(c, p, target, env) {
  for (const d of EFFECTS) {
    const f = p.effects[d.type];
    if (!f || !f.on || f.target !== target) continue;
    d.apply(c, f, env);
  }
}

// ---- 보조
function fillEdges(c, orig) { // 흐림으로 생긴 투명 가장자리를 원래 사본으로 메움
  const x = c.getContext('2d'); x.save(); x.globalCompositeOperation = 'destination-over'; x.drawImage(orig, 0, 0); x.restore();
}
function channelShift(c, d, dy) {
  d = Math.round(d); if (!d) return;
  const x = c.getContext('2d', { willReadFrequently: true }), w = c.width, h = c.height;
  const id = x.getImageData(0, 0, w, h), s = new Uint8ClampedArray(id.data), o = id.data;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const k = (y * w + i) * 4, r = (y * w + clamp(i - d, 0, w - 1)) * 4, b = (y * w + clamp(i + d, 0, w - 1)) * 4;
    o[k] = s[r]; o[k + 2] = s[b + 2]; o[k + 3] = Math.max(s[k + 3], s[r + 3], s[b + 3]);
  }
  x.putImageData(id, 0, 0);
}
let _noise = null;
function noiseTile() {
  if (_noise) return _noise;
  _noise = keepCanvas(makeCanvas(256, 256)); const x = _noise.getContext('2d'), id = x.createImageData(256, 256), R = rng(3);
  for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (R() - 0.5) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  x.putImageData(id, 0, 0); return _noise;
}
let _caustic = null;
function causticTile() {
  if (_caustic) return _caustic;
  const N = 256; _caustic = keepCanvas(makeCanvas(N, N)); const x = _caustic.getContext('2d'), id = x.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) {
    const u = i / N * Math.PI * 2, v = y / N * Math.PI * 2;
    let s = Math.sin(u * 3 + Math.sin(v * 2) * 1.5) + Math.sin(v * 4 + Math.sin(u * 3) * 1.2) + Math.sin((u + v) * 2 + Math.sin(u - v));
    s = Math.pow(1 - Math.min(1, Math.abs(s) / 1.2), 4);
    const k = (y * N + i) * 4; id.data[k] = 190 * s; id.data[k + 1] = 245 * s; id.data[k + 2] = 255 * s; id.data[k + 3] = 255;
  }
  x.putImageData(id, 0, 0); return _caustic;
}
