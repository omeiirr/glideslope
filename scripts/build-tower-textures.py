#!/usr/bin/env python3
"""Build the pavement textures for tower mode into public/tower/tex/.

Sources (Poly Haven, CC0 1.0, https://polyhaven.com/license), downloaded at 1K:
  aerial_asphalt_01        30 m x 30 m asphalt with tyre scuffs and sealed cracks  -> asphalt.jpg
  concrete_floor_worn_001   3 m x 3 m worn concrete                                -> concrete.jpg

Both are made grey and brightened so the renderer's surface colour sets the tone (the same textures
serve runways, taxiways and aprons). concrete.jpg is a 15 m tile of 5 m apron slabs: the concrete
photo tiled 5 x 5, each slab a slightly different tone, with dark joints.
macro.jpg is soft large-scale variation (one tile = 1.2 km), multiplied over all pavement so wide
areas are not one flat tone from the tower.

Usage: python3 scripts/build-tower-textures.py   (needs Pillow and numpy)
"""
import io, os, urllib.request
import numpy as np
from PIL import Image, ImageFilter

OUT = "public/tower/tex"
URL = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{0}/{0}_diff_1k.jpg"

def fetch(asset):
    req = urllib.request.Request(URL.format(asset), headers={"User-Agent": "vectors-atc-build/1.0"})
    return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert("L")

def normalise(a, mean, spread):
    """Grey array to a given mean and standard deviation (0..255)."""
    a = a.astype(np.float32)
    return np.clip((a - a.mean()) / (a.std() + 1e-6) * spread + mean, 0, 255)

os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

# asphalt: 30 m, 1024 px
asph = normalise(np.asarray(fetch("aerial_asphalt_01").resize((1024, 1024), Image.LANCZOS)), 228, 20)
Image.fromarray(asph.astype(np.uint8)).save(f"{OUT}/asphalt.jpg", quality=85)

# concrete: 15 m tile of 5 m slabs, 1024 px (68 px per metre)
N, SLABS = 1024, 3
src = fetch("concrete_floor_worn_001").resize((N // SLABS * 2, N // SLABS * 2), Image.LANCZOS)  # one photo = 3 m
src = normalise(np.asarray(src), 0, 12)
tile = np.zeros((N, N), np.float32)
step = N / SLABS
for i in range(SLABS):
    for j in range(SLABS):
        y0, y1, x0, x1 = round(i * step), round((i + 1) * step), round(j * step), round((j + 1) * step)
        # each slab takes a different patch of the photo, and its own tone
        oy, ox = rng.integers(0, src.shape[0] - (y1 - y0)), rng.integers(0, src.shape[1] - (x1 - x0))
        tile[y0:y1, x0:x1] = 205 + rng.normal(0, 10) + src[oy:oy + y1 - y0, ox:ox + x1 - x0]
for k in range(SLABS):  # joints: 2 px dark lines on each slab edge (the tile edge is one of them)
    p = round(k * step)
    tile[max(p - 2, 0):p + 2, :] -= 70
    tile[:, max(p - 2, 0):p + 2] -= 70
tile[-2:, :] -= 70
tile[:, -2:] -= 70
Image.fromarray(np.clip(tile, 0, 255).astype(np.uint8)).save(f"{OUT}/concrete.jpg", quality=85)

# macro variation: tileable smooth noise from a few octaves of random grids, wrapped
M = 512
macro = np.zeros((M, M), np.float32)
for cells, amp in [(4, 1.0), (8, 0.6), (16, 0.35), (48, 0.15)]:
    g = rng.normal(0, 1, (cells, cells)).astype(np.float32)
    big = np.tile(g, (3, 3))  # wrap so the resize is seamless at the edges
    img = Image.fromarray(big).resize((M * 3, M * 3), Image.BICUBIC)
    macro += np.asarray(img)[M:2 * M, M:2 * M] * amp
macro = normalise(macro, 200, 30)
Image.fromarray(macro.astype(np.uint8)).filter(ImageFilter.GaussianBlur(1)).save(f"{OUT}/macro.jpg", quality=85)
print({f: os.path.getsize(f"{OUT}/{f}") for f in os.listdir(OUT)})
