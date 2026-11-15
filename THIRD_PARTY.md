# Third-party material

| Item | Use | License | Source |
|---|---|---|---|
| Inter (variable) | UI font | SIL OFL 1.1 | https://github.com/rsms/inter via `@fontsource-variable/inter` |
| JetBrains Mono (variable) | Monospace font | SIL OFL 1.1 | https://github.com/JetBrains/JetBrainsMono via `@fontsource-variable/jetbrains-mono` |
| Preact | UI library | MIT | https://preactjs.com |
| openScope EHAM airport data | Runway thresholds, fixes, TMA polygon in `data/airports/EHAM.json` | MIT | https://github.com/openscope/openscope |
| OurAirports | Runway length and width | Public domain | https://ourairports.com/data/ |
| ONNX Runtime Web | Runs the TTS and ASR models (self-hosted WASM) | MIT | https://github.com/microsoft/onnxruntime |
| Transformers.js | Whisper pipeline | Apache-2.0 | https://github.com/huggingface/transformers.js |
| piper-wasm (espeak-ng + piper-phonemize build) | Phonemizer for Piper TTS (self-hosted WASM + data) | MIT build scripts; espeak-ng is GPL-3.0, see note | https://github.com/diffusion-studio/piper-wasm |
| Piper voice `en_GB-vctk-medium` | Pilot voices (downloaded at runtime from Hugging Face) | Model MIT (Piper); trained on VCTK, CC BY 4.0 | https://huggingface.co/rhasspy/piper-voices · https://datashare.ed.ac.uk/handle/10283/3443 |
| Whisper base.en / tiny.en (ONNX, Xenova) | Speech recognition (downloaded at runtime) | Apache-2.0 (weights MIT, OpenAI) | https://huggingface.co/Xenova/whisper-base.en · https://huggingface.co/Xenova/whisper-tiny.en |
| three.js 0.170.0 | 3D tower view (loaded only in tower mode) | MIT | https://github.com/mrdoob/three.js |
| PDOK Luchtfoto 2024 (25 cm RGB, layer `2024_ortho25`) | Ground imagery of the tower view, resampled to WebP in `public/tower/` by `scripts/build-tower-imagery.py`. Credited on screen: "Aerial imagery: Beeldmateriaal Nederland / PDOK, CC BY 4.0" | CC BY 4.0 | https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0 · https://data.overheid.nl (dataset "Luchtfoto Beeldmateriaal 2024 25cm RGB open data") |

**Note on espeak-ng:** the phonemizer WASM includes espeak-ng, which is GPL-3.0. It is served as a separate runtime file, not linked into the MIT app code. Before a public release, confirm this arrangement is acceptable (or swap in a non-GPL phonemizer). Recorded as an open issue in PROGRESS.md.
