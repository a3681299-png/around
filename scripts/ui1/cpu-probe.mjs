/** Build-time banner: runs in the extension's isolated world, before any product module. */
export function cpuProbeBanner(busyMs = 0) {
  if (!Number.isFinite(busyMs) || busyMs < 0 || busyMs > 10) throw new Error('Probe load must be 0–10ms.');
  return `
const __ui1 = (globalThis.__ui1Probe ??= { calls: [], kinds: {}, frames: [], recording: true, top: performance.now() });
__ui1.start = __ui1.top;
if (!__ui1.installed) {
  __ui1.installed = true;
  const raf = window.requestAnimationFrame.bind(window);
  __ui1.raf = raf;
  let depth = 0;
  const wrap = (fn, kind) => function (...args) {
    const outer = depth++ === 0, start = performance.now();
    try { return fn.apply(this, args); }
    finally {
      depth--;
      if (__ui1.recording) {
        __ui1.kinds[kind] = (__ui1.kinds[kind] ?? 0) + 1;
        if (outer) __ui1.calls.push(start, performance.now() - start);
      }
    }
  };
  window.requestAnimationFrame = callback => raf(wrap(callback, 'raf'));
  for (const name of ['setTimeout','setInterval']) {
    const native = window[name].bind(window);
    window[name] = (callback, ms, ...rest) => native(typeof callback === 'function' ? wrap(callback, name) : callback, ms, ...rest);
  }
  if (window.queueMicrotask) {
    const native = window.queueMicrotask.bind(window);
    window.queueMicrotask = callback => native(wrap(callback, 'microtask'));
  }
  const nativeThen = Promise.prototype.then;
  Promise.prototype.then = function (yes, no) {
    return nativeThen.call(this, typeof yes === 'function' ? wrap(yes, 'promise') : yes, typeof no === 'function' ? wrap(no, 'promise') : no);
  };
  for (const name of ['MutationObserver','ResizeObserver','IntersectionObserver']) {
    const Base = window[name];
    if (Base) window[name] = class extends Base { constructor(callback, options) { super(wrap(callback, name), options); } };
  }
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener, wrapped = new WeakMap();
  const listenerOf = listener => {
    if (!listener) return listener;
    let value = wrapped.get(listener);
    if (!value) {
      value = typeof listener === 'function' ? wrap(listener, 'event') : { handleEvent: wrap(event => listener.handleEvent(event), 'event-object') };
      wrapped.set(listener, value);
    }
    return value;
  };
  EventTarget.prototype.addEventListener = function(type, listener, options) { return add.call(this, type, listenerOf(listener), options); };
  EventTarget.prototype.removeEventListener = function(type, listener, options) { return remove.call(this, type, wrapped.get(listener) ?? listener, options); };
  if (HTMLVideoElement.prototype.requestVideoFrameCallback) {
    const native = HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) { return native.call(this, wrap(callback, 'video-frame')); };
  }
  // Chrome events do not implement EventTarget. Keep listener identity for removal and hasListener.
  for (const event of [globalThis.chrome?.runtime?.onMessage, globalThis.chrome?.storage?.onChanged]) if (event) {
    const nativeAdd = event.addListener.bind(event), nativeRemove = event.removeListener.bind(event), nativeHas = event.hasListener.bind(event), listeners = new WeakMap();
    event.addListener = listener => { let value = listeners.get(listener); if (!value) listeners.set(listener, value = wrap(listener, 'chrome-event')); nativeAdd(value); };
    event.removeListener = listener => nativeRemove(listeners.get(listener) ?? listener);
    event.hasListener = listener => nativeHas(listeners.get(listener) ?? listener);
  }
  const pump = () => { if (__ui1.recording) __ui1.frames.push(performance.now()); raf(pump); };
  raf(pump);
  __ui1.begin = () => { __ui1.start = performance.now(); __ui1.calls = []; __ui1.frames = []; __ui1.kinds = {}; __ui1.recording = true; };
  __ui1.end = () => { __ui1.recording = false; return { calls: __ui1.calls, frames: [__ui1.start, ...__ui1.frames, performance.now()], kinds: __ui1.kinds }; };
  __ui1.calibrationMs = ${busyMs};
  if (${busyMs} > 0) {
    const busy = () => { const start = performance.now(); while (performance.now() - start < ${busyMs}) {} window.requestAnimationFrame(busy); };
    window.requestAnimationFrame(busy);
  }
}
`;
}
export const cpuProbeFooter = `if (__ui1.recording) { __ui1.calls.push(__ui1.top, performance.now() - __ui1.top); __ui1.kinds.load = 1; }`;
