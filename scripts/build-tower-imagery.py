#!/usr/bin/env python3
"""Build the ground imagery for tower mode into public/tower/.

Source: PDOK "Luchtfoto Beeldmateriaal 2024 25cm RGB" WMS (CC BY 4.0, Beeldmateriaal Nederland).
The layer is pinned to a year so a rebuild gives the same pictures.

Tiers (drawn in this order, later on top):
  base     60 x 60 km, coarse
  airport  12 x 12 km around the field
  rwy18R   corridor along the Polderbaan, incl. Tower West and the approach lights
  rwy24    box around runway 24 and the central tower
Every tile is at most 2048 px on a side. Bounds are written as lat/lon; the renderer places
them with the core's own projection, so the photo runways line up with the sim runways.

Usage: python3 scripts/build-tower-imagery.py   (needs Pillow with WebP; takes a few minutes)
"""
import io, json, math, os, sys, urllib.parse, urllib.request
from PIL import Image, ImageEnhance

LAYER = "2024_ortho25"
WMS = "https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0"
OUT = "public/tower"
ap = json.load(open("data/airports/EHAM.json"))
LAT0, LON0 = ap["lat"], ap["lon"]
M_LAT = 60 * 1852.0                                   # metres per degree, as in src/core/geo.ts
M_LON = M_LAT * math.cos(math.radians(LAT0))

def ll(x, y):
    """Metres east/north of the reference point -> (lat, lon)."""
    return LAT0 + y / M_LAT, LON0 + x / M_LON

def xy(lat, lon):
    return (lon - LON0) * M_LON, (lat - LAT0) * M_LAT

def get(south, west, north, east, w, h):
    q = urllib.parse.urlencode(dict(service="WMS", version="1.3.0", request="GetMap", layers=LAYER, styles="",
        crs="EPSG:4326", bbox=f"{south},{west},{north},{east}", width=w, height=h, format="image/jpeg"))
    for attempt in range(4):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(f"{WMS}?{q}", headers={"User-Agent": "tower-imagery-build"}), timeout=120).read()
            if raw[:2] == b"\xff\xd8":
                return Image.open(io.BytesIO(raw)).convert("RGB")
            err = raw[:300]
        except Exception as e:  # network hiccup: retry
            err = e
    sys.exit(f"WMS request failed: {err}")

def tier(name, x0, x1, y0, y1, mpp, quality):
    """Fetch the box (metres, x east / y north) at `mpp` metres per pixel, cut into tiles of <= 2048 px."""
    W, H = round((x1 - x0) / mpp), round((y1 - y0) / mpp)
    nx, ny = math.ceil(W / 2048), math.ceil(H / 2048)
    tiles = []
    for i in range(nx):
        for j in range(ny):
            px0, px1 = i * W // nx, (i + 1) * W // nx
            py0, py1 = j * H // ny, (j + 1) * H // ny          # py counts down from the north edge
            tw, th = px1 - px0, py1 - py0
            img = Image.new("RGB", (tw, th))
            step = 1024                                         # the service refuses large requests
            for sx in range(0, tw, step):
                for sy in range(0, th, step):
                    cw, chh = min(step, tw - sx), min(step, th - sy)
                    n, w_ = ll(x0 + (px0 + sx) * mpp, y1 - (py0 + sy) * mpp)
                    s, e = ll(x0 + (px0 + sx + cw) * mpp, y1 - (py0 + sy + chh) * mpp)
                    img.paste(get(s, w_, n, e, cw, chh), (sx, sy))
            # the look approved in the style test: richer colour, a little more contrast
            img = ImageEnhance.Contrast(ImageEnhance.Color(img).enhance(1.45)).enhance(1.08)
            f = f"{name}_{i}_{j}.webp"
            img.save(os.path.join(OUT, f), "WEBP", quality=quality, method=6)
            north, west = ll(x0 + px0 * mpp, y1 - py0 * mpp)
            south, east = ll(x0 + px1 * mpp, y1 - py1 * mpp)
            tiles.append(dict(file=f, south=round(south, 7), west=round(west, 7), north=round(north, 7), east=round(east, 7), w=tw, h=th))
            print(f, tw, th, os.path.getsize(os.path.join(OUT, f)) // 1024, "kB", flush=True)
    return dict(name=name, metresPerPixel=mpp, tiles=tiles)

os.makedirs(OUT, exist_ok=True)
rw = {r["id"]: r for r in ap["runways"]}
tw = {t["id"]: xy(t["lat"], t["lon"]) for t in ap["towers"]}
t18 = xy(rw["18R"]["lat"], rw["18R"]["lon"])
t24, t06 = xy(rw["24"]["lat"], rw["24"]["lon"]), xy(rw["06"]["lat"], rw["06"]["lon"])

only = sys.argv[1:]
tiers = []
def add(name, *a):
    if not only or name in only:
        tiers.append(tier(name, *a))
add("base", -30000, 30000, -30000, 30000, 30, 62)
add("airport", -8000, 4000, -6500, 7500, 4, 68)
# 18R: 1.9 km wide (runway to just east of Tower West), from 1.4 km before the threshold to 0.5 km past the far end
add("rwy18R", t18[0] - 750, tw["west"][0] + 450, t18[1] - 4300, t18[1] + 1400, 1.0, 72)
# 24: box around the runway and the central tower, 500 m margin
xs, ys = [t24[0], t06[0], tw["centre"][0]], [t24[1], t06[1], tw["centre"][1]]
add("rwy24", min(xs) - 500, max(xs) + 500, min(ys) - 500, max(ys) + 500, 1.2, 72)

manifest = dict(source="PDOK Luchtfoto Beeldmateriaal 2024 25cm RGB", layer=LAYER, licence="CC BY 4.0",
                attribution="Aerial imagery: Beeldmateriaal Nederland / PDOK, CC BY 4.0", tiers=tiers)
if not only:
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
px = sum(t["w"] * t["h"] for tr in tiers for t in tr["tiles"])
print(f"total {total / 1e6:.1f} MB, {px / 1e6:.1f} M pixels")
