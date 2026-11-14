#!/usr/bin/env python3
"""Generates the parser corpus in tests/phrases/*.jsonl.

Expected results are derived here from the templates, independently of the parser.
Hand-written cases live in tests/phrases/manual.jsonl and are not touched.
Run: python3 scripts/gen-corpus.py
"""
import json, random

random.seed(20261115)
QNH, TA = 1013, 3000

# Mirrors tests/phrases/context.json
AC = {
    "KLM1234": dict(alt=7000, hdg=90, ias=250, qnh=False, tel="KLM"),
    "KLM1243": dict(alt=5000, hdg=180, ias=220, qnh=True, tel="KLM"),
    "BAW432": dict(alt=5000, hdg=180, ias=220, qnh=True, tel="Speedbird"),
    "EZY45MP": dict(alt=4000, hdg=270, ias=220, qnh=False, tel="Easy"),
    "DLH9LK": dict(alt=10000, hdg=250, ias=250, qnh=False, tel="Lufthansa"),
    "TRA6015": dict(alt=2500, hdg=238, ias=200, qnh=False, tel="Transavia"),
    "AFR1845": dict(alt=3000, hdg=360, ias=180, qnh=True, tel="Air France"),
    "RYR7HB": dict(alt=8000, hdg=120, ias=250, qnh=False, tel="Ryanair"),
    "UAE148": dict(alt=6000, hdg=200, ias=230, qnh=False, tel="Emirates"),
    "DAL72": dict(alt=9000, hdg=300, ias=250, qnh=False, tel="Delta"),
    "KLM87C": dict(alt=6000, hdg=45, ias=220, qnh=True, tel="KLM"),
    "TFL356": dict(alt=7000, hdg=30, ias=240, qnh=False, tel="Orange"),
}
D = "zero one two three four five six seven eight niner".split()
PH = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "alfa bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu".split()))


def sp(s, nine="niner"):
    return " ".join((D[int(c)] if c != "9" else nine) if c.isdigit() else ("decimal" if c == "." else PH[c.upper()]) for c in str(s))


def cs_forms(cs):
    tel, num = AC[cs]["tel"], cs[3:]
    return {
        "typed": cs,
        "spaced": f"{cs[:3]} {num}",
        "spoken": f"{tel} {sp(num)}",
        "nine": f"{tel} {sp(num, 'nine')}",
        "spelled": f"{sp(cs[:3])} {sp(num)}",
        "mixed": f"{tel} {num}",
    }


def thousands(ft):
    th, h = divmod(ft, 1000)
    return " ".join(x for x in [f"{sp(th)} thousand" if th else "", f"{sp(h // 100)} hundred" if h else ""] if x)


def fl_sp(fl):
    return "one hundred" if fl == 100 else sp(str(fl))


# ---- command builders: (cmd, issues) given aircraft state ----
def heading(h, turn=None):
    c = {"type": "heading", "heading": h}
    if turn:
        c["turn"] = turn
    return c


def alt_cmd(ft, qnh=None):
    c = {"type": "altitude", "altitude": ft, "fl": ft > TA}
    if qnh and ft <= TA:
        c["qnh"] = qnh
    return c


def alt_issues(ac, ft, verb, qnh):
    out = []
    if ft <= TA:
        if qnh is None and not ac["qnh"]:
            out.append("qnh-missing")
        if qnh is not None and qnh != QNH:
            out.append("qnh-wrong")
    if (verb == "descend" and ft > ac["alt"] + 100) or (verb == "climb" and ft < ac["alt"] - 100):
        out.append("altitude-verb")
    return out


def verb_for(ac, ft):
    return "climb" if ft > ac["alt"] else "descend"


def spd_verb(ac, s):
    return "reduce" if s < ac["ias"] else "increase"


HDGS = [10, 30, 45, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 5, 185, 275]
FLS = [40, 50, 60, 70, 80, 90, 100]
ALTS = [2000, 3000, 2500, 1500]
SPDS = [160, 180, 200, 210, 220, 250]
FIXES = ["ARTIP", "RIVER", "SUGOL", "SPL", "NIRSI", "PAM", "EH608", "NARIX"]
out = {k: [] for k in ["icao", "loose", "asr", "multi", "callsign"]}
ARR = [c for c in AC if c != "TRA6015"]


def add(bucket, text, cs, cmds, issues, **extra):
    out[bucket].append(dict(input=text, expectedCallsign=cs, expectedCommands=cmds, expectedIssues=sorted(issues), **extra))


def pick_cs(i, pool=ARR):
    return pool[i % len(pool)]


def form(cs, i, kinds=("spoken", "typed", "spaced", "mixed", "spoken", "spelled")):
    return cs_forms(cs)[kinds[i % len(kinds)]]


# ============ ICAO-correct single commands ============
i = 0
for h in HDGS:
    for turn in ("left", "right"):
        cs = pick_cs(i)
        add("icao", f"{form(cs, i)}, turn {turn} heading {sp(f'{h:03d}')}", cs, [heading(h, turn)], [])
        i += 1
for h in HDGS[:8]:
    cs = pick_cs(i)
    add("icao", f"{form(cs, i)} turn left heading {h:03d}", cs, [heading(h, "left")], [])
    add("icao", f"{form(cs, i + 1)}, fly heading {sp(f'{h:03d}')}", cs, [heading(h)], ["heading-direction"])
    i += 1
for cs in ARR[:6]:
    add("icao", f"{form(cs, i)}, continue present heading", cs, [{"type": "presentHeading"}], [])
    i += 1
for fl in FLS:
    for cs in (pick_cs(i), pick_cs(i + 3)):
        ac = AC[cs]
        if abs(fl * 100 - ac["alt"]) < 200:
            continue
        v = verb_for(ac, fl * 100)
        add("icao", f"{form(cs, i)}, {v} flight level {fl_sp(fl)}", cs, [alt_cmd(fl * 100)], [])
        add("icao", f"{form(cs, i + 1)} {v} FL{fl:03d}", cs, [alt_cmd(fl * 100)], [])
        i += 1
for ft in ALTS:
    for cs in (pick_cs(i), pick_cs(i + 5), pick_cs(i + 7)):
        ac = AC[cs]
        if abs(ft - ac["alt"]) < 200:
            continue
        v = verb_for(ac, ft)
        add("icao", f"{form(cs, i)}, {v} altitude {thousands(ft)}, QNH {sp(QNH, 'nine')}", cs, [alt_cmd(ft, QNH)], [])
        add("icao", f"{form(cs, i + 1)} {v} altitude {ft} QNH {QNH}", cs, [alt_cmd(ft, QNH)], [])
        if ac["qnh"]:
            add("icao", f"{form(cs, i)}, {v} altitude {thousands(ft)}", cs, [alt_cmd(ft)], [])
        i += 1
for s in SPDS:
    for cs in (pick_cs(i), pick_cs(i + 4)):
        ac = AC[cs]
        if abs(s - ac["ias"]) < 10:
            continue
        add("icao", f"{form(cs, i)}, {spd_verb(ac, s)} speed {sp(s)} knots", cs, [{"type": "speed", "speed": s}], [])
        add("icao", f"{form(cs, i + 1)} {spd_verb(ac, s)} speed {s} knots", cs, [{"type": "speed", "speed": s}], [])
        i += 1
for s, d in [(180, 4), (160, 4), (170, 5), (180, 6)]:
    cs = pick_cs(i)
    add("icao", f"{form(cs, i)}, maintain {sp(s)} knots until {sp(d)} miles final", cs, [{"type": "speed", "speed": s, "untilDme": d}], [])
    add("icao", f"{form(cs, i + 1)} maintain {s} knots until {d} miles final", cs, [{"type": "speed", "speed": s, "untilDme": d}], [])
    i += 1
for cs in ARR[:5]:
    add("icao", f"{form(cs, i)}, resume normal speed", cs, [{"type": "resumeSpeed"}], [])
    i += 1
for fx in FIXES:
    cs = pick_cs(i)
    add("icao", f"{form(cs, i)}, proceed direct {fx}", cs, [{"type": "direct", "fix": fx}], [])
    i += 1
for cs in ARR[:8]:
    add("icao", f"{form(cs, i)}, cleared ILS approach runway one eight right", cs, [{"type": "ils", "runway": "18R"}], [])
    add("icao", f"{form(cs, i + 1)} cleared ILS approach runway 18R", cs, [{"type": "ils", "runway": "18R"}], [])
    i += 1
for fx in ["ARTIP", "RIVER", "SUGOL"]:
    for cs in (pick_cs(i), pick_cs(i + 2)):
        add("icao", f"{form(cs, i)}, hold at {fx} as published", cs, [{"type": "hold", "fix": fx}], [])
        i += 1
for cs in ARR[:6]:
    add("icao", f"{form(cs, i)}, contact Schiphol Tower 118.280", cs, [{"type": "handoff", "to": "tower"}], [])
    add("icao", f"{form(cs, i + 1)}, contact Schiphol Tower one one eight decimal two eight zero", cs, [{"type": "handoff", "to": "tower"}], [])
    i += 1
add("icao", "Transavia six zero one five, contact Amsterdam Radar 125.750", "TRA6015", [{"type": "handoff", "to": "radar"}], [])
add("icao", "TRA6015 contact Amsterdam Radar one two five decimal seven five zero", "TRA6015", [{"type": "handoff", "to": "radar"}], [])
for cs in ARR[:5]:
    add("icao", f"{form(cs, i)}, go around", cs, [{"type": "goAround"}], [])
    add("icao", f"{form(cs, i + 1)}, Schiphol Approach, identified", cs, [{"type": "identify"}], [])
    add("icao", f"{form(cs, i + 2)}, say again", cs, [{"type": "sayAgain"}], [])
    i += 1

# ============ loose phrasing ============
for h in HDGS[:10]:
    cs = pick_cs(i)
    d3 = f"{h:03d}"
    add("loose", f"{form(cs, i)} heading {d3}", cs, [heading(h)], ["heading-direction"])
    add("loose", f"{form(cs, i + 1)} turn right {d3}", cs, [heading(h, "right")], ["heading-keyword"])
    add("loose", f"{form(cs, i + 2)} left heading {sp(d3)}", cs, [heading(h, "left")], [])
    if h >= 100:
        add("loose", f"{form(cs, i)} turn left heading to {d3}", cs, [heading(h, "left")], ["to-before-number"])
        add("loose", f"{form(cs, i)} fly heading {d3} degrees", cs, [heading(h)], ["heading-direction"])
    else:
        add("loose", f"{form(cs, i)} turn left heading {h}", cs, [heading(h, "left")], ["heading-3-digits"])
    i += 1
for cs in ARR[:4]:
    add("loose", f"{form(cs, i)} maintain present heading", cs, [{"type": "presentHeading"}], [])
    add("loose", f"{form(cs, i + 1)} present heading", cs, [{"type": "presentHeading"}], [])
    i += 1
for ft in [2000, 3000, 4000, 5000, 6000, 7000]:
    for cs in (pick_cs(i), pick_cs(i + 3), pick_cs(i + 6)):
        ac = AC[cs]
        if abs(ft - ac["alt"]) < 200:
            continue
        v = verb_for(ac, ft)
        base = alt_issues(ac, ft, v, None)
        add("loose", f"{form(cs, i)} {v} {ft}", cs, [alt_cmd(ft)], base + ["altitude-keyword"])
        add("loose", f"{form(cs, i + 1)} {v} to {thousands(ft)}", cs, [alt_cmd(ft)], base + ["altitude-keyword", "to-before-number"])
        add("loose", f"{form(cs, i + 2)} {v} and maintain {ft}", cs, [alt_cmd(ft)], base + ["altitude-keyword", "faa-and-maintain"])
        if v == "descend":
            add("loose", f"{form(cs, i)} go down to {ft}", cs, [alt_cmd(ft)], base + ["altitude-keyword", "to-before-number", "altitude-wording"])
        if ft > TA:
            add("loose", f"{form(cs, i)} {v} altitude {ft}", cs, [alt_cmd(ft)], base + ["altitude-above-ta"])
            add("loose", f"{form(cs, i)} {v} to flight level {ft // 100}", cs, [alt_cmd(ft)], base + ["to-before-number"])
            add("loose", f"{form(cs, i)} {v} level {ft // 100}", cs, [alt_cmd(ft)], base)
        else:
            add("loose", f"{form(cs, i)} {v} flight level {ft // 100}", cs, [alt_cmd(ft)], base + ["fl-below-tl"])
            add("loose", f"{form(cs, i)} {v} altitude {ft} feet", cs, [alt_cmd(ft)], base)
            add("loose", f"{form(cs, i)} {v} altitude {ft} QNH 1015", cs, [alt_cmd(ft, 1015)], alt_issues(ac, ft, v, 1015))
        i += 1
add("loose", "KLM1234 climb altitude 3000 QNH 1013", "KLM1234", [alt_cmd(3000, 1013)], ["altitude-verb"])
add("loose", "BAW432 descend flight level 80", "BAW432", [alt_cmd(8000)], ["altitude-verb"])
add("loose", "KLM1234 descend 3", "KLM1234", [alt_cmd(3000)], ["altitude-keyword", "qnh-missing"])
add("loose", "KLM1234 descend 70", "KLM1234", [alt_cmd(7000)], ["altitude-keyword"])
add("loose", "DLH9LK flight level 80", "DLH9LK", [alt_cmd(8000)], ["altitude-wording"])
for s in SPDS:
    for cs in (pick_cs(i), pick_cs(i + 5)):
        ac = AC[cs]
        if abs(s - ac["ias"]) < 10:
            continue
        v = spd_verb(ac, s)
        wrong = "increase" if v == "reduce" else "reduce"
        add("loose", f"{form(cs, i)} speed {s}", cs, [{"type": "speed", "speed": s}], ["speed-knots", "speed-wording"])
        add("loose", f"{form(cs, i + 1)} {v} speed {s}", cs, [{"type": "speed", "speed": s}], ["speed-knots"])
        add("loose", f"{form(cs, i + 2)} {v} speed to {s} knots", cs, [{"type": "speed", "speed": s}], ["to-before-number"])
        add("loose", f"{form(cs, i)} {wrong} speed {s} knots", cs, [{"type": "speed", "speed": s}], ["speed-verb"])
        add("loose", f"{form(cs, i)} speed {sp(s)} knots", cs, [{"type": "speed", "speed": s}], ["speed-wording"])
        if v == "reduce":
            add("loose", f"{form(cs, i)} slow down to {s} knots", cs, [{"type": "speed", "speed": s}], ["to-before-number", "speed-wording"])
            add("loose", f"{form(cs, i)} reduce {s} knots", cs, [{"type": "speed", "speed": s}], ["speed-wording"])
        i += 1
add("loose", "KLM1234 maintain 180", "KLM1234", [{"type": "speed", "speed": 180}], ["speed-knots"])
add("loose", "KLM1234 speed 180 knots until 4 miles", "KLM1234", [{"type": "speed", "speed": 180, "untilDme": 4}], ["speed-wording"])
add("loose", "KLM1234 maintain 160 knots till 4 DME", "KLM1234", [{"type": "speed", "speed": 160, "untilDme": 4}], [])
for cs in ARR[:3]:
    add("loose", f"{form(cs, i)} no speed restrictions", cs, [{"type": "resumeSpeed"}], ["speed-resume-wording"])
    add("loose", f"{form(cs, i + 1)} normal speed", cs, [{"type": "resumeSpeed"}], [])
    i += 1
for fx in FIXES[:6]:
    cs = pick_cs(i)
    add("loose", f"{form(cs, i)} direct {fx}", cs, [{"type": "direct", "fix": fx}], ["direct-wording"])
    add("loose", f"{form(cs, i + 1)} proceed direct to {fx}", cs, [{"type": "direct", "fix": fx}], ["direct-wording"])
    add("loose", f"{form(cs, i + 2)} fly direct {fx.lower()}", cs, [{"type": "direct", "fix": fx}], ["direct-wording"])
    i += 1
for cs in ARR[:5]:
    r = {"type": "ils", "runway": "18R"}
    add("loose", f"{form(cs, i)} cleared ILS 18R", cs, [r], ["ils-wording"])
    add("loose", f"{form(cs, i + 1)} cleared for the ILS runway 18 right", cs, [r], ["ils-wording"])
    add("loose", f"{form(cs, i + 2)} cleared approach", cs, [r], ["ils-runway-missing", "ils-wording"])
    add("loose", f"{form(cs, i)} cleared ILS approach", cs, [r], ["ils-runway-missing"])
    add("loose", f"{form(cs, i)} cleared for approach runway one eight right", cs, [r], ["ils-wording"])
    i += 1
for fx in ["ARTIP", "RIVER", "SUGOL"]:
    cs = pick_cs(i)
    add("loose", f"{form(cs, i)} hold at {fx}", cs, [{"type": "hold", "fix": fx}], ["hold-wording"])
    add("loose", f"{form(cs, i + 1)} hold {fx}", cs, [{"type": "hold", "fix": fx}], ["hold-wording"])
    add("loose", f"{form(cs, i + 2)} enter the hold at {fx} as published", cs, [{"type": "hold", "fix": fx}], [])
    i += 1
for cs in ARR[:4]:
    t = {"type": "handoff", "to": "tower"}
    add("loose", f"{form(cs, i)} contact tower", cs, [t], ["handoff-frequency-missing"])
    add("loose", f"{form(cs, i + 1)} contact tower 118.28", cs, [t], [])
    add("loose", f"{form(cs, i + 2)} contact tower 118.1", cs, [t], ["handoff-frequency-wrong"])
    add("loose", f"{form(cs, i)} switch to tower one one eight point two eight", cs, [t], [])
    add("loose", f"{form(cs, i)} radar contact", cs, [{"type": "identify"}], [])
    add("loose", f"{form(cs, i)} good morning, identified", cs, [{"type": "identify"}], [])
    add("loose", f"{form(cs, i)} going around", cs, [{"type": "goAround"}], [])
    add("loose", f"{form(cs, i)} repeat", cs, [{"type": "sayAgain"}], [])
    i += 1

# ============ ASR-style mistakes ============
asr = [
    ("KLM one two three four turn left hitting two seven zero", "KLM1234", [heading(270, "left")], []),
    ("KLM one two three four turn left heading to seven zero", "KLM1234", [heading(270, "left")], []),
    ("KLM one too three four turn right heading one eight zero", "KLM1234", [heading(180, "right")], []),
    ("K L M one two three four turn right heading tree six zero", "KLM1234", [heading(360, "right")], []),
    ("KLM 1234 turn write heading 090", "KLM1234", [heading(90, "right")], []),
    ("KLM1234, turn left heading 2 7 0.", "KLM1234", [heading(270, "left")], []),
    ("KLM 1234, turn left heading 270 degrees.", "KLM1234", [heading(270, "left")], []),
    ("KLM-1234, Turn Left, Heading 270", "KLM1234", [heading(270, "left")], []),
    ("speed bird four three two turn left heading one fife zero", "BAW432", [heading(150, "left")], []),
    ("Speedbird 432 turn left heading 1 5 0", "BAW432", [heading(150, "left")], []),
    ("speedbird for three two turn right heading two one zero", "BAW432", [heading(210, "right")], []),
    ("Speed Bird 4 3 2, descend altitude 3,000, QNH 1013.", "BAW432", [alt_cmd(3000, 1013)], []),
    ("easy four five mike papa the send flight level seven zero", "EZY45MP", [alt_cmd(7000)], ["altitude-verb"]),
    ("easy for five mike papa descend altitude tree tousand q n h one zero one tree", "EZY45MP", [alt_cmd(3000, 1013)], []),
    ("Easy 45 Mike Papa descent altitude 2000 QNH 1013", "EZY45MP", [alt_cmd(2000, 1013)], []),
    ("Easy 45MP, descend attitude 3000, Q and H 1013", "EZY45MP", [alt_cmd(3000, 1013)], []),
    ("easy four five mike papa descend to thousand", "EZY45MP", [alt_cmd(2000)], ["altitude-keyword", "qnh-missing"]),
    ("easy four five mike papa descend altitude to thousand q n h one zero one three", "EZY45MP", [alt_cmd(2000, 1013)], []),
    ("easy four five mike papa descend to two thousand", "EZY45MP", [alt_cmd(2000)], ["altitude-keyword", "qnh-missing", "to-before-number"]),
    ("lufthansa niner lima kilo descend flight level seventy", "DLH9LK", [alt_cmd(7000)], []),
    ("Lufthansa nine Lima Kilo, descend flight level 7 0", "DLH9LK", [alt_cmd(7000)], []),
    ("Lufthansa 9LK descend flight level 070", "DLH9LK", [alt_cmd(7000)], []),
    ("lufthansa nine lima kilo descend flight level eight zero", "DLH9LK", [alt_cmd(8000)], []),
    ("Lufthansa 9 Lima Kilo, descending flight level 60", "DLH9LK", [alt_cmd(6000)], []),
    ("ryan air seven hotel bravo reduce speed two two zero nots", "RYR7HB", [{"type": "speed", "speed": 220}], []),
    ("Ryanair 7 Hotel Bravo reduce speed 220 knot", "RYR7HB", [{"type": "speed", "speed": 220}], []),
    ("Ryanair 7HB, reduce speed two twenty knots", "RYR7HB", [{"type": "speed", "speed": 220}], []),
    ("Ryanair seven hotel bravo reduce speed 2 20 knots", "RYR7HB", [{"type": "speed", "speed": 220}], []),
    ("ryanair seven hotel bravo maintain one eight zero knots until for miles final", "RYR7HB", [{"type": "speed", "speed": 180, "untilDme": 4}], []),
    ("emirates one four eight proceed direct art tip", "UAE148", [{"type": "direct", "fix": "ARTIP"}], []),
    ("Emirates 148 proceed direct our tip", "UAE148", [{"type": "direct", "fix": "ARTIP"}], []),
    ("Emirates 148, proceed direct Sugar.", "UAE148", [{"type": "direct", "fix": "SUGOL"}], []),
    ("emirates one four eight proceed direct alfa romeo tango india papa", "UAE148", [{"type": "direct", "fix": "ARTIP"}], []),
    ("Emirates 148 proceed direct echo hotel six zero eight", "UAE148", [{"type": "direct", "fix": "EH608"}], []),
    ("Emirates 148 proceed direct rivers", "UAE148", [{"type": "direct", "fix": "RIVER"}], []),
    ("delta seven two cleared i l s approach runway one eight right", "DAL72", [{"type": "ils", "runway": "18R"}], []),
    ("Delta 72, cleared ILS approach, runway 18 right.", "DAL72", [{"type": "ils", "runway": "18R"}], []),
    ("Delta 72 cleared ILS approach run way 18R", "DAL72", [{"type": "ils", "runway": "18R"}], []),
    ("Delta seventy two, clear ILS approach runway one eight right", "DAL72", [{"type": "ils", "runway": "18R"}], []),
    ("delta seven too cleared ils approach runway eighteen right", "DAL72", [{"type": "ils", "runway": "18R"}], []),
    ("air france one eight four five contact tower one one eight point two eight zero", "AFR1845", [{"type": "handoff", "to": "tower"}], []),
    ("Air France 1845, contact Schiphol Tower, 118.280.", "AFR1845", [{"type": "handoff", "to": "tower"}], []),
    ("Air France 1845 contact tower 118 decimal 28", "AFR1845", [{"type": "handoff", "to": "tower"}], []),
    ("airfrance 1845 contact towers 118.280", "AFR1845", [{"type": "handoff", "to": "tower"}], []),
    ("Air France eighteen forty five, go round", "AFR1845", [{"type": "goAround"}], []),
    ("orange three five six hold at river as published", "TFL356", [{"type": "hold", "fix": "RIVER"}], []),
    ("Orange 356, uh, turn left, um, heading 240 please", "TFL356", [heading(240, "left")], []),
    ("orange tree fife six say it again", "TFL356", [{"type": "sayAgain"}], []),
    ("KLM eight seven Charlie climb flight level one hundred", "KLM87C", [alt_cmd(10000)], []),
    ("KLM 87 Charlie, climb flight level 100.", "KLM87C", [alt_cmd(10000)], []),
    ("kilo lima mike eight seven charlie climb flight level niner zero", "KLM87C", [alt_cmd(9000)], []),
    ("KLM 87C turn left heading zero niner zero", "KLM87C", [heading(90, "left")], []),
    ("transavia six zero one five climb flight level one hundred", "TRA6015", [alt_cmd(10000)], []),
    ("Trans Avia 6015, climb flight level 100", "TRA6015", [alt_cmd(10000)], []),
    ("Transavia sixty fifteen contact radar 125.750", "TRA6015", [{"type": "handoff", "to": "radar"}], []),
    ("KLM twelve thirty four descend flight level six zero", "KLM1234", [alt_cmd(6000)], []),
    ("klm one two three four descend flight level sixty", "KLM1234", [alt_cmd(6000)], []),
    ("KLM1234 descend FL60", "KLM1234", [alt_cmd(6000)], []),
    ("KLM1234 DESCEND FLIGHT LEVEL 60", "KLM1234", [alt_cmd(6000)], []),
    ("klm 1234 descend flight level six zero thank you", "KLM1234", [alt_cmd(6000)], []),
]
for a in asr:
    add("asr", *a)

# ============ several instructions in one transmission ============
multi = [
    ("KLM1234, turn left heading 210, descend altitude 2000, QNH 1013, reduce speed 180 knots", "KLM1234",
     [heading(210, "left"), alt_cmd(2000, 1013), {"type": "speed", "speed": 180}], []),
    ("KLM one two three four, turn right heading one five zero, cleared ILS approach runway one eight right", "KLM1234",
     [heading(150, "right"), {"type": "ils", "runway": "18R"}], []),
    ("Speedbird four three two, descend altitude two thousand, cleared ILS approach runway one eight right", "BAW432",
     [alt_cmd(2000), {"type": "ils", "runway": "18R"}], []),
    ("Speedbird 432 turn left heading 150 descend altitude 2000 cleared ILS approach runway 18R maintain 180 knots until 4 miles final", "BAW432",
     [heading(150, "left"), alt_cmd(2000), {"type": "ils", "runway": "18R"}, {"type": "speed", "speed": 180, "untilDme": 4}], []),
    ("Easy four five mike papa, identified, descend flight level six zero", "EZY45MP", [{"type": "identify"}, alt_cmd(6000)], ["altitude-verb"]),
    ("Lufthansa niner lima kilo, Schiphol Approach, identified, descend flight level seven zero, expect ILS approach runway one eight right", "DLH9LK",
     [{"type": "identify"}, alt_cmd(7000)], []),
    ("Lufthansa 9LK identified, expect vectors for ILS runway 18R", "DLH9LK", [{"type": "identify"}], []),
    ("Ryanair seven hotel bravo, proceed direct ARTIP, descend flight level seven zero", "RYR7HB",
     [{"type": "direct", "fix": "ARTIP"}, alt_cmd(7000)], []),
    ("Ryanair 7HB reduce speed 220 knots, descend flight level 60", "RYR7HB", [{"type": "speed", "speed": 220}, alt_cmd(6000)], []),
    ("Emirates one four eight, turn left heading zero niner zero, reduce speed two one zero knots", "UAE148",
     [heading(90, "left"), {"type": "speed", "speed": 210}], []),
    ("Emirates 148 heading 090 speed 210", "UAE148", [heading(90), {"type": "speed", "speed": 210}], ["heading-direction", "speed-knots", "speed-wording"]),
    ("Delta seven two, descend flight level eight zero, reduce speed two two zero knots, turn right heading three six zero", "DAL72",
     [alt_cmd(8000), {"type": "speed", "speed": 220}, heading(360, "right")], []),
    ("Air France 1845, cleared ILS approach runway 18R, contact Schiphol Tower 118.280", "AFR1845",
     [{"type": "ils", "runway": "18R"}, {"type": "handoff", "to": "tower"}], []),
    ("Air France one eight four five reduce speed one six zero knots, contact tower one one eight decimal two eight zero", "AFR1845",
     [{"type": "speed", "speed": 160}, {"type": "handoff", "to": "tower"}], []),
    ("Orange 356 hold at SUGOL as published, descend flight level 60", "TFL356", [{"type": "hold", "fix": "SUGOL"}, alt_cmd(6000)], []),
    ("KLM 87 Charlie turn left heading 270 and descend altitude 3000", "KLM87C", [heading(270, "left"), alt_cmd(3000)], []),
    ("KLM87C left 270 then down to 3000 and slow to 200", "KLM87C",
     [heading(270, "left"), alt_cmd(3000), {"type": "speed", "speed": 200}], None),
    ("KLM1234 turn left heading 270, correction, turn left heading 260", "KLM1234", [heading(260, "left")], []),
    ("KLM1234 negative, descend flight level 60", "KLM1234", [alt_cmd(6000)], []),
    ("KLM1243, turn right heading 240, descend altitude 2000, cleared ILS approach runway 18R", "KLM1243",
     [heading(240, "right"), alt_cmd(2000), {"type": "ils", "runway": "18R"}], []),
    ("Transavia 6015 climb flight level 100, proceed direct LOPIK", "TRA6015", [alt_cmd(10000), {"type": "direct", "fix": "LOPIK"}], []),
    ("TRA6015 turn left heading 180 climb flight level 80", "TRA6015", [heading(180, "left"), alt_cmd(8000)], []),
    ("KLM1234 resume normal speed, proceed direct SPL", "KLM1234", [{"type": "resumeSpeed"}, {"type": "direct", "fix": "SPL"}], []),
    ("Speedbird 432 go around, turn right heading 270", "BAW432", [{"type": "goAround"}, heading(270, "right")], []),
]
for text, cs, cmds, issues in multi:
    add("multi", text, cs, cmds, issues if issues is not None else [], **({"anyIssues": True} if issues is None else {}))

# ============ callsign handling ============
U = ["callsign-unknown"]
callsign = [
    ("KLM9999 turn left heading 270", None, [], U),
    ("Speedbird one one one descend flight level 70", None, [], U),
    ("turn left heading 270", None, [], U),
    ("descend flight level 70", None, [], U),
    ("hello", None, [], U),
    ("", None, [], U),
    ("Lufthansa turn left heading 270", None, [], U),
    ("one two three four turn left heading 270", None, [], U),
    ("Qantas 12 turn right heading 090", None, [], U),
    ("KLM one two four turn left heading 270", None, [], ["callsign-ambiguous"]),
    ("KLM 12 turn left heading 270", None, [], U),
    ("KLM 1244 descend flight level 60", None, [], ["callsign-ambiguous"]),
    ("KLM1234 turn left heading 270", "KLM1234", [heading(270, "left")], []),
    ("KLM1243 turn left heading 270", "KLM1243", [heading(270, "left")], []),
    ("KLM one two four three turn left heading two seven zero", "KLM1243", [heading(270, "left")], []),
    ("kilo lima mike one two three four turn left heading two seven zero", "KLM1234", [heading(270, "left")], []),
    ("bravo alfa whiskey four three two turn left heading two seven zero", "BAW432", [heading(270, "left")], []),
    ("BAW432 turn left heading 270", "BAW432", [heading(270, "left")], []),
    ("echo zulu yankee four five mike papa turn right heading zero three zero", "EZY45MP", [heading(30, "right")], []),
    ("EZY45MP turn right heading 030", "EZY45MP", [heading(30, "right")], []),
    ("Easy 45MP turn right heading 030", "EZY45MP", [heading(30, "right")], []),
    ("DLH9LK turn right heading 030", "DLH9LK", [heading(30, "right")], []),
    ("delta lima hotel niner lima kilo turn right heading zero three zero", "DLH9LK", [heading(30, "right")], []),
    ("Delta 72 turn right heading 030", "DAL72", [heading(30, "right")], []),
    ("delta alfa lima seven two turn right heading zero three zero", "DAL72", [heading(30, "right")], []),
    ("Ryanair 7HB turn right heading 030", "RYR7HB", [heading(30, "right")], []),
    ("Emirates 148 turn right heading 030", "UAE148", [heading(30, "right")], []),
    ("Emirate 148 turn right heading 030", "UAE148", [heading(30, "right")], []),
    ("Orange 356 turn right heading 060", "TFL356", [heading(60, "right")], []),
    ("Transavia 6015 turn right heading 260", "TRA6015", [heading(260, "right")], []),
    ("Transavia 6016 turn right heading 260", "TRA6015", [heading(260, "right")], []),
    ("Air France 1845 turn right heading 030", "AFR1845", [heading(30, "right")], []),
    ("Air Franz 1845 turn right heading 030", "AFR1845", [heading(30, "right")], []),
    ("KLM 87 Charlie turn right heading 090", "KLM87C", [heading(90, "right")], []),
    ("KLM87C turn right heading 090", "KLM87C", [heading(90, "right")], []),
    ("KLM1234 blah blah", "KLM1234", [], ["not-understood"]),
    ("KLM1234", "KLM1234", [], ["not-understood"]),
    ("KLM1234 turn left", "KLM1234", [], ["not-understood"]),
    ("KLM1234 turn left heading 400", "KLM1234", [], ["not-understood"]),
    ("KLM1234 wind 200 degrees 12 knots", "KLM1234", [], None),
    ("turn left heading 270", "KLM1234", [heading(270, "left")], [], "KLM1234"),
    ("descend flight level 60", "DLH9LK", [alt_cmd(6000)], [], "DLH9LK"),
    ("BAW432 turn left heading 270", "BAW432", [heading(270, "left")], [], "KLM1234"),
    ("l 270", None, [], U),
]
for row in callsign:
    text, cs, cmds, issues = row[:4]
    extra = {}
    if len(row) > 4:
        extra["defaultCallsign"] = row[4]
    if issues is None:
        extra["anyIssues"] = True
    add("callsign", text, cs, cmds, issues or [], **extra)

total = 0
for name, rows in out.items():
    with open(f"tests/phrases/{name}.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    total += len(rows)
    print(name, len(rows))
json.dump(
    {"qnh": QNH, "aircraft": [dict(callsign=k, alt=v["alt"], hdg=v["hdg"], ias=v["ias"], qnhGiven=v["qnh"]) for k, v in AC.items()]},
    open("tests/phrases/context.json", "w"), indent=1,
)
print("total", total)
