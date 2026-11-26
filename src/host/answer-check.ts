// The timing of the operation source's answer check in groups (D14②), apart from the page so its
// bound can be checked without one: which groups a read compares, and how old each group's last
// comparison is. The source does the comparing (src/host/operation-source.ts).

/** Changes inside this window after a read wait for its end; callers hold drawing meanwhile. */
export const COALESCE_MS = 200;
/** How long only shiftable changes (a page scroll, checked looks, checked subtrees) wait before
 * the answer check starts a round (D14③ compared 1000ms; see docs/g13-plan.md). */
export const ANSWER_CHECK_MS = COALESCE_MS;
/** The answer check in groups (D14②): six groups, one per frame, a round in about 100ms at 60fps. */
export const SWEEP_GROUPS = 6;
/** Reads less than this apart belong to one frame (they share one group's check). */
const SWEEP_FRAME_MS = 8;
/** A round advances by time, not by reads: at least one group per read, and as many as two frames
 * a group have come due, so a round ends in SWEEP_GROUPS × this however seldom the page is read. */
const SWEEP_GROUP_MS = 2 * 17;
/** How old the least recently checked group (by a whole read or a round of groups) may be for a
 * read to be shifted and trusted: the window, then a round. A control that moves without any
 * mutation is found within it; past it (a quiet spell, sparse reads), every group is checked in
 * that read before the shifted read is used (G1.3 verification and its fix verification). */
export const TRUST_MS = ANSWER_CHECK_MS + SWEEP_GROUPS * SWEEP_GROUP_MS;

export function createAnswerCheck() {
  // Each group's own last check. A round's end is not a check of the groups it compared earlier:
  // stamping them all with the end time let a control moved after its group's check keep its old
  // box for 500ms (G1.3 fix verification, sparse reads).
  const checkedAt: number[] = Array(SWEEP_GROUPS).fill(-Infinity);
  let next = 0,
    stepAt = -Infinity,
    roundStart = 0;
  return {
    /** The read is only as current as its least recently checked group. */
    oldest: () => Math.min(...checkedAt),
    checkedAt: (group: number) => checkedAt[group]!,
    /** The groups to compare in this read, in order; none for a second read in the same frame.
     * `catchUp` (the oldest check is past TRUST_MS): every group, those this round already
     * compared included, since their checks are as old as the round. */
    due(now: number, catchUp: boolean): number[] {
      if (!catchUp && now - stepAt < SWEEP_FRAME_MS) return [];
      stepAt = now;
      if (catchUp) next = 0;
      if (!next) roundStart = now;
      const end = catchUp
        ? SWEEP_GROUPS
        : Math.max(next + 1, Math.min(SWEEP_GROUPS, 1 + Math.floor((now - roundStart) / SWEEP_GROUP_MS)));
      return Array.from({ length: end - next }, (_, i) => next + i);
    },
    /** A due group matched the page. */
    passed(group: number, now: number) {
      checkedAt[group] = now;
      next = group + 1;
    },
    /** Whether every group has passed since the round started; the next step starts a new one. */
    roundDone() {
      if (next < SWEEP_GROUPS) return false;
      next = 0;
      return true;
    },
    /** A group differed: the page is read whole, and the next round starts from the first group. */
    changed() {
      next = 0;
    },
    /** A whole read checked every group. */
    readAll(now: number) {
      checkedAt.fill(now);
      next = 0;
    },
  };
}
