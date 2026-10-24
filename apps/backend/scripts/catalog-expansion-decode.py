"""Emit measured image facts only; visual approval is never inferred here."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image

manifest = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
public = Path(sys.argv[2]).resolve()
assets = []
for asset in manifest['assets']:
    filename = (public / asset['path'].lstrip('/')).resolve()
    if not filename.is_relative_to(public):
        raise ValueError('Image path escapes public directory')
    with Image.open(filename) as image:
        image.load()
        width, height = image.size
    assets.append(dict(path=asset['path'], sha256=hashlib.sha256(filename.read_bytes()).hexdigest(),
                       width=width, height=height, decoded=True))
print(json.dumps(assets))
