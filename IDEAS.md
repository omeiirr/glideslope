# Ideas (not for v1)

- Tower mode / 3D view (`render/tower3d/`), using the lat/lon + phase state the core already exposes.
- More runway configurations and airports.
- **Whisper vocabulary prompt (parked 2026-11-16).** Prefix each transcription with example transmissions built from the live game (callsigns on frequency, fixes, runway, "QNH", "ILS") so Whisper expects ATC words. About 80 lines: transformers.js 4.3 has no `prompt_ids` option, so pass `<|startofprev|>` + prompt tokens as `decoder_input_ids` and cut them from the output. Parked until voice speed on slow machines is sorted. Risk: on silence Whisper can echo the prompt.
- **Moonshine tiny/base** as the speech model for machines without fast WebGPU: no 30 s padding, so short commands transcribe faster. Supported by the installed transformers.js. Needs a recorded test set to compare against Whisper.
