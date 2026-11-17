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
| OpenStreetMap | Airport layout of the tower view (runway areas, taxiways, aprons, holding positions, grass) in `public/tower/ground.json`, built by `scripts/build-tower-ground.py`; land use, water and motorways in `public/tower/land.json`, built by `scripts/build-tower-land.py`; airport buildings in `public/tower/buildings.json`, built by `scripts/build-tower-buildings.py`; stand lines, gates, jet bridges and floodlight masts in `public/tower/stands.json`, built by `scripts/build-tower-stands.py`. Credited on screen: "Airport layout © OpenStreetMap contributors". The file is a derived database and is itself available under the ODbL | ODbL 1.0 | https://www.openstreetmap.org/copyright |
| Poly Haven | Pavement textures of the tower view: `aerial_asphalt_01` and `concrete_floor_worn_001`, made grey, slabbed and resized by `scripts/build-tower-textures.py` into `public/tower/tex/` | CC0 1.0 | https://polyhaven.com/license |
| three.js 0.170.0 | 3D tower view (loaded only in tower mode) | MIT | https://github.com/mrdoob/three.js |

**Note on espeak-ng:** the phonemizer WASM includes espeak-ng, which is GPL-3.0. It is served as a separate runtime file, not linked into the MIT app code. Before a public release, confirm this arrangement is acceptable (or swap in a non-GPL phonemizer). Recorded as an open issue in PROGRESS.md.
