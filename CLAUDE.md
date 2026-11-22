# Glideslope — browser ATC simulator with voice

> Named "Glideslope" (2026-11-21; was "Vectors"). This file is the project spec. Read it fully at the start of every session, then read `PROGRESS.md` and `DECISIONS.md`.

## 1. What we are building

A **free, open-source, browser-based approach-control (radar) simulator**. The player is the approach controller. They give instructions **by voice** (push-to-talk) or by typed commands, and simulated pilots **read back over the radio using TTS**. Everything runs **client-side**: no backend and no paid APIs, so it can be hosted free on GitHub Pages.

Inspiration: openScope (radar sim, unmaintained for about 4 years) plus the voice features that paid games have (Tower! Simulator 3, ATC Voice, MultiScope). Our differentiators are that it's free, needs no install, uses ICAO phraseology, gives feedback on your phraseology, and trains you to catch readback errors.

### Non-goals for v1 (do NOT build these)
- Multiplayer, accounts, any server or backend
- Mobile or touch layouts (desktop browsers only; the UI must not break on small screens, but it doesn't need to be good there)
- Ground control, taxiing and pushback (tower mode covers the runways only, see §6).
- More than one airport
- En-route / area control

## 2. Fixed decisions (do not revisit)

| Topic | Decision |
|---|---|
| Phraseology | **ICAO** (Doc 4444 PANS-ATM ch. 12, Doc 9432; UK CAP 413 and Dutch VACC/VATSIM training material as practical references). Altitudes in feet, QNH in hPa, speeds in knots, distances in NM. |
| Role | Approach control only |
| Airport | **EHAM Amsterdam Schiphol**, simplified (see §5) |
| Push-to-talk | **Space bar** (hold to talk). Also a clickable/holdable mic button. |
| Phraseology strictness | **Accept loose phrasing, but give feedback**: say what was understood and what the correct ICAO phrase would be. |
| Game modes | **Beginner** (no separation rules or penalties, lots of help) and **Professional** (real separation, wake turbulence and procedure rules, penalties). See §8. |
| Display modes | **Modern** (default) and **Realistic** (STARS-like). Designs in `docs/design/`. |
| Hosting | Static site on GitHub Pages; everything client-side |
| License | GPL-3.0 (2026-11-21; was MIT). Third-party data, models and voices keep their own licenses, listed in `THIRD_PARTY.md`. |

## 3. Tech stack

- **TypeScript (strict)**, **Vite**, **Vitest** for tests, ESLint + Prettier.
- **Scope rendering:** Canvas 2D (one canvas, redrawn per frame).
- **Tower view:** three.js (WebGL), loaded with a dynamic `import()` only when tower mode starts, so the radar game's bundle and start-up are unaffected. The airport and land data (OpenStreetMap, about 2 MB compressed) is downloaded on entering tower mode (budget: about 8 MB).
- **Side panels and overlays:** Preact (small, fast). Keep UI state out of the sim core.
- **Speech recognition (ASR):** Whisper via `@huggingface/transformers` (transformers.js) in a **Web Worker**.
  - Default: `whisper-base.en` on WebGPU.
  - Fallback 1: `whisper-tiny.en` on WASM, for machines without WebGPU.
  - Fallback 2: the browser Web Speech API, opt-in only, with a notice that audio may go to a cloud service in some browsers.
  - Typed commands always work.
  - The model downloads on first use with a visible progress bar, then is cached. Voice is optional, and the game must be fully playable before or without the download.
- **TTS:** Piper running in the browser (evaluate the available Piper/VITS web ports; pick a maintained one), in a Web Worker. Fallback: `speechSynthesis`. Use 4–6 distinct English voices with different accents, assigned per aircraft. **Check every voice model's license** and record it in `THIRD_PARTY.md`; use only licenses that allow redistribution.
- **Radio effects:** Web Audio. Band-pass about 300–3400 Hz, light distortion, background noise, squelch click at start and end.
- **Persistence:** `localStorage` only (settings, high scores, tutorial progress), wrapped in try/catch.
- **CI:** GitHub Actions runs lint, typecheck and tests on push, and deploys to Pages from `main`.

## 4. Architecture

```
src/
  core/        Pure, deterministic simulation. No DOM, no audio, no rendering.
               Runs headless in Node for tests. Seedable RNG.
    airport/   data loading + types (runways, fixes, STARs, ILS, airspace)
    aircraft/  performance model, flight-plan state, nav modes
    traffic/   spawner / scenario engine
    rules/     separation, wake, conflict prediction, scoring
    commands/  Command types (the ONLY way to change aircraft state)
  phraseology/ text → Command[] parser, feedback generator, pilot readback generator
  speech/      ASR worker, TTS worker, radio FX, PTT handling
  radio/       frequency model (one transmission at a time, blocking, queue)
  render/      scope renderers: modern/, realistic/ (both read core state only)
  ui/          Preact panels: strips, radio log, PTT bar, menus, settings, tutorial
  game/        game loop, modes, scenarios, session state
data/airports/EHAM.json
tests/         unit + scenario tests; tests/phrases/*.jsonl parser corpus
docs/design/   reference mockups (Main.dc.html = Modern, Realistic.dc.html)
```

Rules:
- **Every input goes through one command layer.** Voice → text → parser → `Command[]`; typed text → the same parser; clicks → `Command`. The core never knows where a command came from.
- **The core is deterministic:** fixed time step (e.g. 0.5 s sim tick), seedable RNG, and time-compression support (1×, 2×, 4×, 8×). The renderer interpolates between ticks.
- The radar "sweep": the Realistic display updates target positions every 4 s (like real radar). The Modern display may update smoothly.
- The core exposes a read-only snapshot. Renderers and UI never mutate it.

## 5. Airport: EHAM (simplified)

- Build `data/airports/EHAM.json`. Sources:
  - openScope's EHAM airport file, **only if its license allows reuse** (check the repo LICENSE and credit it in `THIRD_PARTY.md`).
  - OurAirports (public domain) for runway coordinates.
  - The public Dutch eAIP (LVNL) to sanity-check fixes and procedures.
  - Write down in `DECISIONS.md` which source each value came from.
- v1 configuration: **landing runway 18R; departures from 24** (shown as departure traffic climbing out to the edge of the airspace, which the player hands off). Other configurations can be added to the file later.
- Arrivals enter over the three IAFs: **ARTIP** (east), **RIVER** (south-west), **SUGOL** (north-west), via simplified STARs.
- Transition altitude **3000 ft**. Transition level from QNH (default QNH 1013 → TL FL040; keep it simple and table-based).
- Approach airspace: a simplified TMA polygon, roughly 40 NM radius, surface to FL100 (aircraft enter at FL070–FL110).
- Frequencies (configurable in the data file): Approach (player), Tower 18R (handoff target).
- Wind: a data-driven surface wind (affects groundspeed, and runway choice later). Default 200/12.

## 6. Tower mode (added after v1; design in `docs/design/tower3d.md`)

The player is Schiphol Tower: landing, line-up and take-off clearances, vacating, handoffs. An AI Approach feeds arrivals. No ground control or taxiing. Two cabs as at the real airport: Tower West for 18R and the central tower for 24.

- The core must not assume radar-only views. Aircraft state includes position, altitude, heading, speed, vertical speed and phase; runway geometry is in true coordinates (lat/lon plus heading, length and width).
- `render/tower3d/` reads core state only, like the scope renderers. Maths that doesn't need WebGL (projection, camera, aircraft pose) lives in a DOM-free module with tests.
- Look: clean semi-realistic. The airport surfaces are drawn as graphics from OpenStreetMap data (ODbL): runways with their markings, taxiways, aprons, airside grass. The land around them is modelled from OSM too (land use, water, motorways), and the airport buildings are extruded from their OSM outlines; no aerial photos, so everything is drawn in one style (pavement uses grey CC0 photo textures from Poly Haven, tinted by the drawn surface colours). Gradient sky and haze, smooth procedural aircraft. No third-party 3D models.
- Everything that can be done in the 3D window must also be possible from the strips and the keyboard.

## 7. Commands, phraseology and feedback

### 7.1 Supported commands (v1)
| Command | Canonical ICAO phrase (example) |
|---|---|
| Identify / radar contact (reply to check-in) | "KLM1234, Schiphol Approach, identified" |
| Heading | "KLM1234, turn left heading 270" / "fly heading 270" / "continue present heading" |
| Altitude/level | "descend altitude 3000, QNH 1013" (below TL) / "descend flight level 70" / "climb flight level 100" |
| Speed | "reduce speed 220 knots" / "maintain 180 knots until 4 miles final" / "resume normal speed" |
| Direct to | "proceed direct ARTIP" |
| ILS clearance | "cleared ILS approach runway 18R" (often with a heading: "turn left heading 210, cleared ILS approach runway 18R") |
| Hold | "hold at ARTIP as published" (v1: standard right-hand 1-minute hold, inbound track from data) |
| Handoff | "contact Schiphol Tower 118.280" (frequency from data) |
| Go around | "go around" (also triggered automatically when an approach is unstable in Pro mode) |
| Say again | Player asks a pilot to repeat a transmission |
| Several instructions in one transmission | "turn left heading 210, descend altitude 2000, reduce speed 180 knots" |

Pilots also **call in on their own**: initial check-in ("Schiphol Approach, KLM1234, flight level 70, information Bravo"), and in Pro mode occasionally a request or "unable".

### 7.2 Callsigns
Use the ICAO telephony designator plus the flight number, spoken with ICAO number and phonetic-alphabet pronunciation. Table in data: KLM→"KLM", BAW→"Speedbird", EZY→"Easy", DLH→"Lufthansa", RYR→"Ryanair", TRA→"Transavia", TFL→"Orange", AFR→"Air France", UAE→"Emirates", DAL→"Delta". Accept both the telephony form and the 3-letter code spelled out ("Kilo Lima Mike").

### 7.3 Parser (deterministic, rule-based: NO LLM)
Pipeline: ASR text → normalize → callsign resolution → command extraction → validation → `ParseResult`.
- **Normalize:** lowercase; spoken numbers to digits ("two seven zero" → 270, "tree"/"fife"/"niner" accepted, "three thousand" / "tree tousand" → 3000, "flight level seven zero" → FL070); phonetic letters; strip filler ("uh", "please", "and").
- **Callsign resolution:** fuzzy-match against **aircraft currently on frequency only** (edit distance over the normalized telephony form plus digits). Return a confidence. If two candidates are close, it's ambiguous: no action, and the pilots reply "station calling, say again".
- **Commands:** keyword grammar with synonyms (loose acceptance), e.g. "go down to / descend to / descend and maintain" all map to the altitude command.
- **ParseResult** = `{callsign, confidence, commands[], issues[]}`, where `issues` are phraseology feedback items: `{severity: 'info'|'warn'|'error', said, expected, rule}`.

### 7.4 Feedback to the player
- **Correct ICAO:** show a ✓ in the log.
- **Understood but non-standard:** execute the command and show a short note, e.g. *You said "go down to 3000". ICAO: "descend altitude 3000, QNH 1013".* Common rules to detect:
  - Missing QNH on the first clearance below the transition level.
  - "flight level" used below the transition level, or "altitude" used above it.
  - Missing turn direction on a heading.
  - "descend and maintain" (FAA style).
  - "to" before numbers ("descend to two thousand", which risks a "two"/"to" mix-up).
  - Heading not in 3 digits.
  - Missing runway in an ILS clearance.
- **Not understood:** no action. The pilot replies "say again" (or the log says why, e.g. "callsign not recognized").
- A settings toggle sets feedback verbosity (Off / Errors only / All).
- A per-session **phraseology score** is shown in the debrief.

### 7.5 Readbacks
- Generate ICAO-style readbacks: the instruction elements followed by the callsign ("Left heading 270, descend altitude 3000, QNH 1013, KLM1234"). Speak with TTS and show the text in the log.
- **Pro mode only, readback errors:** about 5% of readbacks contain a wrong value (configurable). The player must catch it by repeating the correct value (or saying "negative"). If uncaught, the pilot flies the wrong value and it counts against the score. Log entries for uncaught errors are revealed in the debrief, not live, so the player has to actually listen.

## 8. Game modes

| | Beginner | Professional |
|---|---|---|
| Separation | none enforced; soft warnings only | 3 NM / 1000 ft in TMA; loss = penalty |
| Wake turbulence on final | off | ICAO Doc 4444 distances (e.g. M behind H 5 NM, L behind M 5 NM, H behind H 4 NM, M behind J 7 NM) |
| ILS intercept | generous (any angle, any altitude) | ≤30° intercept, from at or below glideslope, else no capture or unstable → go-around |
| Conflict prediction, intent lines | on | optional (on in Modern, off in Realistic) |
| Readback errors | off | on (~5%) |
| Frequency blocking (talking over a pilot) | off | on: both transmissions are garbled, "say again" |
| Must hand off to Tower | auto | player must; late handoff = penalty |
| Traffic rate | low, adjustable | scenario-based, higher |
| Command help (suggestions, phrase examples) | on | off |

Scoring (both modes, weighted differently): landings, average delay, separation losses, wake infringements, missed handoffs, go-arounds caused, aircraft leaving airspace wrongly, phraseology score, uncaught readback errors.

Scenarios: a JSON scenario format (seed, traffic list or spawn rates, wind, duration). Ship: a tutorial (5 short guided lessons: heading, altitude, speed, ILS, handoff), Beginner free play, and 3 Pro scenarios (light, medium, peak arrival push).

## 9. UI

- Follow `docs/design/Main.dc.html` (Modern) and `docs/design/Realistic.dc.html` (Realistic). They're static HTML mockups: match the layout, colors, typography (Atkinson Hyperlegible Next + Atkinson Hyperlegible Mono since 2026-11-22; the mockups use Inter + JetBrains Mono) and information hierarchy, not their markup.
- **Modern layout:**
  - Top bar: airport, frequency, clock, traffic, score, mode switch, pause, speed.
  - Left: arrival-sequence strips, drag to reorder.
  - Center: the scope.
  - Right: radio panel showing who's transmitting and the frequency-busy state, plus a log with parsed chips, readback checks and feedback.
  - Bottom: the push-to-talk bar with live transcript, parsed command chips and confidence.
- **Selecting an aircraft:** click a target or strip. A typed command box is focusable with Enter (Space is reserved for PTT unless a text field has focus).
- **Recognized callsign:** highlight the aircraft on the scope as soon as the callsign is recognized, while the player is still talking.
- **Accessibility:** real buttons, keyboard-operable, text contrast ≥4.5:1, don't rely on color alone (icons and labels too).
- **Settings:** voice on/off and model choice, ASR fallback, TTS voices/volume/radio FX, feedback verbosity, display mode, game mode, readback error rate, keybindings.

## 10. Quality bar

- **Parser corpus:** `tests/phrases/*.jsonl` with **at least 400 cases** of `{input, expectedCallsign, expectedCommands, expectedIssues}`. Cover correct ICAO, loose phrasing, typical ASR mistakes (homophones such as "to/two", "for/four", "tree", run-together digits), multiple commands per transmission, and ambiguous or unknown callsigns. Target ≥95% pass on correct and loose phrasing. The parser is the heart of the game: keep this corpus growing.
- **Core scenario tests:** headless, seeded runs that check the physics. Examples: an aircraft on heading 270 reaches the expected position; descent rates are realistic; ILS capture works; go-around triggers; separation-loss detection fires correctly.
- **Performance:** 60 fps on the scope with 40 aircraft on a mid-range laptop. A spoken command should produce its readback within about 1.5 s of releasing PTT on WebGPU.
- **No console errors** in a normal session. Typecheck and lint clean.

## 11. Milestones (work in order; each ends green: tests, lint, typecheck, deployed)

1. **M0 Scaffold:** Vite + TS + Preact + Vitest + ESLint/Prettier, CI, Pages deploy, empty app shell matching the Modern layout.
2. **M1 Sim core:** EHAM data, aircraft model, nav modes (heading/altitude/speed/direct/ILS/hold/go-around), traffic spawner, headless tests.
3. **M2 Modern scope + typed commands:** render scope, data blocks, trails, intent lines; select aircraft; typed command entry using a first version of the parser.
4. **M3 Phraseology:** full parser, feedback rules, readback generator, the 400-case corpus.
5. **M4 Radio + TTS:** frequency model, pilot check-ins, TTS readbacks with radio FX, multiple voices, say again, blocking.
6. **M5 Voice input:** PTT (Space), ASR worker with fallbacks, live transcript, early callsign highlight, confidence handling.
7. **M6 Game layer:** Beginner/Pro rules, conflict prediction, wake, scoring, scenarios, tutorial, debrief screen.
8. **M7 Realistic display mode.**
9. **M8 Polish:** settings, persistence, accessibility pass, performance pass, README with screenshots, `THIRD_PARTY.md` complete.
10. **M9 Tower mode** (see `docs/design/tower3d.md`), in steps: T1 3D view of existing traffic; T2 sim (rollout, exits, take-off roll, runway occupancy); T3 tower commands and phraseology; T4 tower game (AI Approach, rules, scoring, scenarios); T5 tower screen (desk, ground radar, dusk/night, Realistic variant); T6 lessons and polish.

## 12. Working autonomously

- Keep `PROGRESS.md` updated: current milestone, what's done, what's next, known issues.
- Record every non-trivial choice (library picked, data source, an assumption about a real-world rule) in `DECISIONS.md`, with a one-line reason and the source link if it's about real-world ATC.
- Real-world ATC rules: when unsure, follow ICAO Doc 4444 / CAP 413 / VATSIM Dutch VACC material; when a rule is too complex for v1, simplify it and note that in `DECISIONS.md`. Don't invent procedures.
- Small, focused commits with clear messages; one milestone per branch/PR is fine.
- Don't add anything listed under Non-goals. Put ideas in `IDEAS.md` instead.
- Don't add servers, analytics, trackers or paid APIs. Nothing the player says may leave their machine, except through the opt-in Web Speech fallback, which must be clearly labelled.
