import { expect, test } from 'vitest';
import { CLEAR_FOG, LIGHT_FOG, fogAmount, fogDensity } from '../src/render/tower3d/lights';
import { scenarioById } from '../src/game/scenarios';
import { CLEAR_VIS, Session, visibilityText } from '../src/game/session';
import { DEFAULT_SETTINGS } from '../src/game/settings';

test('fog: 2 % contrast at the visibility distance, lights seen further, clear days keep the haze', () => {
  for (const v of [400, 600, 1000, 3000]) {
    const d = fogDensity(v);
    expect(Math.exp(-((d * v) ** 2))).toBeCloseTo(0.02, 3);
    // a runway light at 1.5× the visibility still shows clearly (> 20 %)
    expect(Math.exp(-((d * LIGHT_FOG * 1.5 * v) ** 2))).toBeGreaterThan(0.2);
  }
  expect(fogDensity(CLEAR_VIS)).toBe(CLEAR_FOG);
  expect(fogAmount(CLEAR_VIS)).toBe(0);
  expect(fogAmount(600)).toBe(1);
  expect([CLEAR_VIS, 3000, 1500, 600].map(visibilityText)).toEqual(['10 km+', '3 km', '1.5 km', '600 m']);
});

test('fog scenario: fixed 600 m at dusk; free play lets the player change the visibility', () => {
  const fog = new Session(scenarioById('tower-pro-fog'), DEFAULT_SETTINGS);
  expect(fog.visibilityM).toBe(600);
  expect(fog.clock.startsWith('16:30')).toBe(true);
  fog.setVisibility(CLEAR_VIS);
  expect(fog.visibilityM).toBe(600);
  const free = new Session(scenarioById('tower-free'), DEFAULT_SETTINGS);
  expect(free.visibilityM).toBe(CLEAR_VIS);
  free.setVisibility(1000);
  expect(free.visibilityM).toBe(1000);
});
