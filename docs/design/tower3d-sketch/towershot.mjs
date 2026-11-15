import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const out = process.argv[2], presets = process.argv.slice(3);
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const all = {};
for (const p of presets) {
  const pg = await b.newPage({ viewport: { width: 2240, height: 1200 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await pg.goto(`http://localhost:4190/index.html?p=${p}`);
  await pg.waitForFunction(() => window.__done || null, null, { timeout: 120000 }).catch(() => {});
  all[p] = await pg.evaluate(() => window.__labels);
  await pg.locator('canvas').screenshot({ path: `${out}/${p}.png` });
  console.log(p, errs.length ? errs : 'ok', JSON.stringify(all[p]));
  await pg.close();
}
writeFileSync(`${out}/labels.json`, JSON.stringify(all, null, 1));
await b.close();
