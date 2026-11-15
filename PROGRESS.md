# Progress

## Current milestone: M8 Polish (mostly done; remaining items need a human)

## Done
- **M0 Scaffold** — Vite + TS strict + Preact + Vitest + ESLint/Prettier, CI + Pages workflows, app shell.
- **M1 Sim core** — EHAM data, deterministic 0.5 s core, nav modes, spawner, separation/wake/prediction, headless tests.
- **M2 Modern scope + typed commands** — canvas scope (rings, TMA, final, fixes, trails, intent lines, conflict boxes, data blocks), pan/zoom, click to select, strips, typed command line. Smoke-tested in headless Chromium, no console errors.
- **M3 Phraseology** — parser, 26 feedback rules, readbacks, chips, 651-case corpus at 100 %.
- **M4 Radio + TTS** — frequency model (one at a time, queue, Pro blocking), check-ins, say again, Piper worker with 8 VCTK voices, radio FX, browser-voice fallback. Verified in headless Chromium: voice model downloaded in 12 s, readback audio started 1.2 s after sending (includes the 0.5–1.2 s simulated pilot reaction). Audio quality not yet checked by ear; clip peak level is low (~0.17).
- **M5 Voice input** — PTT (Space / mic button / configurable key), Whisper worker (base WebGPU → tiny WASM → opt-in Web Speech), live transcript (WebGPU only), early callsign highlight, confidence bar. Verified with a fake microphone in headless Chromium on the WASM path: Whisper tiny loaded in 11 s, final transcript 2.1 s after release, parsed and executed correctly. **Not tested with a real microphone or on WebGPU (whisper-base).**
- **M6 Game layer** — Beginner/Pro rules, scoring, readback errors (catch/miss/debrief), 5 tutorial lessons, free play, 3 Pro scenarios, debrief, localStorage settings + progress. Session logic covered by headless tests; all 5 lessons verified completable by following their instructions with a slow reader; all 3 Pro scenarios run to the end without errors.
- **M7 Realistic display** — STARS-like scope with 4 s sweep, DCB, text overlays.
- **M8 Polish (partial)** — pilot voices normalised to equal loudness; axe-core reports no violations on menu, settings, both game displays and debrief; scope text colours raised to ≥4.5:1; dialogs trap focus, close on Escape and return focus; PTT key no longer fires inside dialogs; keyboard-only play verified (Tab/Enter to select a strip, Enter for the command line); README with screenshots; Learn reference screen (phonetics, values, commands, altimetry, approach concepts, with listen buttons).

## Next
1. Manual test with a real microphone in Chrome (WebGPU, whisper-base: check the 1.5 s readback target) and Firefox (WASM fallback).
2. Listen to the Piper voices and radio FX by ear.
3. Try it with a real screen reader (NVDA/VoiceOver): automated checks pass, but the live regions (radio log, PTT status) may be too chatty.

## Measured
- Scope draw time with 40 aircraft (headless Chromium, software rendering): ~0.5 ms average, 0.7 ms p95, in both display modes.

## Known issues
- CI and Pages deploy untested until the repo is pushed. After pushing: Settings → Pages → Source = "GitHub Actions".
- espeak-ng (inside the phonemizer WASM) is GPL-3.0: licence compatibility needs a decision before public release (see THIRD_PARTY.md).
- Departures from 24 don't interact with arrivals on 18R in the sim (no runway occupancy model).
- Holds are direct-entry only.
