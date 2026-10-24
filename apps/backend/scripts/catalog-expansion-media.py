"""Decode/optimize generated intermediates and prepare a provenance draft plus QA sheets.

This does not generate artwork or approve visuals. Review the sheets and originals before
promoting any draft row to reviewStatus=approved. Requires Pillow.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil

from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--categories', required=True, help='Comma-separated owned category slugs')
    parser.add_argument('--output', required=True, help='Backend-relative draft manifest filename')
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1]
    public = backend.parent / 'frontend' / 'public'
    cache = backend / '.cache' / 'catalog-expansion'
    originals = cache / 'originals'
    originals.mkdir(parents=True, exist_ok=True)
    data = json.loads((backend / 'prisma/data/catalog-expansion.json').read_text(encoding='utf-8'))['dataset']
    categories = set(args.categories.split(','))
    expected = []
    for category in data['categories']:
        if category['slug'] in categories:
            expected.append(dict(path=category['imageUrl'], sku=None, categorySlug=category['slug'], brandSlug=None, view='category-cover'))
    for product in data['products']:
        if product['categorySlug'] in categories:
            for image in product['images']:
                expected.append(dict(path=image['url'], sku=product['sku'], categorySlug=product['categorySlug'],
                                     brandSlug=product['brandSlug'], view='primary' if image['isPrimary'] else 'alternate'))
    assets = []
    for reference in expected:
        target = public / reference['path'].lstrip('/')
        source = target.with_suffix('.png')
        if not target.exists():
            if not source.exists():
                raise FileNotFoundError(f'Missing generated source: {reference["path"]}')
            with Image.open(source) as image:
                image.load()
                image.convert('RGB').save(target, 'WEBP', quality=86, method=6)
        with Image.open(target) as image:
            image.load()
            width, height = image.size
            if image.format != 'WEBP' or min(width, height) < 600:
                raise ValueError(f'Invalid final image: {reference["path"]}')
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        assets.append(dict(**reference, kind='ai-generated',
            source='Codex built-in imagegen / ChatGPT Plus, generated for this catalog task',
            commercialDisplayRights='approved',
            rightsBasis='Owner authorized illustrative storefront use; no manufacturer-photo claim',
            mlTrainingRights='Not authorized; generated illustration excluded from ground-truth training data',
            redistributionRights='Kaggle/ML dataset redistribution not authorized by this task',
            sha256=digest, width=width, height=height, duplicateGroup=None, reviewStatus='pending',
            byteSize=target.stat().st_size))
        # Preserve task-created PNG intermediates outside the public directory after successful decode.
        if source.exists():
            archived = originals / source.name
            if archived.exists():
                if hashlib.sha256(archived.read_bytes()).digest() != hashlib.sha256(source.read_bytes()).digest():
                    raise ValueError(f'Different original already archived: {source.name}')
                source.unlink()
            else:
                shutil.move(str(source), str(archived))
    for category in sorted(categories):
        group = [asset for asset in assets if asset['categorySlug'] == category]
        tile = 400
        columns = 4
        sheet = Image.new('RGB', (columns * tile, math.ceil(len(group) / columns) * (tile + 44)), 'white')
        draw = ImageDraw.Draw(sheet)
        for index, asset in enumerate(group):
            x, y = index % columns * tile, index // columns * (tile + 44)
            with Image.open(public / asset['path'].lstrip('/')) as image:
                image.thumbnail((tile, tile))
                sheet.paste(image, (x + (tile - image.width) // 2, y + (tile - image.height) // 2))
            label = Path(asset['path']).stem
            draw.text((x + 5, y + tile + 2), label[:49], fill='black')
        sheet.save(cache / f'qa-{category}.jpg', quality=90)
    destination = (backend / args.output).resolve()
    if not destination.is_relative_to(backend):
        raise ValueError('Draft output must stay inside the backend workspace')
    destination.write_text(json.dumps(dict(version=1, assets=assets), indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(assets=len(assets), decoded=len(assets), draft=str(destination), visuallyApproved=False)))


if __name__ == '__main__':
    main()
