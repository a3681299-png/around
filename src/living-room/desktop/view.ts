/**
 * The virtual desktop on the page (docs/living-desktop.md): glass windows over the room. Each
 * window blurs what is behind it (the room's canvas), so the UI lifts off a clouded background
 * while the room around it stays sharp: the resident can be seen coming up to a window.
 *
 * Everything is built with DOM calls from fixed strings (no markup from data). The state is
 * state.ts; this draws it and turns pointer and keyboard input into its actions.
 */
import {
  APPS,
  WALLPAPERS,
  focused,
  reduceDesktop,
  startDesktop,
  type AppId,
  type DesktopAction,
  type DesktopState,
} from './state';

export interface DesktopView {
  state(): DesktopState;
  dispatch(action: DesktopAction): void;
  /** The frame of the window in front, in CSS pixels (undefined: closed, or no window). */
  frontRect(): DOMRect | undefined;
  /** The resident's hand landed on the window in front: it gives a little. */
  nudge(): void;
  /** What the resident is doing, for its window (undefined: this build has no resident). */
  setResident(text: string | undefined): void;
  /** The mirror's state, for its window. */
  setMirror(state: 'off' | 'asking' | 'on' | 'refused' | 'unsupported'): void;
  readonly mirrorVideo: HTMLVideoElement;
}

export interface DesktopHooks {
  changed(state: DesktopState, action: DesktopAction): void;
  /** The mirror's button: start (true) or stop. */
  mirror(on: boolean): void;
  /** A press on the window in front (the resident may be holding it). */
  pressed(id: AppId): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Small line icons, drawn from fixed paths. */
const ICONS: Record<AppId | 'desk' | 'close', string> = {
  ambience: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z',
  mirror: 'M3 5h18v11H3zM8 20h8M12 16v4',
  resident: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM4 20a8 8 0 0 1 16 0',
  desk: 'M3 4h18v12H3zM9 20h6M12 16v4',
  close: 'M6 6l12 12M18 6L6 18',
};
function icon(name: keyof typeof ICONS) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

export function desktopView(host: HTMLElement, hooks: DesktopHooks): DesktopView {
  let state = startDesktop([window.innerWidth, window.innerHeight]);
  const root = el('div', 'desk');
  root.id = 'desk';
  const veil = el('div', 'desk-veil');
  const bar = el('header', 'desk-bar desk-glass');
  const brand = el('span', 'desk-brand', 'WWT Desktop');
  const clock = el('time', 'desk-clock');
  const live = el('span', 'desk-live', 'ミラー中');
  const shut = el('button', 'desk-shut');
  shut.type = 'button';
  shut.setAttribute('aria-label', 'デスクトップを閉じる');
  shut.append(icon('close'));
  bar.append(brand, live, clock, shut);
  const stage = el('div', 'desk-stage');
  const dock = el('nav', 'desk-dock desk-glass');
  dock.setAttribute('aria-label', 'アプリ');
  root.append(veil, bar, stage, dock);
  const launcher = el('button', 'desk-launcher desk-glass');
  launcher.type = 'button';
  launcher.append(icon('desk'), el('span', undefined, 'デスクトップを開く'));
  host.append(root, launcher);

  const dispatch = (action: DesktopAction) => {
    const next = reduceDesktop(state, action);
    if (next === state) return;
    state = next;
    render();
    hooks.changed(state, action);
  };

  // --- the apps' insides ---------------------------------------------------------------------
  const swatches: HTMLButtonElement[] = [];
  const brightness = el('input');
  function ambience() {
    const body = el('div', 'desk-body');
    body.append(el('p', 'desk-hint', '壁紙の色が、部屋のモニターと照明に映ります。'));
    const grid = el('div', 'desk-swatches');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', '壁紙');
    WALLPAPERS.forEach((paper, index) => {
      const button = el('button', 'desk-swatch');
      button.type = 'button';
      button.style.background = `linear-gradient(135deg, ${paper.from}, ${paper.to})`;
      button.append(el('span', undefined, paper.name));
      button.addEventListener('click', () => dispatch({ type: 'wallpaper', index }));
      swatches.push(button);
      grid.append(button);
    });
    const label = el('label', 'desk-range');
    label.append(el('span', undefined, '明るさ'));
    brightness.type = 'range';
    brightness.min = '0.4';
    brightness.max = '1.4';
    brightness.step = '0.02';
    brightness.addEventListener('input', () => dispatch({ type: 'brightness', value: Number(brightness.value) }));
    label.append(brightness);
    body.append(grid, label);
    return body;
  }

  const mirrorVideo = el('video', 'desk-mirror-video');
  mirrorVideo.muted = true;
  mirrorVideo.playsInline = true;
  const mirrorNote = el('p', 'desk-hint');
  const mirrorButton = el('button', 'desk-action');
  mirrorButton.type = 'button';
  let mirrorState: Parameters<DesktopView['setMirror']>[0] = 'off';
  function mirror() {
    const body = el('div', 'desk-body');
    const frame = el('div', 'desk-mirror-frame');
    frame.append(mirrorVideo, el('span', 'desk-mirror-empty', 'まだ何も映していません'));
    mirrorButton.addEventListener('click', () => hooks.mirror(mirrorState !== 'on' && mirrorState !== 'asking'));
    body.append(frame, mirrorNote, mirrorButton);
    return body;
  }

  const residentLine = el('p', 'desk-resident-line');
  function resident() {
    const body = el('div', 'desk-body');
    body.append(el('p', 'desk-hint', 'いまの様子'), residentLine);
    body.append(el('p', 'desk-hint', 'この窓を部屋の床の上あたりへ動かすと、縁に手をかけに来ます。'));
    return body;
  }
  const builders: Record<AppId, () => HTMLElement> = { ambience, mirror, resident };

  // --- windows -------------------------------------------------------------------------------
  const frames = new Map<AppId, HTMLElement>();
  function frame(id: AppId) {
    const app = APPS.find((a) => a.id === id)!;
    const section = el('section', 'desk-window desk-glass');
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-label', app.title);
    const title = el('header', 'desk-title');
    const close = el('button', 'desk-close');
    close.type = 'button';
    close.setAttribute('aria-label', `${app.title}を閉じる`);
    close.append(icon('close'));
    close.addEventListener('click', () => dispatch({ type: 'closeApp', id }));
    title.append(icon(id), el('span', undefined, app.title), close);
    section.append(title, builders[id]());
    section.addEventListener('pointerdown', () => {
      dispatch({ type: 'focus', id });
      hooks.pressed(id);
    });
    // Dragged by its title bar (not by its close button).
    let grab: { dx: number; dy: number; pointer: number } | undefined;
    title.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      const win = state.windows.find((w) => w.id === id);
      if (!win) return;
      grab = { dx: event.clientX - win.x, dy: event.clientY - win.y, pointer: event.pointerId };
      title.setPointerCapture(event.pointerId);
      section.classList.add('is-dragged');
    });
    title.addEventListener('pointermove', (event) => {
      if (grab?.pointer === event.pointerId)
        dispatch({ type: 'move', id, x: event.clientX - grab.dx, y: event.clientY - grab.dy });
    });
    const release = (event: PointerEvent) => {
      if (grab?.pointer !== event.pointerId) return;
      grab = undefined;
      section.classList.remove('is-dragged');
    };
    title.addEventListener('pointerup', release);
    title.addEventListener('pointercancel', release);
    // The arrow keys move a focused title bar (dragging is not the only way).
    title.tabIndex = 0;
    title.setAttribute('aria-label', `${app.title}の窓。矢印キーで動かせます`);
    title.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 48 : 16;
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
        event.key
      ];
      const win = state.windows.find((w) => w.id === id);
      if (!move || !win) return;
      event.preventDefault();
      dispatch({ type: 'move', id, x: win.x + move[0]!, y: win.y + move[1]! });
    });
    stage.append(section);
    return section;
  }

  // --- the dock ------------------------------------------------------------------------------
  const dockButtons = new Map<AppId, HTMLButtonElement>();
  for (const app of APPS) {
    const button = el('button', 'desk-app');
    button.type = 'button';
    button.append(icon(app.id), el('span', undefined, app.title));
    button.addEventListener('click', () => dispatch({ type: 'app', id: app.id }));
    dockButtons.set(app.id, button);
    dock.append(button);
  }

  function tick() {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = now.toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  let ticking: number | undefined;

  function render() {
    root.toggleAttribute('data-open', state.open);
    root.inert = !state.open;
    launcher.hidden = state.open;
    live.hidden = !state.mirror;
    const paper = WALLPAPERS[state.wallpaper]!;
    root.style.setProperty('--desk-from', paper.from);
    root.style.setProperty('--desk-to', paper.to);
    root.style.setProperty('--desk-accent', paper.accent);
    const front = focused(state)?.id;
    for (const app of APPS) {
      const win = state.windows.find((w) => w.id === app.id);
      let node = frames.get(app.id);
      if (!win) {
        node?.remove();
        frames.delete(app.id);
      } else {
        if (!node) frames.set(app.id, (node = frame(app.id)));
        node.style.left = `${win.x}px`;
        node.style.top = `${win.y}px`;
        node.style.width = `${win.w}px`;
        node.style.height = `${win.h}px`;
        node.style.zIndex = String(win.z);
        node.classList.toggle('is-front', front === app.id);
      }
      dockButtons.get(app.id)!.setAttribute('aria-pressed', String(Boolean(win)));
    }
    swatches.forEach((button, index) => button.setAttribute('aria-pressed', String(index === state.wallpaper)));
    brightness.value = String(state.brightness);
    // The clock runs only while the desktop shows.
    if (state.open && ticking === undefined) {
      tick();
      ticking = window.setInterval(tick, 15000);
    } else if (!state.open && ticking !== undefined) {
      clearInterval(ticking);
      ticking = undefined;
    }
  }
  function renderMirror() {
    const text = {
      off: 'このタブで、あなたの画面やウィンドウを部屋のモニターに映します。映像はこのページの中だけで使い、どこにも送りません。',
      asking: 'ブラウザーの確認に答えてください…',
      on: '映しています。部屋の照明が、画面の色に合わせて変わります。',
      refused: '共有を取りやめました。もう一度試せます。',
      unsupported: 'このブラウザーでは画面を映せません。',
    }[mirrorState];
    mirrorNote.textContent = text;
    mirrorButton.textContent = mirrorState === 'on' ? '映すのをやめる' : '画面を映す';
    mirrorButton.disabled = mirrorState === 'asking' || mirrorState === 'unsupported';
    mirrorVideo.parentElement?.toggleAttribute('data-live', mirrorState === 'on');
  }

  launcher.addEventListener('click', () => dispatch({ type: 'open' }));
  shut.addEventListener('click', () => {
    dispatch({ type: 'close' });
    launcher.focus();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      dispatch({ type: 'close' });
      launcher.focus();
    }
  });
  window.addEventListener('resize', () =>
    dispatch({ type: 'viewport', viewport: [window.innerWidth, window.innerHeight] }),
  );
  render();
  renderMirror();
  residentLine.textContent = 'この公開版には住人がいません。';

  return {
    state: () => state,
    dispatch,
    frontRect() {
      const id = state.open ? focused(state)?.id : undefined;
      return id ? frames.get(id)?.getBoundingClientRect() : undefined;
    },
    nudge() {
      const id = focused(state)?.id;
      const node = id && frames.get(id);
      if (!node) return;
      // Restart the little give even if it is still playing.
      node.classList.remove('is-touched');
      void node.offsetWidth;
      node.classList.add('is-touched');
    },
    setResident(text) {
      const line = text ?? 'この公開版には住人がいません。';
      if (residentLine.textContent !== line) residentLine.textContent = line;
    },
    setMirror(next) {
      mirrorState = next;
      renderMirror();
    },
    mirrorVideo,
  };
}
