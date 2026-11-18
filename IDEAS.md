# Ideas (not for v1)

- Tower mode / 3D view (`render/tower3d/`), using the lat/lon + phase state the core already exposes.
- More runway configurations and airports.
- **Moonshine tiny/base** as the speech model for machines without fast WebGPU: no 30 s padding, so short commands transcribe faster. Supported by the installed transformers.js. Needs a recorded test set to compare against Whisper.
- **Radar commands (parked 2026-11-18, waiting for the owner's radar-mode feedback):** "expedite descent/climb", rate of climb or descent ("descend at 2000 feet per minute or greater"), turn by degrees ("turn left 20 degrees"), speed variants ("reduce to minimum approach speed", "no ATC speed restrictions", "increase speed 250 knots").
- **Pilot requests in Pro** ("request higher", "request direct SUGOL"), approved or denied by the player.
- **Changing weather:** QNH change mid-session with a new ATIS letter (pilots need the new QNH), wind shifts.
- **Debrief replay:** a timeline of the session marking separation losses, missed readback errors and go-arounds caused.
- **Daily challenge:** a seeded scenario per date with a local best score.
