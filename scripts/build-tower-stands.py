#!/usr/bin/env python3
"""Build the apron details for tower mode into public/tower/stands.json.

Source: OpenStreetMap via the Overpass API (ODbL 1.0, (c) OpenStreetMap contributors).

Contents (coordinates [lat, lon], 7 decimals):
  stands  aeroway=parking_position centrelines {ref, pts} (de-icing bays and one-way lines left out)
  gates   aeroway=gate nodes {ref, p}
  bridges aeroway=jet_bridge centrelines
  masts   man_made=mast + tower:type=lighting nodes (apron floodlights), with height when tagged

Usage: python3 scripts/build-tower-stands.py [cached-overpass.json]
Without an argument it fetches from Overpass and saves the response to osm-stands-cache.json (gitignored).
"""
import json, sys, time, urllib.parse, urllib.request

BBOX = "52.27,4.68,52.38,4.82"
QUERY = f"""[out:json][timeout:120];
(way["aeroway"="parking_position"]({BBOX});
 node["aeroway"="gate"]({BBOX});
 way["aeroway"="jet_bridge"]({BBOX});
 node["man_made"="mast"]["tower:type"="lighting"]({BBOX}););
out geom;"""
OUT = "public/tower/stands.json"
CACHE = "osm-stands-cache.json"

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

if len(sys.argv) > 1:
    els = json.load(open(sys.argv[1]))["elements"]
else:
    raw = fetch()
    json.dump(raw, open(CACHE, "w"))
    print("Overpass response saved to", CACHE)
    els = raw["elements"]

r7 = lambda v: round(v, 7)
out = {"source": "OpenStreetMap (Overpass API)", "licence": "ODbL 1.0", "stands": [], "gates": [], "bridges": [], "masts": []}
for e in els:
    t = e.get("tags", {})
    if e["type"] == "node":
        p = [r7(e["lat"]), r7(e["lon"])]
        if t.get("aeroway") == "gate": out["gates"].append({"ref": t.get("ref", ""), "p": p})
        elif t.get("man_made") == "mast":
            try: h = float(t.get("height", "0").split()[0])
            except ValueError: h = 0.0
            out["masts"].append({"p": p, "h": h})
        continue
    g = [[r7(q["lat"]), r7(q["lon"])] for q in e.get("geometry", [])]
    if len(g) < 2: continue
    if t.get("aeroway") == "jet_bridge": out["bridges"].append(g)
    elif t.get("aeroway") == "parking_position":
        ref = t.get("ref", "")
        if "BAY" in ref.upper() or t.get("oneway") == "yes": continue
        out["stands"].append({"ref": ref, "pts": g})

json.dump(out, open(OUT, "w"), separators=(",", ":"))
print({k: len(v) for k, v in out.items() if isinstance(v, list)}, "->", OUT)
