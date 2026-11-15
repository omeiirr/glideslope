#!/usr/bin/env python3
"""One-off generator for data/airports/EHAM.json.

Usage: python3 scripts/build-eham.py <openscope eham.json> <ourairports runways.csv>
Sources are recorded in DECISIONS.md. Hand-set values are marked below.
"""
import csv, json, math, re, sys

osc = json.load(open(sys.argv[1]))
rows = [r for r in csv.DictReader(open(sys.argv[2])) if r["airport_ident"] == "EHAM"]


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


FIXES = """ARTIP RIVER SUGOL NIRSI NARIX EH601 EH602 EH603 EH605 EH606 EH607 EH608 EH621 SPL PAM SPY
OSKUR NOVEN HSD STD LUTEX ROBVI PEPEL LEKKO LOPIK ARNEM VALKO""".split()

runways = []
for r in osc["runways"]:
    ends = [pt(e) for e in r["end"]]  # openScope: landing thresholds (displaced where applicable)
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
