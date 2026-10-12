import hashlib, re, json
from pathlib import Path

root=Path(__file__).resolve().parent.parent
web=root
done={}
def version(path):
    if path in done:return done[path]
    source=path.read_text(encoding='utf-8')
    def dependency(match):
        name=match.group(2)
        target=(path.parent/name).resolve()
        assert target.is_relative_to(web.resolve()) and target.is_file(),name
        return match.group(1)+name+'?v='+version(target)+match.group(3)
    source=re.sub(r'''(["'])(\./builder-[\w-]+\.mjs)(?:\?v=[\w-]+)?(["'])''',dependency,source)
    path.write_text(source,encoding='utf-8')
    done[path]=hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    return done[path]
for path in sorted(web.glob('builder-*.mjs')):version(path)
version(web/'builder.js')
css=hashlib.sha256((web/'builder.css').read_bytes()).hexdigest()[:12]
review=hashlib.sha256((web/'review-access.js').read_bytes()).hexdigest()[:12]
for path in [web/'builder.html',web/'index.html']:
    source=path.read_text(encoding='utf-8')
    for name,digest in [('builder.js',done[web/'builder.js']),('builder.css',css),('review-access.js',review)]:
        source=re.sub(r'('+re.escape(name)+r')(?:\?v=[\w-]+)?',lambda m:m[1]+'?v='+digest,source)
    path.write_text(source,encoding='utf-8')
print(json.dumps({'status':'PASS','versions':{p.name:v for p,v in done.items()},'css':css}))
