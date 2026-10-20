import type { WorldState } from './types';

/** A restored take may use another page's performance clock. Preserve its pose,
 * but rebase absolute fade/pointer timestamps before returning to a younger host. */
export function rebaseWorldClock(state: WorldState, timeMs: number): WorldState {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error('Invalid host clock.');
  if (state.timeMs === null || state.timeMs <= timeMs) return state;
  const offset = timeMs - state.timeMs;
  return {
    ...state,
    timeMs,
    effects: {
      ...state.effects,
      fades: Object.fromEntries(
        Object.entries(state.effects.fades).map(([id, fade]) => [
          id,
          state.timeMs! >= fade.start + fade.duration
            ? { ...fade, from: fade.to, start: timeMs }
            : { ...fade, start: fade.start + offset },
        ]),
      ),
    },
    ...(state.motion
      ? {
          motion: {
            ...state.motion,
            ...(state.motion.pointer
              ? {
                  pointer: {
                    ...state.motion.pointer,
                    speed: state.motion.pointer.timeMs + offset < 0 ? 0 : state.motion.pointer.speed,
                    timeMs: Math.max(0, state.motion.pointer.timeMs + offset),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}
