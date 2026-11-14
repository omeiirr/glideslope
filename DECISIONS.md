# Decisions

Every non-trivial choice, newest milestone last. Format: **decision** — reason (source).

## Project-level (answered by the owner, 2026-11-15)
- **No GitHub remote yet; local commits only.** CI and Pages workflows are written but have never run. The owner creates the remote and pushes.
- **Commit straight to `main`, tag each finished milestone** (`m0`, `m1`, …).
- **ASR/TTS models load from the Hugging Face CDN at runtime** and are cached by the browser. Keeps the repo small; no audio leaves the machine, but the browser does contact huggingface.co to fetch model files.
- **Name stays "Vectors".**

## M0 Scaffold
- **Fonts self-hosted via `@fontsource-variable/*`** instead of the Google Fonts link in the mockups — no third-party request on page load (spec §12: no trackers).
- **Vite `base: './'`** — the build works under any Pages sub-path without knowing the repo name.
- **ESLint blocks DOM globals and UI imports inside `src/core/`** — enforces the headless-core rule from spec §4 mechanically.
- **Deploy workflow re-runs lint/typecheck/tests before building** — a red `main` never deploys.
