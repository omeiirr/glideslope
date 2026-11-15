export interface Settings {
  display: 'modern' | 'realistic';
  /** Default game mode for free play. */
  mode: 'beginner' | 'pro';
  voice: boolean;
  asr: 'whisper-base' | 'whisper-tiny' | 'webspeech';
  tts: 'piper' | 'system' | 'off';
  ttsVolume: number;
  radioFx: boolean;
  feedback: 'off' | 'errors' | 'all';
  /** Pro mode: probability of a wrong readback, 0..0.3. */
  readbackErrorRate: number;
  showTrails: boolean;
  showIntent: boolean;
  /** KeyboardEvent.code of the push-to-talk key. */
  pttKey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  display: 'modern',
  mode: 'beginner',
  voice: false,
  asr: 'whisper-base',
  tts: 'piper',
  ttsVolume: 0.8,
  radioFx: true,
  feedback: 'all',
  readbackErrorRate: 0.05,
  showTrails: true,
  showIntent: true,
  pttKey: 'Space',
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
