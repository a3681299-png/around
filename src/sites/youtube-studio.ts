import styles from './youtube-studio.css';
import type { StudioInsets, StudioHostLayout, StudioLayoutAdapter } from '../studio/layout-types';

const attributes = [
  'data-ww-inpage-studio',
  'data-ww-studio-layout',
  'data-ww-studio-fullscreen',
  'data-ww-studio-compact',
];
const variables = ['left', 'right', 'top', 'bottom'].map((side) => `--ww-studio-${side}`);

/** YouTube layout only. Neither the page tree nor saved artwork is rewritten. */
export function mountYouTubeStudio(doc: Document, changed: (state: StudioHostLayout) => void): StudioLayoutAdapter {
  const view = doc.defaultView!,
    root = doc.documentElement;
  const previousAttributes = attributes.map((key) => [key, root.getAttribute(key)] as const);
  const previousVariables = variables.map(
    (key) => [key, root.style.getPropertyValue(key), root.style.getPropertyPriority(key)] as const,
  );
  const sheet = doc.createElement('style');
  sheet.id = 'web-world-themes-studio-layout';
  sheet.textContent = styles;
  (doc.head ?? root).append(sheet);
  let insets: StudioInsets = { left: 0, right: 0, top: 56, bottom: 24 },
    frame: number | undefined,
    alive = true,
    key = '';
  let state: StudioHostLayout = {
    mode: 'unavailable',
    canvas: { left: 0, top: 0, width: view.innerWidth, height: view.innerHeight },
  };
  let observed: Element[] = [];
  const resize = new ResizeObserver(() => schedule());
  function measure() {
    frame = undefined;
    if (!alive) return;
    const app = doc.querySelector('ytd-app'),
      player = doc.querySelector('#movie_player'),
      masthead = doc.querySelector('ytd-masthead');
    const nodes = [app, player, masthead].filter((node): node is Element => Boolean(node));
    if (nodes.length !== observed.length || nodes.some((node, i) => node !== observed[i])) {
      resize.disconnect();
      nodes.forEach((node) => resize.observe(node));
      observed = nodes;
    }
    const fullscreen = Boolean(doc.fullscreenElement || doc.querySelector('ytd-watch-flexy[fullscreen]'));
    const mode = fullscreen ? 'fullscreen' : app ? 'reserved' : 'unavailable';
    const left = fullscreen ? 0 : insets.left,
      right = fullscreen ? 0 : insets.right,
      top = fullscreen ? 0 : insets.top,
      bottom = fullscreen ? 0 : insets.bottom;
    root.setAttribute('data-ww-inpage-studio', '');
    root.setAttribute('data-ww-studio-layout', mode);
    root.toggleAttribute('data-ww-studio-fullscreen', fullscreen);
    root.toggleAttribute('data-ww-studio-compact', view.innerWidth - left - right < 1100);
    for (const [side, value] of Object.entries(insets)) {
      const name = `--ww-studio-${side}`,
        text = `${value}px`;
      if (root.style.getPropertyValue(name) !== text) root.style.setProperty(name, text);
    }
    state = {
      mode,
      canvas: {
        left,
        top,
        width: Math.max(0, view.innerWidth - left - right),
        height: Math.max(0, view.innerHeight - top - bottom),
      },
    };
    const rect = player?.getBoundingClientRect();
    const next = JSON.stringify([state, rect ? [rect.x, rect.y, rect.width, rect.height] : null]);
    if (next !== key) {
      key = next;
      changed(state);
    }
  }
  function schedule() {
    if (alive && frame === undefined) frame = view.requestAnimationFrame(measure);
  }
  const boundary = 'ytd-app, #movie_player, ytd-masthead';
  const observer = new MutationObserver((records) => {
    // Comments, counters and other page content do not change the workspace.
    if (
      observed.some((node) => !node.isConnected) ||
      records.some(
        (record) =>
          record.type === 'attributes' ||
          [...record.addedNodes].some(
            (node) => node instanceof Element && (node.matches(boundary) || node.querySelector(boundary)),
          ),
      )
    )
      schedule();
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['theater', 'fullscreen'],
  });
  const events = ['yt-navigate-finish', 'yt-page-data-updated', 'fullscreenchange'];
  events.forEach((event) => doc.addEventListener(event, schedule));
  view.addEventListener('resize', schedule);
  view.addEventListener('pageshow', schedule);
  measure();
  return {
    update(value) {
      if (!Object.values(value).every((number) => Number.isFinite(number) && number >= 0 && number <= 600))
        throw new Error('制作パネルの領域が不正です。');
      insets = { ...value };
      schedule();
    },
    state: () => ({ mode: state.mode, canvas: { ...state.canvas } }),
    destroy() {
      if (!alive) return;
      alive = false;
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      events.forEach((event) => doc.removeEventListener(event, schedule));
      view.removeEventListener('resize', schedule);
      view.removeEventListener('pageshow', schedule);
      sheet.remove();
      previousAttributes.forEach(([name, value]) =>
        value === null ? root.removeAttribute(name) : root.setAttribute(name, value),
      );
      previousVariables.forEach(([name, value, priority]) =>
        value ? root.style.setProperty(name, value, priority) : root.style.removeProperty(name),
      );
    },
  };
}

/** A floating toolbar must yield even to faded native controls on short windows. */
export function protectYouTubeStudioToolbar(doc: Document, toolbar: HTMLElement): () => void {
  const view = doc.defaultView!;
  let frame: number | undefined,
    alive = true,
    controls: Element | null = null;
  const resize = new ResizeObserver(schedule);
  resize.observe(toolbar);
  function measure() {
    frame = undefined;
    if (!alive) return;
    const next = doc.querySelector('#movie_player .ytp-chrome-bottom');
    if (next !== controls) {
      if (controls) resize.unobserve(controls);
      controls = next;
      if (controls) resize.observe(controls);
    }
    const a = toolbar.getBoundingClientRect(),
      b = controls?.getBoundingClientRect();
    const overlap = Boolean(
      b &&
      b.width &&
      b.height &&
      a.width &&
      a.height &&
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top,
    );
    toolbar.toggleAttribute('data-native-overlap', overlap);
  }
  function schedule() {
    if (alive && frame === undefined) frame = view.requestAnimationFrame(measure);
  }
  const events = ['yt-navigate-finish', 'yt-page-data-updated', 'fullscreenchange'];
  events.forEach((name) => doc.addEventListener(name, schedule));
  view.addEventListener('scroll', schedule, { passive: true });
  view.addEventListener('resize', schedule);
  schedule();
  return () => {
    alive = false;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    resize.disconnect();
    events.forEach((name) => doc.removeEventListener(name, schedule));
    view.removeEventListener('scroll', schedule);
    view.removeEventListener('resize', schedule);
    toolbar.removeAttribute('data-native-overlap');
  };
}
