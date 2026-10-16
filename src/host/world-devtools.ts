import { WORLD_DEVTOOLS } from './world-options';
import { createWorldRecorder, replayWorld, type WorldRecording } from '../world/recording';
import type { WorldEvent, WorldFrame, WorldInput, WorldScene, WorldState } from '../world/types';

export interface WorldDebugApi {
  startRecording(): void;
  stopRecording(): WorldRecording | undefined;
  status(): ReturnType<ReturnType<typeof createWorldRecorder>['status']>;
  replay(value: unknown): ReturnType<typeof replayWorld>;
  frame(): WorldFrame | undefined;
}
/** Only installed in an explicit developer build, inside the isolated script world. */
export function createWorldDevtools(doc: Document, session: {
  scene(): WorldScene | undefined; state(): WorldState; frame(): WorldFrame | undefined; refresh(): void; schedule(): void;
}) {
  if (!WORLD_DEVTOOLS) return undefined;
  const lifetime = globalThis as typeof globalThis & { __wwWorldRuntime?: WorldDebugApi };
  const recorder = createWorldRecorder();
  let clicks: WorldEvent[] = [], closed = false, listening = false;
  const onClick = (event: MouseEvent) => {
    if (!recorder.active || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    // Never inspect values, text, keys or URLs. Authoring controls keep their native use.
    if (event.composedPath().some((node) => node instanceof Element && (node.hasAttribute('data-ww-signal-control')
      || node.matches('input, textarea, select, [contenteditable]')))) return;
    if (clicks.length === 64) clicks.shift(); clicks.push({ type: 'pointer.click', point: { x: event.clientX, y: event.clientY } }); session.schedule();
  };
  const sync = () => {
    if (listening === recorder.active) return;
    listening = recorder.active;
    if (listening) doc.addEventListener('click', onClick, { capture: true, passive: true });
    else { doc.removeEventListener('click', onClick, true); clicks = []; }
  };
  const api: WorldDebugApi = {
    startRecording() {
      const scene = session.scene();
      if (closed || !scene) throw new Error('World Runtime is not mounted.');
      recorder.start(scene, session.state()); sync(); session.refresh();
    },
    stopRecording() { const value = recorder.stop(); sync(); if (!closed) session.refresh(); return value; },
    status: recorder.status,
    replay: replayWorld,
    frame: session.frame,
  };
  lifetime.__wwWorldRuntime = api;
  return {
    get active() { return recorder.active; },
    takeEvents() { const next = clicks; clicks = []; return next; },
    capture(scene: WorldScene, input: WorldInput) {
      if (!recorder.active) return;
      try { recorder.capture(scene, input); }
      catch { recorder.stop('invalid-input'); }
      sync();
    },
    destroy() {
      closed = true; recorder.clear(); sync(); clicks = [];
      if (lifetime.__wwWorldRuntime === api) delete lifetime.__wwWorldRuntime;
    },
  };
}
