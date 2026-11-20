import { expect, test } from 'vitest';
import { EHAM } from '../src/core';
import { asrPrompt, isPromptEcho } from '../src/speech/prompt';
import { webGpuHint } from '../src/speech/voice';

const aircraft = ['KLM1234', 'BAW432', 'TRA6KL'].map((callsign) => ({
  callsign,
  alt: 7000,
  hdg: 90,
  ias: 250,
  qnhGiven: false,
}));

test('prompt: station, every callsign on frequency, the role phrases', () => {
  const p = asrPrompt({ airport: EHAM, qnh: 1009, aircraft });
  expect(p.startsWith('Schiphol Approach. KLM 1234, identified. Speedbird 432, turn left heading 210.')).toBe(
    true,
  );
  expect(p).toContain('Transavia 6KL,');
  expect(p).toContain('QNH 1009');
  expect(p).toContain('proceed direct ARTIP');
  expect(p).toContain('cleared ILS approach runway 18R');

  const t = asrPrompt({ airport: EHAM, qnh: 1013, aircraft, role: 'tower', wind: { dir: 90, speed: 7 } });
  // ICAO order: "runway 18R, cleared to land" (the other order made Whisper hear "cleared for take-off")
  expect(
    t.startsWith('Schiphol Tower. KLM 1234, wind 090 degrees 7 knots, runway 18R, cleared to land.'),
  ).toBe(true);
  expect(t).toContain('runway 24, line up and wait');
  expect(t).toContain('vacate left via V');
  expect(t).not.toContain('ILS');
});

test('prompt: stays within Whisper prompt size with a full frequency', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...aircraft[0]!, callsign: `KLM${1000 + i}` }));
  const p = asrPrompt({ airport: EHAM, qnh: 1013, aircraft: many });
  // ~4 characters per token: well under the 224-token limit
  expect(p.length).toBeLessThan(700);
  expect(p).not.toContain('KLM 1010');
  expect(asrPrompt({ airport: EHAM, qnh: 1013, aircraft: [] })).toMatch(/^Schiphol Approach\. identified\./);
});

test('echo: the start of the prompt is dropped, real transmissions are kept', () => {
  const p = asrPrompt({ airport: EHAM, qnh: 1013, aircraft });
  expect(isPromptEcho('Schiphol Approach.', p)).toBe(true);
  expect(isPromptEcho('Schiphol Approach. KLM 1234, identified', p)).toBe(true);
  // the first real call of every contact must survive, even though the prompt contains it word for word
  expect(isPromptEcho('KLM 1234, identified.', p)).toBe(false);
  expect(isPromptEcho('KLM 1234, turn left heading 270', p)).toBe(false);
  expect(isPromptEcho('', p)).toBe(false);
});

test('WebGPU hint: per browser, and a different note when base failed on WebGPU', () => {
  const linuxChrome =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const winChrome =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
  expect(webGpuHint('no-webgpu', linuxChrome)).toContain('chrome://flags');
  expect(webGpuHint('no-webgpu', winChrome)).toContain('graphics acceleration');
  expect(webGpuHint('no-webgpu', firefox)).toContain('dom.webgpu.enabled');
  expect(webGpuHint('base-failed', winChrome)).toContain('graphics driver');
  expect(webGpuHint('no-webgpu', winChrome, 'baseCpu')).toContain('Whisper base runs on the processor');
  expect(webGpuHint('base-failed', winChrome)).toContain('Whisper tiny runs instead');
});
