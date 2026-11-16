"""Import a generated PNG as an optimized catalog WebP, preserving any superseded draft."""
import argparse
import hashlib
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--filename', required=True)
args = parser.parse_args()
backend = Path(__file__).resolve().parents[1]
source = Path(args.source).resolve()
filename = Path(args.filename)
if filename.name != args.filename or filename.suffix != '.webp':
    raise ValueError('Expected a single WebP filename')
target = backend.parent / 'frontend/public/images/catalog/expansion' / filename
with Image.open(source) as image:
    image.load()
    if min(image.size) < 600:
        raise ValueError('Generated image is too small')
    if target.exists():
        archived = backend / '.cache/catalog-expansion/superseded'
        archived.mkdir(parents=True, exist_ok=True)
        old = target.read_bytes()
        backup = archived / f'{target.stem}-{hashlib.sha256(old).hexdigest()[:12]}.webp'
        if not backup.exists():
            backup.write_bytes(old)
    image.convert('RGB').save(target, 'WEBP', quality=86, method=6)
print(target.name)
