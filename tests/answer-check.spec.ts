import { test, expect } from '@playwright/test';
import { ANSWER_CHECK_MS, SWEEP_GROUPS, TRUST_MS, createAnswerCheck } from '../src/host/answer-check';

// The source's use of the answer check, without the page: a read is trusted (shifted) while the
// oldest group's check is within ANSWER_CHECK_MS; past it a step runs, caught up past TRUST_MS.
// `moved` is the group whose control moved silently at `movedAt`; a step that compares it after
// the move finds it, as the source's comparison would.
function simulate(readTimes: number[], movedAt: number, moved: number) {
  const answer = createAnswerCheck();
  answer.readAll(0);
  for (const now of readTimes) {
    if (now - answer.oldest() > ANSWER_CHECK_MS) {
      for (const group of answer.due(now, now - answer.oldest() > TRUST_MS)) {
        if (group === moved && now >= movedAt) return { foundAt: now, stale: [] as number[] };
        answer.passed(group, now);
      }
      answer.roundDone();
    }
    // Trusted here: every group's last check must be within the bound.
    if (now - answer.oldest() > TRUST_MS) return { foundAt: undefined, stale: [now] };
    if (now >= movedAt && now - Math.max(movedAt, answer.checkedAt(moved)) > TRUST_MS)
      return { foundAt: undefined, stale: [now] };
  }
  return { foundAt: undefined, stale: [] as number[] };
}

/** A small seeded generator, so a failure names its case. */
const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

test('Codex sparse reads: a group compared before its control moved is not trusted past the bound', () => {
  // Whole read at 0, first group at 400, its control moves, the rest caught up at 799, read at 900.
  const answer = createAnswerCheck();
  answer.readAll(0);
  expect(answer.due(400, false)).toEqual([0]);
  answer.passed(0, 400);
  expect(answer.roundDone()).toBe(false);
  const caughtUp = answer.due(799, 799 - answer.oldest() > TRUST_MS);
  // Every group, the one this round compared at 400 included.
  expect(caughtUp).toEqual([0, 1, 2, 3, 4, 5]);
  for (const group of caughtUp) answer.passed(group, 799);
  expect(answer.roundDone()).toBe(true);
  expect(answer.checkedAt(0)).toBe(799);
  expect(simulate([400, 401, 799, 900, 1000], 401, 0)).toEqual({ foundAt: 799, stale: [] });
});

test('the end of a round is not a check of the groups it compared earlier', () => {
  const answer = createAnswerCheck();
  answer.readAll(0);
  for (let group = 0, now = 201; group < SWEEP_GROUPS; group++, now += 34) {
    expect(answer.due(now, false)).toEqual([group]);
    answer.passed(group, now);
  }
  expect(answer.roundDone()).toBe(true);
  expect(answer.oldest()).toBe(201);
});

test('continuous and sparse reads both keep every trusted read within 200ms plus one round', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const next = random(seed);
    // Continuous: one read a frame (8 to 34ms apart). Sparse: 50 to 700ms apart.
    const sparse = seed % 2 === 0;
    const reads: number[] = [];
    for (let now = 0; now < 4000;) reads.push((now += sparse ? 50 + next() * 650 : 8 + next() * 26));
    const movedAt = 100 + next() * 3000,
      moved = Math.floor(next() * SWEEP_GROUPS);
    const result = simulate(reads, movedAt, moved);
    expect(result.stale, `seed ${seed} (${sparse ? 'sparse' : 'continuous'})`).toEqual([]);
    // Continuous reads find the move within the bound plus the frame that reads it.
    if (!sparse) expect(result.foundAt! - movedAt, `seed ${seed}`).toBeLessThanOrEqual(TRUST_MS + 34);
  }
});

test('reads within one frame share one step; a caught-up step does not wait for the frame', () => {
  const answer = createAnswerCheck();
  answer.readAll(0);
  expect(answer.due(250, false)).toEqual([0]);
  answer.passed(0, 250);
  expect(answer.due(254, false)).toEqual([]);
  expect(answer.due(254, true)).toEqual([0, 1, 2, 3, 4, 5]);
});

test('a difference or a whole read restarts the round', () => {
  const answer = createAnswerCheck();
  answer.readAll(0);
  answer.due(250, false);
  answer.passed(0, 250);
  answer.changed();
  expect(answer.due(300, false)).toEqual([0]);
  answer.readAll(320);
  expect(answer.oldest()).toBe(320);
  expect(answer.due(530, false)).toEqual([0]);
});
