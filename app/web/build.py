# renderer/ 소스를 하나의 HTML(아티팩트용)로 묶는다
import re, pathlib
R = pathlib.Path(__file__).resolve().parent.parent / 'renderer'
h = (R / 'index.html').read_text()
body = h[h.index('<body>') + 6:h.index('</body>')]
css = (R / 'style.css').read_text()
js = '\n'.join((R / f).read_text() for f in ['engine.js', 'effects.js', 'app.js'])
body = re.sub(r'<script src="[^"]+"></script>\n?', '', body)
out = f'''<title>IllustBlend</title>
<meta name="description" content="배경과 인물이 어우러지도록 필터 층만 얹는 합성 도구">
<style>
{css}
</style>
{body}
<script>
{js}
</script>
'''
(pathlib.Path(__file__).parent / 'IllustBlend.html').write_text(out)
print(len(out))
