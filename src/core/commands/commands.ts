/** The only way to change aircraft state from outside the core. */
export type Command =
  | { type: 'identify' }
  /** "Roger PAN", "roger minimum fuel": acknowledges a priority call; nothing changes. */
  | { type: 'acknowledge'; what: 'pan' | 'fuel' }
  /** `by`: given as a relative turn ("turn left 20 degrees"); `heading` is where that ends. */
  | { type: 'heading'; heading: number; turn?: 'left' | 'right'; by?: number }
  | { type: 'presentHeading' }
  /** `altitude` is always feet; `fl` records whether it was given as a flight level. */
  | { type: 'altitude'; altitude: number; fl: boolean; qnh?: number }
  | { type: 'speed'; speed: number; untilDme?: number }
  | { type: 'resumeSpeed'; noRestrictions?: boolean }
  /** "Reduce to minimum approach speed". */
  | { type: 'minimumSpeed' }
  /** "Expedite climb / descent": faster than normal until reaching the cleared level. */
  | { type: 'expedite'; climb: boolean }
  /** "Descend at 2000 feet per minute [or greater / or less]", until reaching the cleared level. */
  | { type: 'rate'; fpm: number; limit?: 'greater' | 'less' }
  /** "Report heading / level / speed": the pilot answers with the actual value. */
  | { type: 'report'; what: 'heading' | 'level' | 'speed' }
  | { type: 'direct'; fix: string }
  | { type: 'ils'; runway: string }
  | { type: 'hold'; fix: string }
  | { type: 'handoff'; to: 'tower' | 'radar' | 'ground' | 'departure' }
  | { type: 'goAround' }
  | { type: 'sayAgain' }
  // tower
  | { type: 'land'; runway: string }
  | { type: 'continueApproach' }
  /** Leave the runway via a named exit, or the first one on a side, or the pilot's choice. */
  | { type: 'vacate'; exit?: string; side?: 'left' | 'right' }
  /** `behind`: conditional line-up, after the described traffic ("behind the departing A320, …, behind"). */
  /** `immediate`: "…, be ready for immediate departure". */
  | { type: 'lineUp'; runway: string; behind?: Condition; immediate?: boolean }
  /** `immediate`: "cleared for immediate take-off": no delay, and a rolling take-off from the holding point. */
  | { type: 'takeoff'; runway: string; immediate?: boolean }
  /** "Expedite vacating": brake harder for an earlier exit, and leave the runway faster. */
  | { type: 'expediteVacate' }
  /** "Hold position" / "cancel take-off": stop, or stay put. */
  | { type: 'cancelTakeoff' }
  /** Traffic information ("traffic, A321 on short final"): no change; the pilot reports it in sight. */
  | { type: 'trafficInfo'; desc: string };

/** The traffic a conditional clearance waits for: what it is doing and how it was described ("A320", may be ""). */
export interface Condition {
  traffic: 'departing' | 'landing';
  desc: string;
}

export type CommandType = Command['type'];

export interface CommandResult {
  ok: boolean;
  /** Short pilot-style reason when not ok, e.g. "unable, speed too low". */
  reason?: string;
}
