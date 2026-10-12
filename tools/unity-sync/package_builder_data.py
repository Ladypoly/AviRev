"""Package the refreshed Unity export into avi-rev-pages with package_review_compact.py's chunk format (builder data only).

Sources: browser_data/geometry/*.bin, the four native report JSONs, the hybrid host catalog and its compact WebP textures.
Files the new manifest no longer references are moved (never deleted) to the sync backup folder.
"""
import gzip, hashlib, json, mimetypes, re, shutil, sys
from pathlib import Path

ROOT = Path('C:/Users/Elin/blender-comparison/asset_review_20261011')
DATA, HOST, PAGES = ROOT / 'browser_data', ROOT / 'browser_delivery_compact/host', ROOT / 'avi-rev-pages'
ASIDE = Path('C:/Users/Elin/blender-comparison/avirev_sync_20261012/replaced_web')
CHUNK, DIRECT_LIMIT = 650_000, 900_000
# Each release's textures get their own folder so uploads never overwrite files the live catalog still uses.
TEXTURES = 'textures_r107'
NATIVE_JSON = ('unity_resolution_vectors.json', 'export_report.json', 'atlas_availability.json', 'validation_report.json')
mimetypes.add_type('image/webp', '.webp')
sha = lambda blob: hashlib.sha256(blob).hexdigest()

sources = [(p, 'browser_data/geometry/' + p.name) for p in sorted((DATA / 'geometry').glob('*.bin'))]
sources += [(DATA / n, 'browser_data/' + n) for n in NATIVE_JSON]
catalog = (HOST / 'catalog.json').read_text(encoding='utf-8')
retargeted = catalog.replace('"url":"textures/', '"url":"' + TEXTURES + '/')
assert retargeted.count('"url":"' + TEXTURES + '/') == catalog.count('"url":"textures/') > 0
staged = Path('C:/Users/Elin/blender-comparison/avirev_sync_20261012/catalog_' + TEXTURES + '.json'); staged.write_text(retargeted, encoding='utf-8')
sources.append((staged, 'browser_data/catalog.json'))
sources += [(p, 'browser_data/' + TEXTURES + '/' + p.name) for p in sorted((HOST / 'textures').glob('*.webp'))]
assert len({r for _, r in sources}) == len(sources)

delivery, written = {}, set()
for path, relative in sources:
    blob = path.read_bytes(); digest = sha(blob)
    stored = gzip.compress(blob, compresslevel=6, mtime=0) if path.suffix in ('.bin', '.json') else blob
    compressed = len(stored) < len(blob) * .9
    if not compressed: stored = blob
    if len(blob) <= DIRECT_LIMIT and not compressed:
        target = PAGES / relative; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(blob); written.add(relative)
        assert sha(target.read_bytes()) == digest, relative
        continue
    parts = []
    for i, offset in enumerate(range(0, len(stored), CHUNK)):
        part = f'chunks/{digest[:24]}_{i:04d}.bin'; (PAGES / part).write_bytes(stored[offset:offset + CHUNK]); parts.append(part); written.add(part)
    restored = b''.join((PAGES / p).read_bytes() for p in parts)
    assert sha(gzip.decompress(restored) if compressed else restored) == digest, relative
    delivery[relative] = dict(parts=parts, size=len(blob), storedSize=len(stored), mime=mimetypes.guess_type(relative)[0] or 'application/octet-stream', sha256=digest)
    if compressed: delivery[relative]['encoding'] = 'gzip'

manifest = json.dumps(delivery, separators=(',', ':')).encode()
(PAGES / 'delivery-manifest.json').write_bytes(manifest)

# Move stale builder data the new manifest no longer references.
moved = []
for folder in ('chunks', 'browser_data/textures', 'browser_data/' + TEXTURES, 'browser_data/geometry'):
    for path in sorted((PAGES / folder).glob('*')) if (PAGES / folder).is_dir() else []:
        relative = path.relative_to(PAGES).as_posix()
        if path.is_file() and relative not in written:
            target = ASIDE / relative; target.parent.mkdir(parents=True, exist_ok=True); shutil.move(str(path), str(target)); moved.append(relative)

# Point the runtime at the new manifest (cache-busting query, same convention as tools/version-runtime.py).
assets = PAGES / 'builder-assets.mjs'; text = assets.read_bytes()
new = re.sub(rb'delivery-manifest\.json\?v=[0-9a-f]{12}', b'delivery-manifest.json?v=' + sha(manifest)[:12].encode(), text)
assert new != text or sha(manifest)[:12].encode() in text; assets.write_bytes(new)

print(json.dumps({'status': 'PASS', 'entries': len(delivery), 'chunked': sum(1 for k in delivery), 'directFiles': len([w for w in written if not w.startswith('chunks/')]),
                  'chunkFiles': len([w for w in written if w.startswith('chunks/')]), 'movedStale': len(moved), 'manifestSha12': sha(manifest)[:12],
                  'catalogSha256': delivery['browser_data/catalog.json']['sha256']}))
