/**
 * The music, heard (docs/living-live.md). From how loud the low, the middle and the high of the
 * sound are each frame: how lively the music is now against how loud it has been (`energy`), the
 * moments a beat lands (`onset`, and `pulse`, which falls away after each), the tempo, and a beat
 * clock that keeps counting between the beats and is pulled back into step by each one (`beat`:
 * whole numbers fall on the beats). The resident's body moves on that clock.
 *
 * Pure: no audio here, only numbers. (The page reads them from an analyser on the tab's sound.)
 */
export interface Bands {
  dt: number;
  /** 0–1 each: how loud the bass (the kick), the middle (voices) and the high (cymbals) are. */
  bass: number;
  mid: number;
  high: number;
}

export interface BeatState {
  energy: number;
  onset: boolean;
  pulse: number;
  beat: number;
  bpm: number;
  /** 0–1: how regular the beats have been (a free piece or speech stays low). */
  confidence: number;
  // (What it keeps to hear by.)
  level: number;
  peak: number;
  bassMean: number;
  bassPeak: number;
  lastBass: number;
  sinceOnset: number;
  gaps: readonly number[];
}

export const startBeat = (): BeatState => ({
  energy: 0,
  onset: false,
  pulse: 0,
  beat: 0,
  bpm: 120,
  confidence: 0,
  level: 0,
  peak: 0,
  bassMean: 0,
  bassPeak: 0,
  lastBass: 0,
  sinceOnset: 10,
  gaps: [],
});

/** No two beats nearer than this (seconds): a kick's own tail is not a second kick. */
const REFRACTORY_S = 0.23;
const SILENT = 1e-3;
/**
 * How loud the loud part of a song is, in these numbers, with the player's own volume full
 * (measured on real videos: a chorus reads 0.2–0.23 at its peaks, a soft opening 0.06).
 */
const FULL = 0.2;

export function stepBeat(state: BeatState, bands: Bands): BeatState {
  const dt = Math.min(0.25, Math.max(0, bands.dt));
  const bass = Math.max(0, bands.bass),
    total = 0.6 * bass + 0.3 * Math.max(0, bands.mid) + 0.1 * Math.max(0, bands.high);
  // How loud it is, over most of a second; and the loudest it has been lately (it forgets slowly,
  // so a quiet passage reads as quiet, and a track turned down reads the same as one turned up).
  const level = state.level + (total - state.level) * (1 - Math.exp(-dt / 0.8));
  const peak = Math.max(total, state.peak * Math.exp(-dt / 25));
  const bassPeak = Math.max(bass, state.bassPeak * Math.exp(-dt / 25));
  const bassMean = state.bassMean + (bass - state.bassMean) * (1 - Math.exp(-dt / 0.4));

  // A beat: the bass leaps well over where it has been, and it is not the last beat's tail.
  let sinceOnset = state.sinceOnset + dt;
  const onset =
    bass > SILENT &&
    bass > state.lastBass &&
    bass > 1.5 * state.bassMean + 0.06 * bassPeak &&
    sinceOnset >= REFRACTORY_S;
  let { gaps, bpm, confidence, beat } = state;
  if (onset) {
    if (sinceOnset < 2) gaps = [...gaps.slice(-11), sinceOnset];
    sinceOnset = 0;
    if (gaps.length >= 3) {
      // The tempo: the middle one of the last gaps between beats, taken into the range people
      // dance in (a gap twice as long is the same tempo counted in halves).
      const sorted = [...gaps].sort((a, b) => a - b);
      let period = sorted[sorted.length >> 1]!;
      while (period < 1 / 3) period *= 2;
      while (period > 0.8) period /= 2;
      const regular = gaps.filter((g) => {
        const beats = g / period;
        return Math.abs(beats - Math.round(beats)) < 0.14 && Math.round(beats) >= 1;
      }).length;
      bpm = 60 / period;
      confidence = (regular / gaps.length) * Math.min(1, gaps.length / 6);
    }
  } else if (sinceOnset > 2.5) {
    // No beat for a while: what was known of the tempo fades.
    confidence *= Math.exp(-dt / 3);
    if (sinceOnset > 6) gaps = [];
  }
  // The clock runs at the tempo and each beat pulls it a third of the way back into step.
  beat += (dt * bpm) / 60;
  if (onset) beat += (Math.round(beat) - beat) * 0.35;

  // Against the loudest it has been, but never against less than a full mix is on YouTube (which
  // evens videos out to one loudness): a soft opening is soft, not "the loudest so far".
  const ratio = peak > SILENT ? level / Math.max(peak, FULL) : 0;
  const energy = peak > SILENT ? Math.min(1, Math.max(0, (1.6 * ratio ** 0.6 - 0.12) * (0.8 + 0.2 * confidence))) : 0;
  return {
    energy,
    onset,
    pulse: onset ? 1 : state.pulse * Math.exp(-dt / 0.16),
    beat,
    bpm,
    confidence,
    level,
    peak,
    bassMean,
    bassPeak,
    lastBass: bass,
    sinceOnset,
    gaps,
  };
}
