/** Voice-input state shown in the PTT bar. */
export interface VoiceState {
  status: 'off' | 'loading' | 'ready' | 'recording' | 'transcribing' | 'error';
  /** Model download progress 0..1 while loading. */
  progress: number;
  /** Live transcript while recording / transcribing. */
  partial: string;
  /** Extra detail: backend in use, or the error. */
  message?: string;
  /** Whisper base was asked for but tiny is running: the browser has no WebGPU, or base failed to load on it. */
  fellBack?: 'no-webgpu' | 'base-failed';
}

/**
 * What to tell a player whose browser could not run Whisper base, for their browser (from the user agent).
 * Browser support as of late 2026, from memory: Chrome and Edge have WebGPU on Windows, macOS and ChromeOS
 * (needs graphics acceleration on), behind a flag on Linux; Safari 26 has it; Firefox on Windows, elsewhere
 * behind dom.webgpu.enabled.
 */
export function webGpuHint(reason: 'no-webgpu' | 'base-failed', ua: string): string {
  if (reason === 'base-failed')
    return 'WebGPU is there, but Whisper base failed to load on it (often the graphics driver or memory). Updating the graphics driver, or closing other tabs, may help.';
  const how = /Firefox\//.test(ua)
    ? 'In Firefox, open about:config and set dom.webgpu.enabled to true.'
    : /Edg\/|Chrome\//.test(ua)
      ? /Linux/.test(ua) && !/Android|CrOS/.test(ua)
        ? 'In Chrome or Edge on Linux, open chrome://flags (edge://flags), enable "Unsafe WebGPU Support" and "Vulkan", and restart the browser.'
        : 'In Chrome or Edge, turn on Settings → System → "Use graphics acceleration when available", and update the browser.'
      : /Safari\//.test(ua)
        ? 'Safari has WebGPU from version 26: update macOS or Safari.'
        : 'A recent Chrome, Edge or Safari has WebGPU built in.';
  return `This browser has no WebGPU, so voice uses the smaller, less accurate Whisper tiny. ${how}`;
}

export const VOICE_OFF: VoiceState = { status: 'off', progress: 0, partial: '' };
