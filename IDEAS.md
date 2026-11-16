# Ideas (not for v1)

- Tower mode / 3D view (`render/tower3d/`), using the lat/lon + phase state the core already exposes.
- More runway configurations and airports.
- **Moonshine tiny/base** as the speech model for machines without fast WebGPU: no 30 s padding, so short commands transcribe faster. Supported by the installed transformers.js. Needs a recorded test set to compare against Whisper.
