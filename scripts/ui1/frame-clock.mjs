/** Start before the site's scripts, rather than when the document-idle content script arrives.
 * The isolated-world probe still owns CPU attribution; this clock only supplies frame boundaries. */
export async function installFrameClock(page) {
  await page.addInitScript(() => {
    const clock = { timeOrigin: performance.timeOrigin, frames: [] };
    globalThis.__ui1FrameClock = clock;
    const frame = (time) => {
      clock.frames.push(time);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

export function frameWindow(start, end, times) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Invalid CPU capture window.');
  const inside = times.filter((time) => time > start && time < end);
  if (inside.some((time, index) => !Number.isFinite(time) || (index && time <= inside[index - 1])))
    throw new Error('Frame timestamps must increase.');
  return [start, ...inside, end];
}

export async function sampleFrameClock(page, sample, origin, startup = false) {
  const end = sample.frames.at(-1);
  const clock = await page.evaluate(() => {
    const value = globalThis.__ui1FrameClock;
    if (!value) throw new Error('Missing document-start frame clock.');
    return value;
  });
  if (clock.timeOrigin !== origin) throw new Error('CPU and frame clocks belong to different documents.');
  const start = startup ? 0 : sample.frames[0];
  return {
    ...sample,
    frames: frameWindow(start, end, clock.frames),
    clock: {
      source: 'document-start-main-world-raf-timestamps',
      timeOrigin: origin,
      start,
      end,
      originalProbeStart: sample.frames[0],
      originalProbeFrameCount: sample.frames.length - 1,
      beforeExtensionFrames: clock.frames.filter((time) => time >= start && time < sample.frames[0]).length,
    },
  };
}
