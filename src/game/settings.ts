import type { GraphicsSetting } from '../render/tower3d/quality';
export interface Settings {
  display: 'modern' | 'realistic';
  /** Default game mode for free play. */
  mode: 'beginner' | 'pro';
  voice: boolean;
  asr: 'whisper-base' | 'whisper-tiny' | 'webspeech';
  tts: 'piper' | 'system' | 'off';
  ttsVolume: number;
  radioFx: boolean;
  /** Sound effects (engines, cab and room, alerts), 0 = off. */
  sfxVolume: number;
  feedback: 'off' | 'errors' | 'all';
  /** Pro mode: probability of a wrong readback, 0..0.3. */
  readbackErrorRate: number;
  /** Free play arrivals per hour. */
  freeRate: number;
  showTrails: boolean;
  showIntent: boolean;
  /** KeyboardEvent.code of the push-to-talk key. */
  pttKey: string;
  /** Tower view graphics; auto picks by measured frame time. */
  graphics: GraphicsSetting;
  /** Radar-room ambience on the menu (off until the player turns it on). */
  menuSound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  display: 'modern',
  mode: 'beginner',
  voice: false,
  asr: 'whisper-base',
  tts: 'piper',
  ttsVolume: 0.8,
  radioFx: true,
  sfxVolume: 0.6,
  feedback: 'all',
  readbackErrorRate: 0.05,
  freeRate: 12,
  showTrails: true,
  showIntent: true,
  pttKey: 'Space',
  graphics: 'auto',
  menuSound: false,
};

/** localStorage wrapper: never throws (private mode, quota, disabled storage). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`vectors.${key}`);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`vectors.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just don't persist */
  }
}
