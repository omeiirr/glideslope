/** Voice-input state shown in the PTT bar. */
export interface VoiceState {
  status: 'off' | 'loading' | 'ready' | 'recording' | 'transcribing' | 'error';
  /** Model download progress 0..1 while loading. */
  progress: number;
  /** Live transcript while recording / transcribing. */
  partial: string;
  /** Extra detail: backend in use, or the error. */
  message?: string;
}

export const VOICE_OFF: VoiceState = { status: 'off', progress: 0, partial: '' };
