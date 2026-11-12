/**
 * The desk chair under a body (docs/living-life.md): its seat sinks, its back gives, the whole
 * chair rocks on its base and comes to rest. Three springs, no physics engine. The page plays
 * the result on the chair's two shape keys (`seat_sink`, `back_recline`, made in Blender by
 * scripts/living-room/reference_models.py) and on its tilt; the body rides the seat's drop.
 *
 * A cartoon chair: a drop onto it pushes the seat past where it rests (it overshoots and comes
 * back up), the back flexes a beat later, and the chair keeps rocking a moment after the body
 * has stopped. Getting up, the seat comes back slowly and does not bounce far.
 */
export const CHAIR = {
  /** How far the seat's top goes down under a seated body (metres, at sink 1). */
  seatDepth: 0.035,
  /** The back's tilt at recline 1 (radians, applied by the shape key's own size). */
  sink: { stiff: 13, damp: 0.3 },
  rise: { stiff: 4.2, damp: 0.92 },
  recline: { stiff: 8, damp: 0.34 },
  rock: { stiff: 9, damp: 0.16 },
} as const;

export interface ChairState {
  sink: number;
  sinkSpeed: number;
  recline: number;
  reclineSpeed: number;
  /** The chair's tilt back and forth on its base (radians, + back). */
  rock: number;
  rockSpeed: number;
  /** The seat's drop now, metres (what the sitter rides). */
  drop: number;
}

export interface ChairInput {
  dt: number;
  /** 0 empty, 1 sat in. */
  seated: number;
  /** A drop onto the seat (how hard; 1 a plain sit-down): kicked once, the frame it happens. */
  impact?: number;
  /** Leaning back into the backrest (0–1). */
  lean?: number;
}

export const startChair = (): ChairState => ({
  sink: 0,
  sinkSpeed: 0,
  recline: 0,
  reclineSpeed: 0,
  rock: 0,
  rockSpeed: 0,
  drop: 0,
});

/** A spring stepped in small fixed slices: the same wobble at any frame rate. */
function spring(value: number, speed: number, goal: number, stiff: number, damp: number, dt: number) {
  for (let left = dt; left > 1e-6; left -= 1 / 240) {
    const h = Math.min(1 / 240, left);
    speed += (-stiff * stiff * (value - goal) - 2 * damp * stiff * speed) * h;
    value += speed * h;
  }
  return [value, speed] as const;
}

export function stepChair(state: ChairState, input: ChairInput): ChairState {
  const dt = Math.min(0.1, Math.max(0, Number.isFinite(input.dt) ? input.dt : 0));
  const seated = Math.min(1, Math.max(0, input.seated));
  let { sinkSpeed, reclineSpeed, rockSpeed } = state;
  const impact = Math.max(0, input.impact ?? 0);
  // The drop: the seat is thrown down, the back is thrown back, the chair tips back on its base.
  sinkSpeed += impact * 9;
  reclineSpeed += impact * 4.5;
  rockSpeed += impact * 0.55;
  const s = seated >= state.sink ? CHAIR.sink : CHAIR.rise;
  let sink: number, recline: number, rock: number;
  [sink, sinkSpeed] = spring(state.sink, sinkSpeed, seated, s.stiff, s.damp, dt);
  // The back follows the seat (a body leans on it once sat), and more when leant on.
  [recline, reclineSpeed] = spring(
    state.recline,
    reclineSpeed,
    seated * (0.35 + 0.65 * Math.min(1, Math.max(0, input.lean ?? 0))),
    CHAIR.recline.stiff,
    CHAIR.recline.damp,
    dt,
  );
  [rock, rockSpeed] = spring(state.rock, rockSpeed, 0, CHAIR.rock.stiff, CHAIR.rock.damp, dt);
  sink = Math.min(1.6, Math.max(-0.3, sink));
  recline = Math.min(1.6, Math.max(-0.3, recline));
  rock = Math.min(0.2, Math.max(-0.2, rock));
  // At rest exactly (the page then stops writing the chair).
  if (Math.abs(rock) < 1e-5 && Math.abs(rockSpeed) < 1e-4) rock = rockSpeed = 0;
  return { sink, sinkSpeed, recline, reclineSpeed, rock, rockSpeed, drop: sink * CHAIR.seatDepth };
}
