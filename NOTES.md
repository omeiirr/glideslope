# Notes

Findings kept for later: tried and measured, not built.

## Faster Whisper base: a shorter audio window (2026-11-20, parked)

Whisper pads every recording to 30 s. On a laptop CPU (8 cores, 4 threads) about 1.05 s of Whisper base's 1.6 s per command goes into the encoder reading that mostly empty window; the words themselves take about 0.6 s.

The ONNX encoders from `Xenova/whisper-base.en` only take exactly 3000 mel frames (30 s): the position table `embed_positions.weight` [1500, 512] is added at node `/Add_2` with a fixed size, and shorter input fails there. Inserting three nodes (Shape → Slice to get the sequence length → Slice the position table to it) before `/Add_2` makes the encoder take any window up to 30 s. The weights are unchanged; the edited graph passes `onnx.checker`. The worker then cuts the mel features to the window before `generate`.

Synthetic test (espeak-ng, 4 accents, 8 tower + 8 approach transmissions = 64 clips, light pink noise, band-limited 300–3400 Hz, the game's prompt, scored through the parser), Node, base q8, 4 threads:

| Window | Time per command | Commands right | Wrong actions |
|---|---|---|---|
| 30 s (now) | 1.32 s | 54/64 | 5 |
| 15 s | 1.05 s | 55/64 | 6 |
| 10 s | 0.81 s | 56/64 | 6 |
| recording + 1 s | 0.69 s | 53/64 | 5 |
| Whisper tiny 30 s, for comparison | 0.78 s | 40/64 | 18 |

So a 10 s window (or recording + 1 s for longer transmissions, at most 30 s) makes base about as fast as tiny is now, with no loss of accuracy on this set.

Why it is parked: the edited model has to be hosted by us. Hugging Face serves only the original files. Options:

- **In this repo, served by GitHub Pages:** the q8 CPU encoder is 23 MB (a plain file; Pages doesn't serve Git LFS). The rest of the model still comes from Hugging Face.
- **A Hugging Face model repo of our own** (MIT weights allow it).
- **WebGPU too** would need the fp32 encoder, 82 MB.

Not done: running the edited model in the browser (only Node), and testing with real voices.

How to redo it: Python venv with `onnx`; load `encoder_model_quantized.onnx`, find the Add node fed by `embed_positions.weight`, insert `Shape(x)` → `Slice(shape, [1], [2])` → `Slice(embed_positions.weight, [0], len, [0])`, rewire the Add to the sliced table, check, save.
