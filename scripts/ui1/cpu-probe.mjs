/** Build-time banner: runs in the extension's isolated world, before any product module. */
export function cpuProbeBanner(busyMs = 0, afterAwait = false) {
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
  if (window.requestIdleCallback) {
    const native = window.requestIdleCallback.bind(window);
    window.requestIdleCallback = (callback, options) => native(wrap(callback, 'idle'), options);
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
  // IDB and MessagePort commonly use on* properties rather than addEventListener. Their
  // setters live on isolated-world prototypes; preserve the original callback on reads.
  const originals = new WeakMap();
  for (const [name, properties] of Object.entries({
    IDBRequest: ['onsuccess', 'onerror'], IDBOpenDBRequest: ['onupgradeneeded', 'onblocked'],
    IDBTransaction: ['oncomplete', 'onabort', 'onerror'], IDBDatabase: ['onversionchange', 'onclose'],
    MessagePort: ['onmessage', 'onmessageerror'], HTMLMediaElement: ['onloadeddata', 'onerror']
  })) for (const property of properties) {
    let owner = window[name]?.prototype;
    while (owner && !Object.hasOwn(owner, property)) owner = Object.getPrototypeOf(owner);
    const descriptor = owner && Object.getOwnPropertyDescriptor(owner, property);
    if (!descriptor?.set || !descriptor.configurable) continue;
    Object.defineProperty(owner, property, { ...descriptor,
      get() { const fn = descriptor.get.call(this); return originals.get(fn) ?? fn; },
      set(fn) { const measured = typeof fn === 'function' ? wrap(fn, 'event-property') : fn; if (typeof fn === 'function') originals.set(measured, fn); descriptor.set.call(this, measured); }
    });
  }
  if (HTMLVideoElement.prototype.requestVideoFrameCallback) {
    const native = HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) { return native.call(this, wrap(callback, 'video-frame')); };
  }
  // Chrome events do not implement EventTarget. Keep listener identity for removal and hasListener.
  const chromeEvents = new WeakSet();
  const instrumentChromeEvent = (event, acceptsPort = false) => { if (event && !chromeEvents.has(event)) {
    chromeEvents.add(event);
    const nativeAdd = event.addListener.bind(event), nativeRemove = event.removeListener.bind(event), nativeHas = event.hasListener.bind(event), listeners = new WeakMap();
    event.addListener = listener => { let value = listeners.get(listener); if (!value) listeners.set(listener, value = wrap(acceptsPort ? function(port, ...rest) { instrumentChromeEvent(port?.onMessage); instrumentChromeEvent(port?.onDisconnect); return listener.call(this, port, ...rest); } : listener, 'chrome-event')); nativeAdd(value); };
    event.removeListener = listener => nativeRemove(listeners.get(listener) ?? listener);
    event.hasListener = listener => nativeHas(listeners.get(listener) ?? listener);
  }};
  instrumentChromeEvent(globalThis.chrome?.runtime?.onMessage);
  instrumentChromeEvent(globalThis.chrome?.runtime?.onConnect, true);
  instrumentChromeEvent(globalThis.chrome?.storage?.onChanged);
  const pump = () => { if (__ui1.recording) __ui1.frames.push(performance.now()); raf(pump); };
  raf(pump);
  __ui1.begin = () => { __ui1.start = performance.now(); __ui1.calls = []; __ui1.frames = []; __ui1.kinds = {}; __ui1.recording = true; };
  __ui1.end = () => { __ui1.recording = false; return { calls: __ui1.calls, frames: [__ui1.start, ...__ui1.frames, performance.now()], kinds: __ui1.kinds }; };
  __ui1.calibrationMs = ${busyMs};
  if (${busyMs} > 0) {
    const busy = ${afterAwait ? 'async' : ''} () => { ${afterAwait ? 'await Promise.resolve();' : ''} const start = performance.now(); while (performance.now() - start < ${busyMs}) {} window.requestAnimationFrame(busy); };
    window.requestAnimationFrame(busy);
  }
}
`;
}
export const cpuProbeFooter = `if (__ui1.recording) { __ui1.calls.push(__ui1.top, performance.now() - __ui1.top); __ui1.kinds.load = 1; }`;
