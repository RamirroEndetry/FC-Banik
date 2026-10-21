"""Crop the white margins off partner logos so they fill the kiosk tiles.

Logos from the club site are 569x379 PNGs with a white background and wide
empty borders. The crop keeps a small even margin and pads back to a 3:2 tile.
Usage: python scripts/trim-partner-logos.py [files...]   (default: all in dist/assets/partners)
Also imported by sync-club-content.py after each download.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
MARGIN = 14         # px kept around the artwork at source resolution
RATIO = 3 / 2       # output tile aspect (w / h)
THRESHOLD = 235     # anything lighter counts as background

def trim(path):
    im = Image.open(path).convert('RGBA')
    flat = Image.new('RGBA', im.size, (255, 255, 255, 255))
    flat.alpha_composite(im)
    gray = flat.convert('L').point(lambda v: 0 if v >= THRESHOLD else 255)
    box = gray.getbbox()
    if not box:
        return False
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - MARGIN), max(0, y0 - MARGIN)
    x1, y1 = min(im.width, x1 + MARGIN), min(im.height, y1 + MARGIN)
    crop = flat.crop((x0, y0, x1, y1)).convert('RGB')
    w, h = crop.size
    tw, th = (w, round(w / RATIO)) if w / h >= RATIO else (round(h * RATIO), h)
    out = Image.new('RGB', (tw, th), (255, 255, 255))
    out.paste(crop, ((tw - w) // 2, (th - h) // 2))
    out.save(path, optimize=True)
    return True

if __name__ == '__main__':
    files = [Path(f) for f in sys.argv[1:]] or sorted((ROOT / 'dist' / 'assets' / 'partners').glob('*.png'))
    done = sum(trim(f) for f in files)
    print(f'Trimmed {done}/{len(files)} partner logos.')
