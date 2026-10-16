"""Reproduce the pinned light player from `npm pack lottie-web@5.13.0`.

Disable upstream document auto-discovery. Only our validated animationData may
reach the player; native page classes/data-animation-path must never load files.
"""
from pathlib import Path
import hashlib
import json
import tarfile

root = Path(__file__).resolve().parent.parent
archive = root / '.work/lottie-web-5.13.0.tgz'
expected_tar = '441d3df217cc8ba302338c3f168e1a3af0f221d3'
if hashlib.sha1(archive.read_bytes()).hexdigest() != expected_tar:
    raise RuntimeError('Unexpected upstream tarball')
with tarfile.open(archive) as source:
    original = source.extractfile('package/build/player/lottie_light.min.js').read()
    license_data = source.extractfile('package/LICENSE.md').read()
pattern = b'var Nt=setInterval((function(){"complete"===document.readyState&&(clearInterval(Nt),Vt())}),100);'
if original.count(pattern) != 1:
    raise RuntimeError('Auto-discovery patch no longer matches')
code = original.replace(pattern, b'var Nt=null;')
target = root / 'src/vendor'
target.mkdir(exist_ok=True)
(target / 'lottie-light.js').write_bytes(code)
licenses = root / 'assets/licenses'
licenses.mkdir(exist_ok=True)
(licenses / 'lottie-web-MIT.txt').write_bytes(license_data)
metadata = {
    'package': 'lottie-web', 'version': '5.13.0',
    'source': 'https://registry.npmjs.org/lottie-web/-/lottie-web-5.13.0.tgz',
    'upstreamFile': 'package/build/player/lottie_light.min.js',
    'upstreamSha256': hashlib.sha256(original).hexdigest(),
    'sha256': hashlib.sha256(code).hexdigest(),
    'tarballSha1': expected_tar,
    'modification': 'Disable the ready-state interval and automatic document search; use validated animationData only.',
}
(target / 'lottie-source.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
