#!/usr/bin/env python3
"""Build the airport buildings for tower mode into public/tower/buildings.json.

Source: OpenStreetMap via the Overpass API (ODbL 1.0, (c) OpenStreetMap contributors).

Each building: {h, mh (min height, 0 on the ground), s (style), r (outer ring [lat, lon], 6 decimals)}.
  height   height / building:height, else building:levels x 3.5 m, else a default per kind
  parts    building:part with a height of its own (others are left out). An outline is replaced by
           its parts only when they cover nearly all of it (OSM 3D convention); otherwise the outline is
           kept and only the parts that rise above it or float (min_height) are added.
  style    terminal  airport_terminal / terminal, or a name with "pier" or "terminal"
           hangar    industrial, warehouse, hangar, service, or a hangar / cargo building by name,
                     or a large untagged building (over 5000 m2)
           office    everything else with walls
           plain     storage tanks and open roofs

Outside the fence: buildings in a box round the airport that are not on it, of 300 m2 or more and within
OUTSIDE_KM of a cab (smaller or further ones are too small to see from the cab). Same heights and styles.

Usage: python3 scripts/build-tower-buildings.py [cached-overpass.json [cached-outside.json]]
Without arguments it fetches both from Overpass and saves the responses to osm-buildings-cache.json and
osm-buildings-outside-cache.json (gitignored).
"""
import json, math, re, sys, time, urllib.parse, urllib.request

QUERY = """[out:json][timeout:180];
rel["aeroway"="aerodrome"]["icao"="EHAM"];map_to_area->.a;
(way["building"](area.a);relation["building"](area.a);
 way["building:part"](area.a);relation["building:part"](area.a);
 way["man_made"="storage_tank"](area.a););
out geom;"""
OUTSIDE_QUERY = """[out:json][timeout:180];
(way["building"](52.27,4.68,52.38,4.84);relation["building"](52.27,4.68,52.38,4.84););
out geom;"""
OUTSIDE_KM = 4
OUTSIDE_MIN_M2 = 300
OUT = "public/tower/buildings.json"
CACHE = "osm-buildings-cache.json"
OUTSIDE_CACHE = "osm-buildings-outside-cache.json"
K = 111320 * math.cos(math.radians(52.31))

def fetch(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    wait = 5
    for _ in range(6):
        try:
            req = urllib.request.Request("https://overpass-api.de/api/interpreter", body,
                                         headers={"User-Agent": "vectors-atc-build/1.0"})
            raw = urllib.request.urlopen(req, timeout=200).read()
            if raw.lstrip()[:1] == b"{":
                return json.loads(raw)
        except Exception as e:  # busy server: back off and retry
            print("overpass:", e, file=sys.stderr)
        time.sleep(wait)
        wait *= 2
    sys.exit("Overpass is not answering; try again later or pass a cached response.")

def load(i, query, cache):
    if len(sys.argv) > i:
        return json.load(open(sys.argv[i]))["elements"]
    raw = fetch(query)
    json.dump(raw, open(cache, "w"))
    print("Overpass response saved to", cache)
    return raw["elements"]

els = load(1, QUERY, CACHE)
outside_els = load(2, OUTSIDE_QUERY, OUTSIDE_CACHE)

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

def outers(e):
    if e["type"] == "relation":
        return stitch([pts(m["geometry"]) for m in e["members"] if m.get("role") == "outer" and "geometry" in m])
    g = pts(e.get("geometry", []))
    return [g] if closed(g) else []

def area(r):
    xy = [(p[1] * K, p[0] * 111320) for p in r]
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(xy, xy[1:]))) / 2

def centroid(r):
    return [sum(p[0] for p in r[:-1]) / (len(r) - 1), sum(p[1] for p in r[:-1]) / (len(r) - 1)]

def inside(p, ring):
    x, y, c = p[1], p[0], False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def simplify(ring, tol):
    """Douglas-Peucker in metres; keeps the ring closed."""
    xy = [(p[1] * K, p[0] * 111320) for p in ring]
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
            d = abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / L if L > 1e-6 else math.hypot(x - ax, y - ay)
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(ring, keep) if k]

def num(t, *keys):
    for k in keys:
        try: return float(t[k].split()[0])
        except (KeyError, ValueError): pass
    return None

# default heights (m) when OSM has neither height nor levels; the piers that are tagged are 9-13 m
DEFAULT_H = {"hangar": 22, "terminal": 12, "airport_terminal": 12, "office": 18, "commercial": 14, "industrial": 10,
             "warehouse": 10, "transportation": 14, "parking": 12, "hotel": 30, "roof": 8, "storage_tank": 14}

def height(t):
    h = num(t, "height", "building:height")
    if h is None and "building:levels" in t:
        lv = num(t, "building:levels")
        h = lv * 3.5 + (num(t, "roof:levels") or 0) * 2 if lv is not None else None
    return h

def min_height(t):
    mh = num(t, "min_height", "building:min_height")
    if mh is None and "building:min_level" in t:
        lv = num(t, "building:min_level")
        mh = lv * 3.5 if lv is not None else None
    return mh or 0.0

def style(t, kind, a):
    name = t.get("name", "").lower()
    if kind == "storage_tank" or kind == "roof": return "plain"
    if kind in ("airport_terminal", "terminal") or re.search(r"pier|terminal", name): return "terminal"
    if kind in ("industrial", "warehouse", "hangar", "service", "barn", "farm_auxiliary", "shed", "greenhouse") or re.search(r"hangar|vrachtgebouw|cargo", name): return "hangar"
    if kind == "yes" and a > 5000: return "hangar"
    return "office"

outlines, parts = [], []
stats = {"tagged": 0, "default": 0}
for e in els:
    t = e.get("tags", {})
    is_part = "building:part" in t and "building" not in t
    if not is_part and "building" not in t and t.get("man_made") != "storage_tank": continue
    kind = "storage_tank" if t.get("man_made") == "storage_tank" else (t.get("building") or t.get("building:part"))
    for r in outers(e):
        a = area(r)
        if a < 30: continue
        b = {"t": t, "kind": kind, "r": r, "a": a, "h": height(t), "mh": min_height(t)}
        (parts if is_part else outlines).append(b)

parts = [p for p in parts if p["h"]]  # a part without its own height would only z-fight its outline
out = {"source": "OpenStreetMap (Overpass API)", "licence": "ODbL 1.0", "buildings": []}

def emit(b, s):
    r = simplify(b["r"], 0.7)
    if len(r) < 4 or b["h"] - b["mh"] < 1: return
    e = {"h": round(b["h"], 1), "s": s, "r": r}
    if b["mh"] > 0: e["mh"] = round(b["mh"], 1)
    out["buildings"].append(e)

used = set()
for o in outlines:
    tagged = o["h"] is not None
    stats["tagged" if tagged else "default"] += 1
    o["h"] = o["h"] or DEFAULT_H.get(o["kind"], 9)
    s = style(o["t"], o["kind"], o["a"])
    mine = [i for i, p in enumerate(parts) if inside(centroid(p["r"]), o["r"])]
    used.update(mine)
    covered = sum(parts[i]["a"] for i in mine if parts[i]["mh"] == 0) / o["a"]
    if covered < 0.9:
        emit(o, s)
        mine = [i for i in mine if parts[i]["h"] > o["h"] + 0.5 or parts[i]["mh"] > 0]
    for i in mine:
        emit(parts[i], s)
for i, p in enumerate(parts):  # parts outside every outline (towers drawn as parts only)
    if i not in used: emit(p, style(p["t"], p["kind"], p["a"]))

eham = json.load(open("data/airports/EHAM.json"))
cabs = [(t["lat"], t["lon"]) for t in eham["towers"]]
on_airport = {(e["type"], e["id"]) for e in els}
n_outside = 0
for e in outside_els:
    t = e.get("tags", {})
    if (e["type"], e["id"]) in on_airport or "building" not in t: continue
    for r in outers(e):
        a = area(r)
        c = centroid(r)
        near = min(math.hypot((c[1] - lo) * K, (c[0] - la) * 111320) for la, lo in cabs)
        if a < OUTSIDE_MIN_M2 or near > OUTSIDE_KM * 1000: continue
        h = height(t)
        stats["tagged" if h is not None else "default"] += 1
        b = {"r": r, "h": h or DEFAULT_H.get(t["building"], 9), "mh": min_height(t)}
        emit(b, style(t, t["building"], a))
        n_outside += 1
print(n_outside, "outside the fence")

json.dump(out, open(OUT, "w"), separators=(",", ":"))
from collections import Counter
print(len(out["buildings"]), "buildings", Counter(b["s"] for b in out["buildings"]), "heights from OSM/default", stats, "->", OUT)
