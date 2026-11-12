/**
 * The player (docs/living-live.md): YouTube's own embedded player in a card of the desktop, the
 * field its address is pasted into, the way into live mode, and the few controls live mode keeps
 * on screen. The player is shown as it is: nothing is drawn over it, its own controls work, and
 * in live mode the card itself becomes the screen in the room (it is not rebuilt, so the video
 * plays on through the change).
 *
 * Everything is built with DOM calls from fixed strings. The only thing taken from the viewer is
 * a video id of YouTube's shape (youtube-id.ts), and the only messages listened to are the
 * player's own (its origin and its window are checked).
 */
import { PLAYER_ORIGIN, embedUrl, isVideoId, youtubeId } from './youtube-id';
import type { CaptureState } from './capture';

export type LiveViewName = 'stage' | 'floor';
export interface LiveStatus {
  capture: CaptureState;
  hears: boolean;
  view: LiveViewName;
}

export interface PlayerHooks {
  /** A video was asked for (a checked id). */
  video(id: string): void;
  live(on: boolean): void;
  view(view: LiveViewName): void;
  /** The light's link to the picture: ask for it (true) or let it go. */
  light(on: boolean): void;
}

export interface PlayerUi {
  /** The card's body; the 16:9 box in it that holds the player; live mode's controls. */
  readonly body: HTMLElement;
  readonly box: HTMLElement;
  readonly hud: HTMLElement;
  /** Shows a video (a new id loads it; the same id leaves it playing). */
  video(id: string | undefined): void;
  live(on: boolean): void;
  status(status: LiveStatus): void;
  /** What the player last said of itself. */
  readonly playing: boolean;
  readonly title: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (className: string, text: string) => {
  const node = el('button', className, text);
  node.type = 'button';
  return node;
};

const REMEMBERED = 'wwt-living-video';
const ERRORS: Record<number, string> = {
  2: 'この動画のアドレスを読めませんでした。',
  5: 'この動画は、このプレイヤーでは再生できません。',
  100: 'この動画は見つかりません（削除されたか、非公開です）。',
  101: 'この動画は、ほかのサイトでの再生が許可されていません。',
  150: 'この動画は、ほかのサイトでの再生が許可されていません。',
  153: 'プレイヤーがこのページを確認できませんでした。',
};

export function playerUi(hooks: PlayerHooks): PlayerUi {
  const body = el('div', 'desk-body desk-player-body');
  const box = el('div', 'desk-player');
  const empty = el('p', 'desk-player-empty', 'YouTube の MV やライブ映像のアドレスを貼ると、ここで再生できます。');
  box.append(empty);
  const form = el('form', 'desk-player-form');
  const field = el('input');
  field.type = 'text';
  field.inputMode = 'url';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.placeholder = 'https://www.youtube.com/watch?v=…';
  field.setAttribute('aria-label', 'YouTube のアドレス');
  const go = el('button', 'desk-action', '再生');
  go.type = 'submit';
  form.append(field, go);
  const note = el('p', 'desk-hint');
  note.setAttribute('role', 'status');
  const liveButton = button('desk-action desk-live-button', 'ライブモード');
  const foot = el('div', 'desk-player-foot');
  foot.append(liveButton, note);
  body.append(box, form, foot);

  // Live mode's own controls: small, at the foot of the screen, gone while the pointer rests.
  const hud = el('div', 'live-hud');
  hud.setAttribute('role', 'toolbar');
  hud.setAttribute('aria-label', 'ライブモード');
  const badge = el('span', 'live-badge', 'LIVE');
  const heading = el('span', 'live-title');
  const views = el('div', 'live-views');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', '視点');
  const viewButtons = (
    [
      ['stage', 'ステージ'],
      ['floor', 'フロア'],
    ] as const
  ).map(([name, label]) => {
    const node = button('live-view', label);
    node.addEventListener('click', () => hooks.view(name));
    views.append(node);
    return [name, node] as const;
  });
  const lightButton = button('live-light', '');
  const leave = button('live-leave', '終える');
  leave.title = 'ライブモードを終える（Esc）';
  hud.append(badge, heading, views, lightButton, leave);

  let frame: HTMLIFrameElement | undefined;
  let shown: string | undefined;
  let playing = false;
  let title = '';
  let error = '';
  let live = false;
  let status: LiveStatus = { capture: 'off', hears: false, view: 'stage' };

  const say = (command: string) =>
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: command, args: [] }), PLAYER_ORIGIN);
  const render = () => {
    empty.hidden = Boolean(shown);
    liveButton.disabled = !shown || Boolean(error);
    const linked = status.capture === 'on';
    note.textContent = error
      ? error
      : !shown
        ? ''
        : status.capture === 'asking'
          ? 'ブラウザーの確認で「このタブ」を選ぶと、映像の色と音が部屋に届きます。'
          : 'このタブの映像と音を読み取り、部屋に映します（ブラウザーの確認が出ます。保存も送信もしません）。';
    heading.textContent = title;
    for (const [name, node] of viewButtons) node.setAttribute('aria-pressed', String(status.view === name));
    lightButton.textContent = linked
      ? status.hears
        ? '光と音：連動中'
        : '光：連動中（音なし）'
      : status.capture === 'asking'
        ? '確認中…'
        : status.capture === 'unsupported'
          ? '光：サムネイルの色'
          : '光と音を連動する';
    lightButton.disabled = status.capture === 'asking' || status.capture === 'unsupported';
    lightButton.setAttribute('aria-pressed', String(linked));
    lightButton.title = linked
      ? 'このタブの映像と音の読み取りをやめる'
      : 'このタブの映像と音を読み取って、部屋の光とフェリスに映す（ブラウザーの確認が出ます）';
    hud.hidden = !live;
  };

  // What the player says of itself: whether it plays, what it plays, what went wrong.
  window.addEventListener('message', (event) => {
    if (event.origin !== PLAYER_ORIGIN || !frame || event.source !== frame.contentWindow) return;
    let message: { event?: unknown; info?: unknown };
    try {
      message = JSON.parse(String(event.data)) as typeof message;
    } catch {
      return;
    }
    const info = message.info;
    if (message.event === 'onError' && typeof info === 'number') {
      error = ERRORS[info] ?? 'この動画は再生できませんでした。';
      playing = false;
    } else if (
      (message.event === 'infoDelivery' || message.event === 'initialDelivery') &&
      info &&
      typeof info === 'object'
    ) {
      const { playerState, videoData } = info as { playerState?: unknown; videoData?: { title?: unknown } };
      if (typeof playerState === 'number') {
        playing = playerState === 1;
        if (playing) error = '';
      }
      // (Text only: it goes into the page as text.)
      if (typeof videoData?.title === 'string') title = videoData.title.slice(0, 120);
    } else return;
    render();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = youtubeId(field.value);
    if (!id) {
      error = 'YouTube の動画のアドレスではないようです。';
      render();
      return;
    }
    error = '';
    hooks.video(id);
  });
  liveButton.addEventListener('click', () => hooks.live(true));
  leave.addEventListener('click', () => hooks.live(false));
  lightButton.addEventListener('click', () => hooks.light(status.capture !== 'on'));
  // The controls show while the pointer moves and for a few seconds after.
  let hide: number | undefined;
  const wake = () => {
    hud.classList.add('is-awake');
    clearTimeout(hide);
    hide = window.setTimeout(() => hud.classList.remove('is-awake'), 3200);
  };
  window.addEventListener('pointermove', () => live && wake());
  hud.addEventListener('focusin', wake);

  // The last video, for the field (a convenience; nothing is loaded until it is asked for).
  try {
    const last = localStorage.getItem(REMEMBERED);
    if (isVideoId(last)) field.value = `https://youtu.be/${last}`;
  } catch {
    // No storage here: the field starts empty.
  }
  render();

  return {
    body,
    box,
    hud,
    video(id) {
      if (id === shown) return;
      shown = id;
      playing = false;
      title = '';
      error = '';
      frame?.remove();
      frame = undefined;
      if (id && isVideoId(id)) {
        frame = el('iframe');
        frame.title = 'YouTube プレイヤー';
        frame.allow = 'autoplay; encrypted-media; picture-in-picture';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        const mine = frame;
        // Once it is there, it is asked to tell of its state and its errors.
        frame.addEventListener('load', () => {
          mine.contentWindow?.postMessage(
            JSON.stringify({ event: 'listening', id: 'wwt-living', channel: 'widget' }),
            PLAYER_ORIGIN,
          );
          for (const name of ['onStateChange', 'onError'])
            mine.contentWindow?.postMessage(
              JSON.stringify({ event: 'command', func: 'addEventListener', args: [name] }),
              PLAYER_ORIGIN,
            );
        });
        // (It was asked for with a press of the button: it may start by itself.)
        frame.src = `${embedUrl(id, location.origin)}&autoplay=1`;
        box.append(frame);
        try {
          localStorage.setItem(REMEMBERED, id);
        } catch {
          // Not remembered, then.
        }
      }
      render();
    },
    live(on) {
      live = on;
      if (on) {
        say('playVideo');
        wake();
      }
      render();
    },
    status(next) {
      status = next;
      render();
    },
    get playing() {
      return playing;
    },
    get title() {
      return title;
    },
  };
}
