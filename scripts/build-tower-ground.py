#!/usr/bin/env python3
"""Build the vector airport surfaces for tower mode into public/tower/ground.json.

Source: OpenStreetMap via the Overpass API (ODbL 1.0, (c) OpenStreetMap contributors).
The output is a derived database and stays under the ODbL; the app credits OSM on screen.

Contents (all coordinates [lat, lon], rounded to 7 decimals):
  runways   area:aeroway=runway polygons (stopways and pavement beyond the thresholds; the
            renderer also draws each runway between its sim thresholds, so gaps don't matter)
  aprons    aeroway=apron polygons, multipolygon relations stitched into rings with holes
  taxiwayAreas  area:aeroway=taxiway polygons
  taxiways  aeroway=taxiway centrelines with their width in metres (default 23)
  holds     runway holding positions (aerodrome_marking=holding_position lines)
  grass     landuse=grass/meadow polygons inside the aerodrome boundary, simplified to about 1 m

Usage: python3 scripts/build-tower-ground.py [cached-overpass.json ...]   (several cached responses are merged)
Without arguments it fetches from Overpass and saves the response to osm-ground-cache.json (gitignored).
"""
import json, math, sys, time, urllib.parse, urllib.request

BBOX = "52.27,4.68,52.38,4.82"
QUERY = f"""[out:json][timeout:120];
(way["aeroway"~"^(taxiway|apron|aerodrome_marking)$"]({BBOX});
 way["area:aeroway"]({BBOX});
 relation["aeroway"~"^(apron|aerodrome)$"]({BBOX});
 way["landuse"~"^(grass|meadow)$"]({BBOX});
 relation["landuse"~"^(grass|meadow)$"]({BBOX}););
out geom;"""
OUT = "public/tower/ground.json"

def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    wait = 5
    for _ in range(6):
        try:
            req = urllib.request.Request("https://overpass-api.de/api/interpreter", body,
                                         headers={"User-Agent": "vectors-atc-build/1.0"})
            raw = urllib.request.urlopen(req, timeout=120).read()
            if raw.lstrip()[:1] == b"{":
                return json.loads(raw)
        except Exception as e:  # busy server: back off and retry
            print("overpass:", e, file=sys.stderr)
        time.sleep(wait)
        wait *= 2
    sys.exit("Overpass is not answering; try again later or pass a cached response.")

CACHE = "osm-ground-cache.json"  # also the third input of scripts/build-eham.py (runway exits)
if len(sys.argv) > 1:
    els = [e for f in sys.argv[1:] for e in json.load(open(f))["elements"]]
else:
    raw = fetch()
    json.dump(raw, open(CACHE, "w"))
    print("Overpass response saved to", CACHE)
    els = raw["elements"]

def pts(geom):
    return [[round(p["lat"], 7), round(p["lon"], 7)] for p in geom]

def closed(g):
    return len(g) > 3 and g[0] == g[-1]

def stitch(ways):
    """Join open ways that share end points into closed rings."""
    rings, open_ = [], [w[:] for w in ways if w]
    while open_:
        ring = open_.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, w in enumerate(open_):
                if w[0] == ring[-1]: ring += w[1:]
                elif w[-1] == ring[-1]: ring += w[::-1][1:]
                elif w[-1] == ring[0]: ring = w + ring[1:]
                elif w[0] == ring[0]: ring = w[::-1] + ring[1:]
                else: continue
                open_.pop(i)
                changed = True
                break
        if closed(ring): rings.append(ring)
    return rings

def inside(p, ring):
    x, y, c = p[1], p[0], False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def relation_polygons(rel):
    outers = stitch([pts(m["geometry"]) for m in rel["members"] if m.get("role") == "outer" and "geometry" in m])
    inners = stitch([pts(m["geometry"]) for m in rel["members"] if m.get("role") == "inner" and "geometry" in m])
    return [[o] + [i for i in inners if inside(i[0], o)] for o in outers]

out = {"source": "OpenStreetMap (Overpass API)", "licence": "ODbL 1.0", "attribution": "Airport layout © OpenStreetMap contributors",
       "runways": [], "aprons": [], "taxiwayAreas": [], "taxiways": [], "holds": [], "grass": []}
grass, fence = [], []
for e in els:
    t = e.get("tags", {})
    if e["type"] == "relation":
        if t.get("aeroway") == "apron": out["aprons"] += relation_polygons(e)
        elif t.get("aeroway") == "aerodrome": fence = relation_polygons(e)
        elif t.get("landuse") in ("grass", "meadow"): grass += relation_polygons(e)
        continue
    g = pts(e.get("geometry", []))
    if len(g) < 2: continue
    if t.get("area:aeroway") == "runway" and closed(g): out["runways"].append([g])
    elif t.get("area:aeroway") == "taxiway" and closed(g): out["taxiwayAreas"].append([g])
    elif t.get("aeroway") == "apron" and closed(g): out["aprons"].append([g])
    elif t.get("aeroway") == "taxiway":
        try: w = float(t.get("width", "23").split()[0])
        except ValueError: w = 23.0
        out["taxiways"].append({"w": w, "pts": g})
    elif t.get("landuse") in ("grass", "meadow") and closed(g): grass.append([g])
    elif t.get("aerodrome_marking") == "holding_position" and t.get("holding_position:type", "runway") == "runway":
        out["holds"].append(g)

def simplify(ring, tol=1.0):
    """Douglas-Peucker in metres (local flat projection); keeps the ring closed."""
    k = 111320 * math.cos(math.radians(52.31))
    xy = [((p[1]) * k, p[0] * 111320) for p in ring]
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        L = math.hypot(bx - ax, by - ay)
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            x, y = xy[i]
            # a closed ring starts and ends on the same point: measure from that point instead of a line
            d = abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / L if L > 1e-6 else math.hypot(x - ax, y - ay)
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k_ in zip(ring, keep) if k_]

# airside grass only: the polygon's first point inside the aerodrome boundary (and not in a hole)
in_fence = lambda p: any(inside(p, poly[0]) and not any(inside(p, h) for h in poly[1:]) for poly in fence)
for poly in grass:
    if not in_fence(poly[0][0]): continue
    rings = [simplify(r) for r in poly]
    if len(rings[0]) >= 4: out["grass"].append([r for r in rings if len(r) >= 4])

json.dump(out, open(OUT, "w"), separators=(",", ":"))
print({k: len(v) for k, v in out.items() if isinstance(v, list)}, "->", OUT)
