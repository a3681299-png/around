/**
 * The virtual desktop on the page (docs/living-desktop.md, docs/living-mind.md): glass windows
 * over the room. Each window blurs what is behind it (the room's canvas), so the UI lifts off a
 * clouded background while the room around it stays sharp.
 *
 * The windows are things: dragged and let go they keep going, tip into their motion, bounce off
 * the screen's edge (physics.ts); the ball is the same with hardly any friction. The resident
 * pushes them, bats the ball, sits on a window (it sags) and is carried about on it.
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
import { bounce, moving, speedOf, stepMotion, still, throwVelocity, type Motion } from './physics';

export interface ResidentReadout {
  says: string;
  mood: string;
  /** 0–1 each. */
  energy: number;
  boredom: number;
  curiosity: number;
  social: number;
}

export interface DesktopView {
  state(): DesktopState;
  dispatch(action: DesktopAction): void;
  /** One frame of the windows' own motion; true while anything still moves. */
  step(dt: number, now: number): boolean;
  /** How fast a thing moves (CSS pixels a second), and whether the viewer has it in hand. */
  speed(id: AppId): number;
  held(id: AppId): boolean;
  /** A shove: the thing is sent off at this velocity (CSS pixels a second). */
  impulse(id: AppId, vx: number, vy: number): void;
  /** The resident sits on a window (it sags under it) or gets off. */
  sit(id: AppId, on: boolean): void;
  /** A ring spreading from a point of the screen (the resident knocked on it from inside). */
  ripple(x: number, y: number): void;
  /** What the resident is doing and how it is, for its window (undefined: no resident here). */
  setResident(readout: ResidentReadout | undefined): void;
  /** The mirror's state, for its window. */
  setMirror(state: 'off' | 'asking' | 'on' | 'refused' | 'unsupported'): void;
  readonly mirrorVideo: HTMLVideoElement;
}

export interface DesktopHooks {
  changed(state: DesktopState, action: DesktopAction): void;
  /** The mirror's button: start (true) or stop. */
  mirror(on: boolean): void;
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
  ball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.5 7.5c3 2 10 2 13 0M5.5 16.5c3-2 10-2 13 0',
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

const METERS = [
  ['energy', 'げんき'],
  ['boredom', 'たいくつ'],
  ['curiosity', 'きょうみ'],
  ['social', 'かまって'],
] as const;

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
  const ripples = el('div', 'desk-ripples');
  ripples.setAttribute('aria-hidden', 'true');
  host.append(root, launcher, ripples);

  const dispatch = (action: DesktopAction) => {
    const next = reduceDesktop(state, action);
    if (next === state) return;
    state = next;
    render();
    hooks.changed(state, action);
  };

  // --- the things' own motion ---------------------------------------------------------------------
  const motions = new Map<AppId, Motion>();
  const sat = new Set<AppId>();
  /** The thing the viewer has in hand, where it was grabbed and where the pointer has been. */
  let grab:
    { id: AppId; dx: number; dy: number; pointer: number; trail: { t: number; x: number; y: number }[] } | undefined;
  const motion = (id: AppId) => {
    let m = motions.get(id);
    if (!m) motions.set(id, (m = still()));
    return m;
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
  const residentMood = el('span', 'desk-resident-mood');
  const meters = METERS.map(([, label]) => {
    const row = el('div', 'desk-meter');
    const fill = el('i');
    const track = el('span', 'desk-meter-track');
    track.append(fill);
    row.append(el('span', undefined, label), track);
    return { row, fill };
  });
  function resident() {
    const body = el('div', 'desk-body');
    const head = el('div', 'desk-resident-head');
    head.append(residentLine, residentMood);
    const list = el('div', 'desk-meters');
    list.append(...meters.map((m) => m.row));
    body.append(head, list);
    body.append(el('p', 'desk-hint', '窓やボールは掴んで投げられます。部屋のフェリスをクリックすると、なでられます。'));
    return body;
  }
  const builders: Record<Exclude<AppId, 'ball'>, () => HTMLElement> = { ambience, mirror, resident };

  // --- windows -------------------------------------------------------------------------------
  const frames = new Map<AppId, HTMLElement>();
  /** Dragging: by the title bar for a window, anywhere for the ball. Let go moving, it is thrown. */
  function draggable(id: AppId, handle: HTMLElement, section: HTMLElement) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      const win = state.windows.find((w) => w.id === id);
      if (!win) return;
      grab = { id, dx: event.clientX - win.x, dy: event.clientY - win.y, pointer: event.pointerId, trail: [] };
      const m = motion(id);
      m.vx = m.vy = 0;
      handle.setPointerCapture(event.pointerId);
      section.classList.add('is-dragged');
    });
    handle.addEventListener('pointermove', (event) => {
      if (grab?.id !== id || grab.pointer !== event.pointerId) return;
      grab.trail.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
      if (grab.trail.length > 12) grab.trail.shift();
      dispatch({ type: 'move', id, x: event.clientX - grab.dx, y: event.clientY - grab.dy });
    });
    const release = (event: PointerEvent) => {
      if (grab?.id !== id || grab.pointer !== event.pointerId) return;
      const [vx, vy] = throwVelocity(grab.trail, event.timeStamp);
      const m = motion(id);
      m.vx = vx;
      m.vy = vy;
      grab = undefined;
      section.classList.remove('is-dragged');
      hooks.changed(state, { type: 'focus', id });
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
  }
  function frame(id: AppId) {
    const app = APPS.find((a) => a.id === id)!;
    if (id === 'ball') {
      const ball = el('div', 'desk-ball');
      ball.setAttribute('role', 'img');
      ball.setAttribute('aria-label', 'ボール。掴んで投げられます');
      ball.append(el('i'));
      ball.addEventListener('pointerdown', () => dispatch({ type: 'focus', id }));
      draggable(id, ball, ball);
      stage.append(ball);
      return ball;
    }
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
    section.addEventListener('pointerdown', () => dispatch({ type: 'focus', id }));
    draggable(id, title, section);
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
    // The ball's button takes it out and puts it away; a window's brings it to the front.
    button.addEventListener('click', () =>
      dispatch(
        app.id === 'ball' && state.windows.some((w) => w.id === 'ball')
          ? { type: 'closeApp', id: 'ball' }
          : { type: 'app', id: app.id },
      ),
    );
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
        motions.delete(app.id);
        sat.delete(app.id);
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
  for (const m of meters) m.row.hidden = true;

  let shown = '';
  return {
    state: () => state,
    dispatch,
    step(dt, now) {
      let busy = false;
      for (const win of state.windows) {
        const ball = win.id === 'ball';
        let m = motion(win.id);
        if (grab?.id === win.id) {
          // In hand: its speed is the hand's (it tips with it; a rider can be shaken off).
          const [vx, vy] = throwVelocity(grab.trail, now);
          m = { ...m, vx, vy };
          const next = stepMotion(m, dt, ball, sat.has(win.id));
          m = { ...next, vx, vy };
        } else {
          if (m.vx || m.vy) {
            const want: [number, number] = [win.x + m.vx * dt, win.y + m.vy * dt];
            dispatch({ type: 'move', id: win.id, x: want[0], y: want[1] });
            const got = state.windows.find((w) => w.id === win.id) ?? win;
            m = bounce(m, want, [got.x, got.y], ball);
          }
          m = stepMotion(m, dt, ball, sat.has(win.id));
        }
        motions.set(win.id, m);
        const node = frames.get(win.id);
        if (node) {
          const transform = ball
            ? `rotate(${m.spin.toFixed(3)}rad)`
            : m.tilt || m.sag
              ? `translateY(${m.sag.toFixed(2)}px) rotate(${m.tilt.toFixed(4)}rad)`
              : '';
          if (node.style.transform !== transform) node.style.transform = transform;
        }
        if (moving(m) && grab?.id !== win.id) busy = true;
      }
      return busy || Boolean(grab);
    },
    speed: (id) => speedOf(motion(id)),
    held: (id) => grab?.id === id,
    impulse(id, vx, vy) {
      if (grab?.id === id) return;
      const m = motion(id);
      motions.set(id, { ...m, vx: m.vx + vx, vy: m.vy + vy });
    },
    sit(id, on) {
      if (on) {
        sat.add(id);
        // It lands on it: the window dips.
        const m = motion(id);
        motions.set(id, { ...m, sagV: m.sagV + 160 });
      } else sat.delete(id);
    },
    ripple(x, y) {
      for (const delay of [0, 0.16]) {
        const ring = el('i', 'desk-ripple');
        ring.style.left = `${x}px`;
        ring.style.top = `${y}px`;
        ring.style.animationDelay = `${delay}s`;
        ring.addEventListener('animationend', () => ring.remove());
        ripples.append(ring);
      }
    },
    setResident(readout) {
      const key = readout
        ? `${readout.says}|${readout.mood}|${METERS.map(([k]) => Math.round(readout[k] * 25)).join()}`
        : '';
      if (key === shown) return;
      shown = key;
      residentLine.textContent = readout?.says ?? 'この公開版には住人がいません。';
      residentMood.textContent = readout?.mood ?? '';
      meters.forEach((m, i) => {
        m.row.hidden = !readout;
        if (readout) m.fill.style.width = `${Math.round(readout[METERS[i]![0]] * 100)}%`;
      });
    },
    setMirror(next) {
      mirrorState = next;
      renderMirror();
    },
    mirrorVideo,
  };
}
