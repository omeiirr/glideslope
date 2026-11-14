/** The only way to change aircraft state from outside the core. */
export type Command =
  | { type: 'identify' }
  | { type: 'heading'; heading: number; turn?: 'left' | 'right' }
  | { type: 'presentHeading' }
  /** `altitude` is always feet; `fl` records whether it was given as a flight level. */
  | { type: 'altitude'; altitude: number; fl: boolean; qnh?: number }
  | { type: 'speed'; speed: number; untilDme?: number }
  | { type: 'resumeSpeed' }
  | { type: 'direct'; fix: string }
  | { type: 'ils'; runway: string }
  | { type: 'hold'; fix: string }
  | { type: 'handoff'; to: 'tower' | 'radar' }
  | { type: 'goAround' }
  | { type: 'sayAgain' };

export type CommandType = Command['type'];

export interface CommandResult {
  ok: boolean;
  /** Short pilot-style reason when not ok, e.g. "unable, speed too low". */
  reason?: string;
}
