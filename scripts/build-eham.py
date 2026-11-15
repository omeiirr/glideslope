#!/usr/bin/env python3
"""One-off generator for data/airports/EHAM.json.

Usage: python3 scripts/build-eham.py <openscope eham.json> <ourairports runways.csv> <osm taxiways.json>
The third file is the Overpass response that scripts/build-tower-ground.py saves to osm-ground-cache.json
(taxiway centrelines with refs).
Sources are recorded in DECISIONS.md. Hand-set values are marked below.
"""
import csv, json, math, re, sys

osc = json.load(open(sys.argv[1]))
rows = [r for r in csv.DictReader(open(sys.argv[2])) if r["airport_ident"] == "EHAM"]
osm = json.load(open(sys.argv[3]))["elements"]


def dms(s):
    m = re.match(r"([NSEW])(\d+)d([\d.]+)(?:m([\d.]+))?", s)
    v = int(m[2]) + float(m[3]) / 60 + (float(m[4]) / 3600 if m[4] else 0)
    return round(-v if m[1] in "SW" else v, 5)


def pt(p):
    return [dms(p[0]), dms(p[1])]


def bearing(a, b):
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return round(math.degrees(math.atan2(y, x)) % 360, 1)


def move(p, brg, m):
    """Point m metres from p on a bearing (flat earth; fine over a few hundred metres)."""
    k = 111320 * math.cos(math.radians(p[0]))
    b = math.radians(brg)
    return [round(p[0] + m * math.cos(b) / 111320, 6), round(p[1] + m * math.sin(b) / k, 6)]


# hand-set: openScope's 24 end lies about 70 m north-east of the painted threshold (seen on PDOK imagery,
# 45 m beyond the OSM pavement end). Moved onto the threshold.
THRESHOLD_FIX = {"24": 70}
HOLD_M = 95  # holding positions about 90 m from the centreline (ICAO Annex 14, code 4 precision runway)
ENTRY = {"24": "S7E"}  # departures line up from S7E, the entry nearest the start of 24 (OSM)


def exits(rw, opp):
    """Taxiways leaving the runway (OSM aeroway=taxiway with a ref), each as a path from the centreline to the
    holding position. Only exits a landing aircraft can take ahead of it (turn of 95 degrees or less)."""
    k = 111320 * math.cos(math.radians(rw["lat"]))
    h = math.radians(rw["heading"])
    def fr(lat, lon):  # metres along from the threshold, metres right of the centreline
        dx, dy = (lon - rw["lon"]) * k, (lat - rw["lat"]) * 111320
        return dx * math.sin(h) + dy * math.cos(h), dx * math.cos(h) - dy * math.sin(h)
    length = math.hypot((opp["lon"] - rw["lon"]) * k, (opp["lat"] - rw["lat"]) * 111320)
    found, entry = {}, None
    for e in osm:
        t = e.get("tags", {})
        name = t.get("ref") or t.get("name")
        if t.get("aeroway") != "taxiway" or not name or "geometry" not in e: continue
        g = [(p["lat"], p["lon"]) for p in e["geometry"]]
        for pts in (g, g[::-1]):
            s0, c0 = fr(*pts[0])
            if abs(c0) > 8 or not -50 < s0 < length + 50: continue
            path = [pts[0]]
            for a, b in zip(pts, pts[1:]):
                ca, cb = abs(fr(*a)[1]), abs(fr(*b)[1])
                if cb >= HOLD_M:
                    f = (HOLD_M - ca) / (cb - ca)
                    path.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
                    break
                path.append(b)
            else: continue  # never reaches the holding position
            s1, c1 = fr(*path[-1])
            turn = math.degrees(math.atan2(abs(c1 - c0), s1 - s0))
            ex = {"name": name, "distM": round(s0), "side": "R" if c1 > 0 else "L",
                  "path": [[round(a, 6), round(b, 6)] for a, b in path]}
            if ENTRY.get(rw["id"]) == name: entry = ex
            if turn <= 95: found[(name, ex["side"])] = ex
    return sorted(found.values(), key=lambda x: x["distM"]), entry


FIXES = """ARTIP RIVER SUGOL NIRSI NARIX EH601 EH602 EH603 EH605 EH606 EH607 EH608 EH621 SPL PAM SPY
OSKUR NOVEN HSD STD LUTEX ROBVI PEPEL LEKKO LOPIK ARNEM VALKO""".split()

runways = []
for r in osc["runways"]:
    ends = [pt(e) for e in r["end"]]  # openScope: landing thresholds (displaced where applicable)
    for i in (0, 1):
        if r["name"][i] in THRESHOLD_FIX:
            ends[i] = move(ends[i], bearing(ends[i], ends[1 - i]), THRESHOLD_FIX[r["name"][i]])
    row = next(x for x in rows if x["le_ident"] in r["name"])  # OurAirports: length / width
    for i in (0, 1):
        rw = {
            "id": r["name"][i],
            "lat": ends[i][0],
            "lon": ends[i][1],
            "heading": bearing(ends[i], ends[1 - i]),
            "lengthFt": int(row["length_ft"]),
            "widthFt": int(row["width_ft"]),
            "elevationFt": round(float(r["end"][i][2].replace("ft", ""))),
        }
        if rw["id"] == "18R":
            rw["ils"] = {"glideslopeDeg": 3, "rangeNm": 25, "tchFt": 50}  # hand-set: standard ILS values
        runways.append(rw)

by_id = {r["id"]: r for r in runways}
for rid, opp in (("18R", "36L"), ("24", "06")):
    by_id[rid]["exits"], entry = exits(by_id[rid], by_id[opp])
    if entry: by_id[rid]["entry"] = entry

out = {
    "icao": "EHAM",
    "name": "Amsterdam Schiphol",
    "lat": dms(osc["position"][0]),
    "lon": dms(osc["position"][1]),
    "elevationFt": -11,
    "transitionAltitudeFt": 3000,
    # hand-set, simplified table (spec §5): lowest QNH first
    "transitionLevels": [{"minQnh": 0, "fl": 50}, {"minQnh": 977, "fl": 45}, {"minQnh": 1013, "fl": 40}],
    "qnh": 1013,
    "wind": {"dir": 200, "speed": 12},
    "atis": "B",
    "frequencies": {
        "approach": {"name": "Schiphol Approach", "mhz": "119.055"},
        "tower": {"name": "Schiphol Tower", "mhz": "118.280"},
        "radar": {"name": "Amsterdam Radar", "mhz": "125.750"},
    },
    "airspace": {"floorFt": 0, "ceilingFt": 10000, "poly": [pt(p) for p in osc["airspace"][0]["poly"]]},
    "config": {"landing": "18R", "departure": "24"},
    "missedApproachAltFt": 2000,
    "runways": runways,
    "fixes": {n: pt(osc["fixes"][n]) for n in FIXES},
    # Simplified STARs: last en-route fix -> IAF. `via` are possible spawn-side fixes.
    "stars": [
        {"id": "ARTIP", "iaf": "ARTIP", "via": ["OSKUR", "NOVEN"]},
        {"id": "RIVER", "iaf": "RIVER", "via": ["HSD", "STD"]},
        {"id": "SUGOL", "iaf": "SUGOL", "via": ["LUTEX", "ROBVI", "PEPEL"]},
    ],
    # hand-set inbound tracks, approximating the published holds; v1 flies all holds right-hand.
    "holds": {"ARTIP": {"inbound": 253}, "RIVER": {"inbound": 46}, "SUGOL": {"inbound": 112}},
    # Departure exits usable from runway 24 without crossing the 18R final.
    "departures": {"initialClimbFt": 6000, "exits": ["LEKKO", "LOPIK", "ARNEM", "VALKO"]},
    # Control tower cabs for tower mode. Positions and heights from OpenStreetMap (aeroway=tower):
    # West 60 m, Centre 101 m. Eye heights (54 m, 92 m) are assumed, a little below the roof.
    "towers": [
        {"id": "west", "name": "Tower West", "lat": 52.3317, "lon": 4.71787, "eyeHeightFt": 177, "runways": ["18R"], "viewBearing": 352},
        {"id": "centre", "name": "Centre", "lat": 52.30752, "lon": 4.76244, "eyeHeightFt": 302, "runways": ["24"], "viewBearing": 145},
    ],
    "airlines": [
        {"icao": "KLM", "telephony": "KLM", "weight": 34, "types": ["B738", "B738", "E190", "E195", "A332", "B772", "B77W", "B789"]},
        {"icao": "TRA", "telephony": "Transavia", "weight": 12, "types": ["B738"]},
        {"icao": "EZY", "telephony": "Easy", "weight": 12, "types": ["A320", "A20N"]},
        {"icao": "TFL", "telephony": "Orange", "weight": 7, "types": ["B738", "B38M", "B789"]},
        {"icao": "BAW", "telephony": "Speedbird", "weight": 6, "types": ["A320", "A321"]},
        {"icao": "DLH", "telephony": "Lufthansa", "weight": 6, "types": ["A320", "A20N", "A321"]},
        {"icao": "RYR", "telephony": "Ryanair", "weight": 5, "types": ["B738", "B38M"]},
        {"icao": "AFR", "telephony": "Air France", "weight": 5, "types": ["A320", "E190"]},
        {"icao": "DAL", "telephony": "Delta", "weight": 5, "types": ["A332", "A333"]},
        {"icao": "UAE", "telephony": "Emirates", "weight": 3, "types": ["A388", "B77W"]},
        {"icao": "JFA", "telephony": "Mosquito", "weight": 3, "types": ["PC12"]},
    ],
}
json.dump(out, open("data/airports/EHAM.json", "w"), indent=1)
print(len(out["fixes"]), "fixes;", len(runways), "runway ends")
for r in runways:
    print(r["id"], r["heading"])
