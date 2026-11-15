# Progress

## Current milestone: M8 Polish (M4–M7 implemented, not fully verified in a real browser with a microphone)

## Done
- **M0 Scaffold** — Vite + TS strict + Preact + Vitest + ESLint/Prettier, CI + Pages workflows, app shell.
- **M1 Sim core** — EHAM data, deterministic 0.5 s core, nav modes, spawner, separation/wake/prediction, headless tests.
- **M2 Modern scope + typed commands** — canvas scope (rings, TMA, final, fixes, trails, intent lines, conflict boxes, data blocks), pan/zoom, click to select, strips, typed command line. Smoke-tested in headless Chromium, no console errors.
- **M3 Phraseology** — parser, 26 feedback rules, readbacks, chips, 651-case corpus at 100 %.
- **M4 Radio + TTS** — frequency model (one at a time, queue, Pro blocking), check-ins, say again, Piper worker with 8 VCTK voices, radio FX, browser-voice fallback. Piper download + synthesis worked in headless Chromium; audio quality not checked by ear.
- **M5 Voice input** — PTT (Space / mic button / configurable key), Whisper worker (base WebGPU → tiny WASM → opt-in Web Speech), live transcript, early callsign highlight, confidence bar. **Not tested with a real microphone.**
- **M6 Game layer** — Beginner/Pro rules, scoring, readback errors (catch/miss/debrief), 5 tutorial lessons, free play, 3 Pro scenarios, debrief, localStorage settings + progress. Session logic covered by headless tests.
- **M7 Realistic display** — STARS-like scope with 4 s sweep, DCB, text overlays.

## Next
1. Manual test with a microphone in Chrome (WebGPU) and Firefox (WASM fallback); tune Whisper prompts/vocabulary if callsigns are misheard.
2. Listen to the Piper voices and radio FX; adjust speeds/levels.
3. M8: accessibility pass (screen reader on strips/log), 40-aircraft performance check, README screenshots.

## Known issues
- CI and Pages deploy untested until the repo is pushed. After pushing: Settings → Pages → Source = "GitHub Actions".
- espeak-ng (inside the phonemizer WASM) is GPL-3.0: licence compatibility needs a decision before public release (see THIRD_PARTY.md).
- Departures from 24 don't interact with arrivals on 18R in the sim (no runway occupancy model).
- Holds are direct-entry only.
