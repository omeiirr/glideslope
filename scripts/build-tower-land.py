#!/usr/bin/env python3
"""Build the modelled surroundings for tower mode into public/tower/land.json.

Source: OpenStreetMap via the Overpass API (ODbL 1.0, (c) OpenStreetMap contributors).

Contents (coordinates [lat, lon], 6 decimals, about 0.1 m):
  land       {class: [polygon, ...]}: farmland, residential, industrial, forest, park, greenhouse, water
             simplified to 6 m, polygons under 1500 m2 dropped
  roads      motorways and trunk roads: {w, pts}
  buildings  inside the aerodrome: {h (m), k (kind), r (outer ring)}; height from height, else
             building:levels x 3.5 m, else a default per kind

Usage: python3 scripts/build-tower-land.py bld.json near1.json [near2.json ...] far.json
       (cached Overpass responses; see the queries in docs/design/tower3d.md)
"""
import json, math, sys

OUT = "public/tower/land.json"
K = 111320 * math.cos(math.radians(52.31))

def pts(geom):
    return [[round(p["lat"], 6), round(p["lon"], 6)] for p in geom]

def closed(g):
    return len(g) > 3 and g[0] == g[-1]

def stitch(ways):
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

def xy(p):
    return (p[1] * K, p[0] * 111320)

def area(ring):
    a = 0.0
    for p, q in zip(ring, ring[1:]):
        (x1, y1), (x2, y2) = xy(p), xy(q)
        a += x1 * y2 - x2 * y1
    return abs(a) / 2

def simplify(line, tol):
    """Douglas-Peucker in metres; a closed ring measures from its start point."""
    P = [xy(p) for p in line]
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = P[a], P[b]
        L = math.hypot(bx - ax, by - ay)
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            x, y = P[i]
            d = abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / L if L > 1e-6 else math.hypot(x - ax, y - ay)
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k_ in zip(line, keep) if k_]

LAND = {"farmland": "farm", "meadow": "farm", "grass": "park", "recreation_ground": "park", "allotments": "park",
        "residential": "residential", "industrial": "industrial", "commercial": "industrial", "retail": "industrial",
        "construction": "industrial", "railway": "industrial", "forest": "forest",
        "greenhouse_horticulture": "greenhouse"}

def land_class(t):
    if t.get("natural") == "water": return "water"
    if t.get("natural") == "wood": return "forest"
    if t.get("leisure") in ("park", "golf_course"): return "park"
    return LAND.get(t.get("landuse"))

# default heights (m) when OSM has neither height nor levels
DEFAULT_H = {"hangar": 22, "terminal": 18, "airport_terminal": 18, "office": 18, "commercial": 14, "industrial": 10, "warehouse": 10,
             "transportation": 14, "parking": 12, "hotel": 30, "roof": 8, "storage_tank": 14}

def height(t):
    for key in ("height", "building:height"):
        try: return float(t[key].split()[0])
        except (KeyError, ValueError): pass
    try: return float(t["building:levels"]) * 3.5 + float(t.get("roof:levels", 0)) * 2
    except (KeyError, ValueError): pass
    return None

files = sys.argv[1:]
if len(files) < 3: sys.exit(__doc__)
out = {"source": "OpenStreetMap (Overpass API)", "licence": "ODbL 1.0", "land": {}, "roads": [], "buildings": []}
seen = set()
stats = {"tagged": 0, "default": 0}
for f in files:
    for e in json.load(open(f))["elements"]:
        if (e["type"], e["id"]) in seen: continue  # quadrant overlaps come back twice
        seen.add((e["type"], e["id"]))
        t = e.get("tags", {})
        if "building" in t or t.get("man_made") == "storage_tank":
            rings = relation_polygons(e) if e["type"] == "relation" else [[pts(e.get("geometry", []))]]
            h = height(t)
            kind = "storage_tank" if t.get("man_made") == "storage_tank" else t["building"]
            stats["tagged" if h else "default"] += 1
            h = h or DEFAULT_H.get(kind, 9)
            for poly in rings:
                r = poly[0]
                if not closed(r) or area(r) < 30: continue
                r = simplify(r, 0.7)
                if len(r) >= 4: out["buildings"].append({"h": round(h, 1), "k": kind, "r": r})
            continue
        if t.get("highway") in ("motorway", "trunk"):
            g = simplify(pts(e["geometry"]), 3)
            w = 3.5 * int(t.get("lanes", "2").split(";")[0] or 2) + 4 if t.get("oneway") == "yes" else 30
            out["roads"].append({"w": w, "pts": g})
            continue
        c = land_class(t)
        if not c: continue
        polys = relation_polygons(e) if e["type"] == "relation" else ([[pts(e["geometry"])]] if closed(pts(e.get("geometry", []))) else [])
        for poly in polys:
            if area(poly[0]) < 1500: continue
            rings = [simplify(r, 6) for r in poly if area(r) >= 1500 or r is poly[0]]
            if len(rings[0]) >= 4: out["land"].setdefault(c, []).append([r for r in rings if len(r) >= 4])

json.dump(out, open(OUT, "w"), separators=(",", ":"))
print({k: len(v) for k, v in out["land"].items()}, "roads", len(out["roads"]), "buildings", len(out["buildings"]),
      "heights from OSM/default", stats, "->", OUT)
