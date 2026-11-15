# Tower view sketch (throwaway)

A standalone three.js scene that renders the out-the-window stills for the tower mode design boards. Not app code. It is the starting point for `src/render/tower3d/` when tower mode is built.

- `scene.js`: builds the scene from `EHAM.json` (runways, markings, lights) plus generic low-poly scenery and procedural aircraft. Presets via `?p=west-day | centre-dusk | west-bino` (`&b=` bearing, `&dep=` view depression in degrees).
- `towershot.mjs`: renders each preset in headless Chromium (playwright-core, SwiftShader WebGL) to `renders/<preset>.png`. It also writes `renders/labels.json`, the screen position of each aircraft, which the boards use to place labels.

To run it: copy `data/airports/EHAM.json` next to `index.html`, `npm i three@0.170.0`, serve the folder on port 4190 (`python3 -m http.server 4190`), then `node towershot.mjs renders west-day centre-dusk west-bino`. The Chromium path in `towershot.mjs` is machine-specific.
