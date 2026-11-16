# Tower mode (3D) — design

Status: **T1–T3 built** (3D view of existing traffic; runway sim: rollout and exits, holding point, line-up and take-off roll, runway occupancy; tower commands and phraseology with a stand-in Approach). T4–T6 not started. Deferred from T3: "stop" on its own, traffic information, conditional clearances, the "take-off" word rule. Scope **B** (tower controller, no ground control). Scope C (ground and taxi) may come later; nothing here should block it.

Boards: `TowerWest.dc.html`, `TowerCentreDusk.dc.html`, `TowerBinoculars.dc.html`, `TowerRealistic.dc.html` (on the project's design canvas, copied here). `Tower3D.dc.html` on the canvas is the earlier hand-drawn concept that set the low-poly direction.
The out-the-window pictures come from `tower3d-sketch/` (a throwaway three.js scene, see its README). They are renders, not drawings: the game renderer would draw the same thing.

## 1. The role

The player is **Schiphol Tower**. An AI Approach controller vectors arrivals onto the ILS and hands them over at about 6 NM. The player:

- clears arrivals to land on 18R, and sends them to Ground once they vacate;
- takes departures from the holding point of runway 24, lines them up, clears them for take-off, and hands them to Departure once airborne;
- keeps the runways safe: one aircraft at a time on a runway, wake spacing between departures, and go-arounds when a landing can't be made safely.

Approach mode stays as it is. Tower mode is a separate mode from the menu, with its own scenarios.

### Two cabs, as at the real Schiphol

The Polderbaan (18R) is too far from the central tower to see (6.8 km), so Schiphol runs it from **Tower West** next to it. Runway 24 is watched from the **central tower** (1.1 km away). The game has both cabs, and the player switches between them with `1` / `2`.

| Cab | Position (OSM) | Height | Eye height (assumed) | Default view |
|---|---|---|---|---|
| Tower West | 52.3317 N, 4.7179 E | 60 m | 54 m | 352°, the 18R final and touchdown zone |
| Centre | 52.3075 N, 4.7624 E | 101 m | 92 m | 145°, along runway 24 |

In reality these are two controllers on different positions. In the game, one player works both: a simplification to record in DECISIONS.md.

## 2. What the player sees

Layout (the `TowerWest` board):

- **Top bar:** airport and frequency, cab switch, UTC, wind, QNH, visibility, score, pause, speed.
- **Window** (main area, about 2:1): the 3D view from the active cab, with thin window frames. Overlays:
  - Labels on aircraft, in the scope's colour language: green = cleared to land/take off; cyan = selected or just heard on the radio; dashed grey = not yet yours (still with Approach); amber = on the runway or a conflict.
  - Edge chips pointing at traffic in the other cab ("2 on 24 · Centre cab →").
  - View buttons: Binoculars (hold `B`), Look (`←` `→`), Labels (all / selected / off).
- **Desk** below the window: strip bays **Arrivals 18R**, **On runway**, **Departures 24**, plus a **ground radar** (top-down; shows the view cone, click to select). Strips are buttons: click to select, as in Approach mode.
- **Radio** column on the right (same component as Approach mode).
- **PTT bar** at the bottom (same component). It also shows safety warnings before the clearance is sent, e.g. "⚠ KLM1601 still on 24" when clearing a take-off with the runway occupied.

**Binoculars** (the `TowerBinoculars` board): hold `B` to zoom about ×12 on the selected aircraft and follow it. `Tab` cycles aircraft, the radio stays live. This is core UI, not an extra: from Tower West, an A330 on 2 NM final is only a few pixels wide.

**Realistic variant** (the `TowerRealistic` board): black DCB-style button bar; labels off by default (only a selection bracket); electronic strips (buff for arrivals, blue for departures); a large ground radar; terse preview-area text for feedback.

**Time of day and weather:** day, dusk, night; visibility 10 km down to about 1 km (fog). At dusk and night the runway, approach and apron lights are on (the `TowerCentreDusk` board).

## 3. Art direction

**Clean semi-realistic** (approved from the style test, `tower3d-sketch/style-test/`). The first low-poly renders on the earlier boards are superseded.

- **Airport surfaces are graphics**, built from OpenStreetMap (ODbL): runway areas, taxiways at their real width with yellow centrelines, aprons, runway holding positions and airside grass with a repeating detail texture. Runway markings (threshold, designator, touchdown zone, aiming point, centreline, edges) are drawn from the sim's own runway data, so they stay sharp at any distance and match where aircraft land. About 320 kB (96 kB compressed).
- **Around the airport: modelled from OSM, no photos.** Land use (fields each in their own shade, towns, industry, woods, greenhouses), water and motorways for about 10 km; beyond that water and motorways only, on a flat polder colour that fades into haze. Aprons are concrete with 5 m slabs; runways and taxiways asphalt with a faint grain. `public/tower/land.json`, about 5.5 MB (1.6 MB compressed), built by `scripts/build-tower-land.py`.
- **Buildings:** OSM outlines inside the aerodrome extruded to their tagged height (`height`, else `building:levels` × 3.5 m, else a default per kind; about 40 % are tagged). Terminals and offices get window bands, hangars and tanks plain walls. They cast sun shadows (shadow map over 6 × 6 km around the airport reference point). Buildings within 80 m of a cab are skipped, so a tower never walls off its own view.
- *Superseded:* aerial imagery (PDOK Luchtfoto) around the drawn surfaces. A photo next to clean vector lines read as two different worlds, and alone it smeared at the cab's grazing angles.
- **Sky:** gradient dome, soft billboard clouds, exponential haze, film-style tone mapping.
- **Aircraft are procedural and smooth-shaded:** lathe fuselage with a window line and airline colour blocks (no logos), swept wings, engines, gear when down, real length and span per type. No model files, so no licences.
- **Shadows:** a soft planform decal under each aircraft near the ground, not a shadow map (cheap, and it covers every aircraft).
- **Not modelled yet:** trees, lights and light masts, buildings outside the fence. Dusk and night lighting comes in step T5.

## 4. Commands and phraseology (ICAO Doc 4444 §12.3.4, CAP 413 ch. 4)

New commands, all through the existing command layer and parser:

| Command | Canonical phrase | Readback |
|---|---|---|
| Landing clearance | "KLM66P, runway 18R, wind 200 degrees 12 knots, cleared to land" | "Runway 18R, cleared to land, KLM66P" |
| Continue approach | "KLM66P, continue approach" (runway not yet free) | "Continue approach, KLM66P" |
| Go around | "KLM66P, go around" (+ "I say again, go around" if no reaction) | "Going around, KLM66P" |
| Vacate | "EZY81QK, vacate left via E5" | "Vacate left via E5, EZY81QK" |
| Contact Ground | "EZY81QK, contact Ground 121.800" | "Ground 121.800, EZY81QK" |
| Line up and wait | "TRA5422, runway 24, line up and wait" | "Runway 24, line up and wait, TRA5422" |
| Take-off clearance | "TRA5422, wind 200 degrees 12 knots, runway 24, cleared for take-off" | "Runway 24, cleared for take-off, TRA5422" |
| Cancel take-off | "TRA5422, hold position, cancel take-off, I say again, cancel take-off" | "Holding, TRA5422" |
| Stop | "TRA5422, stop immediately, I say again, stop immediately" | "Stopping, TRA5422" |
| Contact Departure | "KLM1601, contact Schiphol Departure 119.055" | "Departure 119.055, KLM1601" |
| Traffic info | "TRA5422, traffic A332 on 3 miles final" | (acknowledge) |

Pilots call in on their own: arrivals ("Schiphol Tower, KLM66P, ILS 18R") and departures at the holding point ("…holding point S1, ready for departure").

New feedback rules (same mechanism as the existing ones):
- the runway is missing from a landing or take-off clearance;
- "line up" without "and wait" (or "position and hold", the FAA form);
- "cleared for take-off" used for anything other than the take-off clearance itself (ICAO reserves "take-off" for that clearance; otherwise say "departure");
- the vacate instruction has no direction or exit;
- wind is missing from a landing or take-off clearance (info only).

**Data to verify against the eAIP before building:** the 18R exit names and positions, the 24 holding point names, the Ground and Departure frequencies (121.800 and 119.055 above are placeholders), and which frequency Tower West uses.

## 5. Sim changes (core)

| Change | Notes |
|---|---|
| **Landing rollout** | Touchdown → decelerate on the runway → leave at a chosen or assigned exit → removed once clear (scored as a landing). |
| **Runway exits** | New data: per runway, a list of `{name, distanceM, side}`. A pilot picks the first suitable exit if none is given. |
| **Departures at the holding point** | Spawned on the ground at the holding point, `phase: 'holding'`. New phases: `lineup`, `takeoffRoll`, `initialClimb`. |
| **Take-off roll** | Accelerate to Vr per type, rotate, climb on runway heading, then follow the SID (existing departure model). |
| **Runway occupancy** | The runway is occupied from line-up or touchdown until the aircraft has vacated or is airborne past the end. Also counted: an arrival inside about 2 NM with a landing clearance. |
| **AI Approach** | Vectors arrivals onto the ILS with simple spacing (3–5 NM, wake-aware) and hands them over at about 6 NM. Rule-based, reusing the existing nav modes. Arrivals not cleared to land by about 0.5 NM go around on their own. |
| **Wake departures** | Doc 4444 §5.8.3: 2 min (M or L behind H), 3 min for a departure behind an A380 (simplified). |
| **Tower positions** | `towers` in `EHAM.json`: lat, lon, eye height, default view bearing, the runways each cab watches. |
| **State for the renderer** | Already there: position, altitude, heading, vertical speed, phase. Add `gearDown`, `onGround`, `pitch`. |

## 6. Rules and scoring (Professional; Beginner relaxes them)

- **Runway incursion:** two aircraft on the runway (or a landing clearance while it is occupied) is a big penalty. Beginner warns before you send the clearance.
- **Landing without clearance:** penalty, and the pilot goes around.
- **Wake departure spacing infringed:** penalty.
- **Unnecessary go-around:** you sent one around when the runway was free; small penalty.
- **Late handoff:** the departure isn't handed to Departure by about 2000 ft, or the vacated arrival isn't sent to Ground within about 60 s.
- **Throughput and delay:** landings and departures per hour, and holding-point delay.
- Phraseology score and uncaught readback errors work as in Approach mode.

Scenarios: a tutorial of 4 short lessons (landing clearance, line up and take-off, vacate and handoffs, go-around), free play, and 3 Pro scenarios (light; mixed with a heavy; low visibility at dusk).

## 7. Renderer architecture

- `src/render/tower3d/`: three.js, **loaded with dynamic `import()` only when tower mode starts**, so the radar game's bundle doesn't change. Pin an exact three version (the sketch uses 0.170.0).
- Built once from `EHAM.json`: ground, runways, markings, lights, scenery (with a seeded RNG, so the scenery is identical every time). Aircraft meshes are pooled per type.
- Every frame: interpolate aircraft between sim ticks (as the scope does), set position, heading, pitch and gear, then render.
- **Labels are HTML**, positioned by projecting each aircraft to the screen (the sketch already does this, see `labels.json`). So they stay sharp, accessible and clickable, and reuse the scope's styles.
- Camera: fixed at the cab eye position. Yaw with `←` `→` or a mouse drag; binoculars narrow the FOV to about 2.5° and track the selected aircraft. Picking in the window uses a raycast, with a generous hit radius.
- **Performance target:** 60 fps at 1440×900 on a mid-range laptop with 20 aircraft. The field grid is one instanced mesh (~100k instances in the sketch; cut that down or merge to a texture if it costs too much). Measure before optimising.
- Accessibility: the window is decoration plus a picker. Everything you can do in it must also be possible from the strips, ground radar and keyboard. A `<canvas>` with `role="img"` and a text summary, as on the scope.

## 8. Not in scope B

- Taxi routes, pushback, Ground control (scope C).
- Crossing runways in use, intersection departures, conditional clearances ("behind the landing A330, line up and wait…"). Conditional clearances are a good candidate for B+ later.
- Real terminal or taxiway geometry, real liveries, weather beyond visibility, wind and time of day.

## 9. Open questions (also noted on the canvas)

1. Desk below the window (as drawn) or a full-screen window with floating panels (the earlier concept)?
2. Labels always on, or only on the selected aircraft and on hover?
3. Keep the flat low-poly look, or add textures and soft shadows later?
4. Binoculars: hold or toggle? Should they follow the selected aircraft automatically?
5. Realistic variant: no labels at all?
6. The spec (CLAUDE.md §1) lists tower mode as a v1 non-goal. It needs updating once this design is accepted.
