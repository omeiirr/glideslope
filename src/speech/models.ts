/** Where models come from. All are fetched by the browser on first use and cached; see THIRD_PARTY.md. */

/** Piper multi-speaker English voice (VCTK corpus, CC BY 4.0): one download, many accents. */
export const PIPER_MODEL =
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/vctk/medium/en_GB-vctk-medium.onnx';

/**
 * Speakers used for pilots: [speaker id in the model, speed factor].
 * Accents per the VCTK speaker list: English, Scottish, Irish, American, Indian, Australian.
 */
export const PILOT_VOICES: [number, number][] = [
  [95, 0.95], // p226 English, male
  [102, 1.0], // p237 Scottish, male
  [97, 0.95], // p245 Irish, male
  [38, 0.9], // p311 American, male
  [92, 1.0], // p251 Indian, male
  [71, 0.95], // p326 Australian, male
  [107, 0.95], // p225 English, female
  [39, 0.9], // p294 American, female
];

/** Speech recognisers: Whisper (OpenAI, MIT) and Moonshine (Useful Sensors, MIT). */
export const ASR_MODELS = {
  /** ~206 MB: fp32 encoder + 4-bit decoder, the combination that runs well on WebGPU. */
  base: {
    repo: 'Xenova/whisper-base.en',
    device: 'webgpu',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  },
  /** ~41 MB: 8-bit, for machines without WebGPU. */
  tiny: { repo: 'Xenova/whisper-tiny.en', device: 'wasm', dtype: 'q8' },
  /** ~64 MB, 8-bit: about twice as fast as Whisper tiny on the CPU, but it takes no prompt (see DECISIONS.md). */
  moonshine: { repo: 'onnx-community/moonshine-base-ONNX', device: 'wasm', dtype: 'q8' },
} as const;
export type AsrModel = keyof typeof ASR_MODELS;
export const ASR_NAME: Record<AsrModel, string> = {
  base: 'Whisper base',
  tiny: 'Whisper tiny',
  moonshine: 'Moonshine base',
};

/** Absolute URL of the self-hosted runtime files (public/vendor/). */
export const vendorBase = () => new URL('./vendor/', document.baseURI).href;

export const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
