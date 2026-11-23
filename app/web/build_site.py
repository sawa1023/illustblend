# renderer/ 소스로 GitHub Pages용 정적 사이트(site/)를 만든다
import re, pathlib, shutil, hashlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
R, OUT = ROOT / 'renderer', ROOT / 'site'
OUT.mkdir(exist_ok=True)
h = (R / 'index.html').read_text()
h = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\n', '', h)
h = h.replace('<meta charset="utf-8">', '''<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="배경과 인물 레이어를 쌓고, 원본은 그대로 둔 채 필터 층만 얹어 어우러지게 하는 합성 도구">
<meta name="theme-color" content="#2a2a2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="IllustBlend">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-180.png">''')
h = h.replace('<script src="app.js"></script>', '''<script src="app.js"></script>
<script>if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});</script>''')
(OUT / 'index.html').write_text(h)
for f in ['style.css', 'engine.js', 'effects.js', 'app.js']: shutil.copy(R / f, OUT / f)
ver = hashlib.sha1(b''.join((OUT / f).read_bytes() for f in ['index.html', 'style.css', 'engine.js', 'effects.js', 'app.js'])).hexdigest()[:10]
(OUT / 'sw.js').write_text(f'''// 오프라인 실행용 캐시 (파일이 바뀌면 버전이 바뀜)
const CACHE = 'illustblend-{ver}';
const FILES = ['./', 'index.html', 'style.css', 'engine.js', 'effects.js', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => {{ e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); }});
self.addEventListener('activate', e => {{ e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); }});
self.addEventListener('fetch', e => {{
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {{ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }}).catch(() => caches.match(e.request, {{ ignoreSearch: true }})));
}});
''')
(OUT / 'manifest.webmanifest').write_text('''{
  "name": "IllustBlend",
  "short_name": "IllustBlend",
  "description": "배경과 인물이 어우러지도록 필터 층만 얹는 합성 도구",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#1d1d1f",
  "theme_color": "#2a2a2e",
  "lang": "ko",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
''')
(OUT / '.nojekyll').write_text('')
print('site built', ver)
