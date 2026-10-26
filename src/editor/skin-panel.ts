import styles from './skin-panel.css';
import {
  SKIN_LIMITS,
  SKIN_STATES,
  type DesignTarget,
  type SkinFrame,
  type SkinState,
  type SurfaceSkin,
} from '../design/types';
import type { SkinAssetStatus } from '../design/renderer';
import type { EditorView, SkinPreview } from '../editor-core/types';
import type { SkinSlot } from '../editor-core/skins';

export const SKIN_PANEL_STYLES = styles;

/** What the Host found on the page for one part; never part of the document. */
export interface SkinPageInfo {
  id: string;
  count: number;
  width?: number;
  height?: number;
  /** Load state of the part's normal art in the page renderer. */
  asset?: SkinAssetStatus;
}
export interface SkinPanelOptions {
  targets: readonly DesignTarget[];
  assetUrl(assetId: string): Promise<string | undefined>;
  /** In-page panels import into a skin slot; remote panels omit it. */
  import?(files: readonly File[], slot: SkinSlot): void;
}
export interface SkinPanelActions {
  selectTarget(id: string): void;
  skin(skin: SurfaceSkin | null): void;
  preview(value: SkinPreview): void;
  begin(): void;
  end(cancel?: boolean): void;
}

const STATE_NAMES: Record<SkinState, string> = {
  normal: '通常',
  hover: 'ホバー',
  focus: 'フォーカス',
  selected: '選択中',
  pressed: '押下',
  disabled: '無効',
};
const STATE_HELP: Record<SkinState, string> = {
  normal: 'いつもの見た目です。ほかの状態に絵がないときもこの絵を使います。',
  hover: 'マウスを乗せている間の見た目です。',
  focus: 'キーボードで選んだときの見た目です。',
  selected: 'オンになっている間の見た目です。',
  pressed: '押している間の見た目です。',
  disabled: '押せないときの見た目です。',
};
type Tab = SkinState | 'compact';
type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const SIDE_NAMES: Record<Side, string> = { top: '上', right: '右', bottom: '下', left: '左' };
const STAGE = { width: 296, height: 168, zoom: 4 };

export function skinStates(target: DesignTarget | undefined): SkinState[] {
  return SKIN_STATES.filter((state) => state === 'normal' || target?.skin?.states[state] !== undefined);
}
export function skinStateName(target: DesignTarget | undefined, state: SkinState): string {
  return target?.skin?.labels?.[state] ?? STATE_NAMES[state];
}
function frameOf(skin: SurfaceSkin | undefined, tab: Tab): SkinFrame | undefined {
  if (!skin) return;
  if (tab === 'compact') return skin.compact?.kind === 'frame' ? skin.compact.frame : undefined;
  return skin.states[tab];
}
function withFrame(skin: SurfaceSkin, tab: Tab, frame: SkinFrame): SurfaceSkin {
  return tab === 'compact'
    ? { ...skin, compact: { kind: 'frame', frame } }
    : { ...skin, states: { ...skin.states, [tab]: frame } };
}
/** Part status for the list and the "not applied" reason, in the spirit of the guard's 制限中 display. */
export function skinReason(
  target: DesignTarget,
  skin: SurfaceSkin | undefined,
  info: SkinPageInfo | undefined,
): { status: 'applied' | 'empty' | 'missing' | 'loading' | 'error'; text: string } {
  if (info && info.count === 0)
    return {
      status: 'missing',
      text: `このページに見つかりません${target.skin?.where ? `（${target.skin.where}にあります）` : ''}`,
    };
  if (!skin) return { status: 'empty', text: info ? `未設定・ページ上に${info.count}個` : '未設定' };
  if (info?.asset?.state === 'error') return { status: 'error', text: `絵を読み込めません：${info.asset.message}` };
  if (info?.asset?.state === 'loading') return { status: 'loading', text: '絵を読み込み中…' };
  if (info && info.width === 0) return { status: 'missing', text: 'ページ上で非表示です' };
  return { status: 'applied', text: info ? `${info.count}個に反映中` : '設定済み' };
}

/** Skin editor UI. It holds no document state: every change is an editor command. */
export function createSkinPanel(doc: Document, actions: SkinPanelActions, options: SkinPanelOptions) {
  const targets = options.targets.filter((target) => target.skin);
  const root = doc.createElement('section');
  root.className = 'skin';
  root.hidden = true;
  root.setAttribute('aria-label', 'UIの着せ替え');
  root.innerHTML = `
    <h3>UIの着せ替え</h3>
    <p class="hint skin-intro">ページの部品にマウスを乗せて、クリックで選びます。同じ種類の部品はページ上ですべて同時に変わります。ボタンや文字はそのまま使えます。</p>
    <details class="skin-parts-section" open><summary class="skin-parts-summary">部品を選ぶ</summary><div class="skin-parts" role="group" aria-label="着せ替えできる部品"></div></details>
    <div class="skin-editor" hidden>
      <div class="skin-heading"><strong class="skin-name"></strong><span class="skin-reach"></span><span class="skin-reason" role="status" hidden></span></div>
      <div class="skin-tabs" role="tablist" aria-label="部品の状態"></div>
      <p class="hint skin-state-help"></p>
      <label class="skin-toggle"><input type="checkbox" class="skin-force">ページ上でこの状態を表示</label>
      <div class="skin-drop main-drop" role="button" tabindex="0"><strong class="drop-title"></strong><small>PNG・WebP（${SKIN_LIMITS.edge}px以内）をドロップ、またはクリックして選ぶ</small></div>
      <div class="skin-inherit" hidden><p>この状態は「通常」の絵を使っています。</p><button type="button" class="skin-copy">通常の絵をもとに編集する</button></div>
      <div class="slice" hidden>
        <div class="slice-stage"><img class="slice-image" alt="" draggable="false"></div>
        <p class="hint">紫の線をドラッグして、伸ばさない角と縁の幅を決めます。矢印キーでも動かせます。</p>
        <div class="slice-numbers"></div>
        <div class="skin-row">
          <label>中央と縁<select class="skin-center" aria-label="中央と縁の扱い"><option value="stretch">伸ばす</option><option value="repeat">繰り返す</option></select></label>
          <label>枠の太さ<input type="number" class="skin-scale" aria-label="枠の太さ（%）" min="${SKIN_LIMITS.scaleMin}" max="${SKIN_LIMITS.scaleMax}" step="5" required></label>
        </div>
        <div class="skin-row"><button type="button" class="skin-replace">絵を差し替える</button><button type="button" class="skin-remove"></button></div>
      </div>
      <details class="skin-sizes" open><summary>大きさの確認</summary><div class="size-previews"></div><p class="hint size-actual"></p></details>
      <details class="skin-compact"><summary>小さすぎるとき</summary>
        <p class="hint">部品が枠の太さより小さいときの見た目です。</p>
        <label><input type="radio" name="skin-compact" value="none">枠をそのまま縮める</label>
        <label><input type="radio" name="skin-compact" value="color">色だけにする <input type="color" class="compact-color" aria-label="小さいときの色" value="#3d3654"></label>
        <label><input type="radio" name="skin-compact" value="frame">簡略版の絵を使う</label>
        <div class="skin-drop compact-drop" role="button" tabindex="0" data-skin-slot="compact" hidden><strong>簡略版の絵をドロップ</strong><small>またはクリックして選ぶ</small></div>
        <button type="button" class="compact-edit" hidden>簡略版の切り位置を編集</button>
        <label class="skin-toggle"><input type="checkbox" class="skin-force-compact">ページ上で小さいときの見た目を表示</label>
      </details>
      <input type="file" class="skin-file" accept="image/png,image/webp" hidden>
    </div>
    <p class="skin-note" hidden>このパネルでは絵の取り込みと切り位置の編集ができません。YouTubeのページ内のパネルで編集してください。</p>`;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const parts = get<HTMLDivElement>('.skin-parts'),
    editor = get<HTMLDivElement>('.skin-editor'),
    tabs = get<HTMLDivElement>('.skin-tabs'),
    force = get<HTMLInputElement>('.skin-force'),
    forceCompact = get<HTMLInputElement>('.skin-force-compact'),
    drop = get<HTMLDivElement>('.main-drop'),
    compactDrop = get<HTMLDivElement>('.compact-drop'),
    inherit = get<HTMLDivElement>('.skin-inherit'),
    slice = get<HTMLDivElement>('.slice'),
    stage = get<HTMLDivElement>('.slice-stage'),
    image = get<HTMLImageElement>('.slice-image'),
    numbers = get<HTMLDivElement>('.slice-numbers'),
    center = get<HTMLSelectElement>('.skin-center'),
    scale = get<HTMLInputElement>('.skin-scale'),
    remove = get<HTMLButtonElement>('.skin-remove'),
    file = get<HTMLInputElement>('.skin-file'),
    previews = get<HTMLDivElement>('.size-previews'),
    compactColor = get<HTMLInputElement>('.compact-color');
  let view: EditorView | undefined,
    page = new Map<string, SkinPageInfo>(),
    tab: Tab = 'normal',
    fileSlot: SkinSlot = 'normal',
    lastTarget: string | undefined;
  const urls = new Map<string, string | null>();
  const target = () => targets.find((item) => item.id === view?.target);
  // Typing in a number field must not be overwritten by the echo of its own command.
  const focused = (element: HTMLElement) => (root.getRootNode() as Document | ShadowRoot).activeElement === element;
  const setText = (element: HTMLElement, value: string) => {
    if (element.textContent !== value) element.textContent = value;
  };
  const url = (assetId: string) => {
    const known = urls.get(assetId);
    if (known !== undefined) return known ?? undefined;
    urls.set(assetId, null);
    void options
      .assetUrl(assetId)
      .then((value) => {
        if (!value) return;
        urls.set(assetId, value);
        if (view) render(view);
      })
      .catch(() => undefined);
    return undefined;
  };

  // Parts list: one button per adapter part, with the same status words as the page reasons.
  const partButtons = new Map<string, HTMLButtonElement>();
  for (const item of targets) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'skin-part';
    button.dataset.target = item.id;
    const name = doc.createElement('span');
    name.className = 'name';
    name.textContent = item.label;
    const state = doc.createElement('span');
    state.className = 'state';
    button.append(name, state);
    button.addEventListener('click', () => actions.selectTarget(item.id));
    parts.append(button);
    partButtons.set(item.id, button);
  }

  // Slice guides: local while dragging, committed as one undo step.
  const guides = new Map<Side, HTMLButtonElement>(),
    inputs = new Map<Side, HTMLInputElement>(),
    shades: HTMLDivElement[] = [];
  for (let i = 0; i < 4; i++) {
    const shade = doc.createElement('div');
    shade.className = 'slice-shade';
    stage.append(shade);
    shades.push(shade);
  }
  let dragging: { side: Side; frame: SkinFrame; pointer: number } | undefined,
    pendingFrame: SkinFrame | undefined,
    frameRequest: number | undefined;
  const naturalSize = () => ({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
  const clampSide = (frame: SkinFrame, side: Side, value: number): SkinFrame => {
    const size = naturalSize(),
      across = side === 'left' || side === 'right',
      other = frame.slices[side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top'];
    const limit = Math.max(0, Math.min(SKIN_LIMITS.slice, (across ? size.width : size.height) - other));
    return {
      ...frame,
      slices: { ...frame.slices, [side]: Math.max(0, Math.min(limit, Math.round(value))) },
    };
  };
  const commit = (frame: SkinFrame) => {
    const skin = view?.skin;
    if (skin) actions.skin(withFrame(skin, tab, frame));
  };
  const flush = () => {
    frameRequest = undefined;
    if (pendingFrame) commit(pendingFrame);
    pendingFrame = undefined;
  };
  const schedule = (frame: SkinFrame) => {
    pendingFrame = frame;
    frameRequest ??= doc.defaultView!.requestAnimationFrame(flush);
  };
  for (const side of SIDES) {
    const guide = doc.createElement('button');
    guide.type = 'button';
    guide.className = 'slice-guide';
    guide.dataset.side = side;
    guide.dataset.axis = side === 'left' || side === 'right' ? 'x' : 'y';
    guide.setAttribute('role', 'slider');
    guide.setAttribute('aria-label', `${SIDE_NAMES[side]}の切り位置`);
    const knob = doc.createElement('span');
    knob.className = 'knob';
    const value = doc.createElement('span');
    value.className = 'value';
    guide.append(knob, value);
    stage.append(guide);
    guides.set(side, guide);
    guide.addEventListener('pointerdown', (event) => {
      const frame = frameOf(view?.skin, tab);
      if (!frame || event.button !== 0 || view?.saving) return;
      event.preventDefault();
      guide.setPointerCapture(event.pointerId);
      guide.toggleAttribute('data-dragging', true);
      dragging = { side, frame, pointer: event.pointerId };
      actions.begin();
    });
    guide.addEventListener('pointermove', (event) => {
      if (!dragging || dragging.pointer !== event.pointerId || dragging.side !== side) return;
      const rect = stage.getBoundingClientRect(),
        size = naturalSize(),
        zoom = size.width ? rect.width / size.width : 1;
      const raw =
        side === 'left'
          ? (event.clientX - rect.left) / zoom
          : side === 'right'
            ? (rect.right - event.clientX) / zoom
            : side === 'top'
              ? (event.clientY - rect.top) / zoom
              : (rect.bottom - event.clientY) / zoom;
      const next = clampSide(dragging.frame, side, raw);
      if (next.slices[side] === dragging.frame.slices[side]) return;
      dragging.frame = next;
      layoutGuides(next);
      schedule(next);
    });
    const finish = (event: PointerEvent, cancel: boolean) => {
      if (!dragging || dragging.pointer !== event.pointerId) return;
      if (frameRequest !== undefined) doc.defaultView!.cancelAnimationFrame(frameRequest);
      if (!cancel) flush();
      frameRequest = undefined;
      pendingFrame = undefined;
      dragging = undefined;
      guide.removeAttribute('data-dragging');
      actions.end(cancel);
    };
    guide.addEventListener('pointerup', (event) => finish(event, false));
    guide.addEventListener('pointercancel', (event) => finish(event, true));
    guide.addEventListener('keydown', (event) => {
      const frame = frameOf(view?.skin, tab);
      if (!frame) return;
      const step = event.shiftKey ? 10 : 1,
        horizontal = side === 'left' || side === 'right';
      // Arrow keys move the line in screen direction; the stored value is an inner width.
      const delta =
        (event.key === (horizontal ? 'ArrowRight' : 'ArrowDown') ? step : 0) -
        (event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp') ? step : 0);
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      commit(clampSide(frame, side, frame.slices[side] + (side === 'left' || side === 'top' ? delta : -delta)));
    });
    const label = doc.createElement('label');
    label.textContent = SIDE_NAMES[side];
    const input = doc.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(SKIN_LIMITS.slice);
    input.step = '1';
    input.required = true;
    input.setAttribute('aria-label', `${SIDE_NAMES[side]}の切り位置（px）`);
    input.addEventListener('change', () => {
      const frame = frameOf(view?.skin, tab);
      if (!frame || !input.checkValidity()) return;
      commit(clampSide(frame, side, Number(input.value)));
    });
    label.append(input);
    numbers.append(label);
    inputs.set(side, input);
  }
  function layoutGuides(frame: SkinFrame) {
    const size = naturalSize();
    if (!size.width || !size.height) return;
    const zoom = Math.min(STAGE.width / size.width, STAGE.height / size.height, STAGE.zoom);
    const width = size.width * zoom,
      height = size.height * zoom;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.toggleAttribute('data-pixelated', zoom > 1.5);
    const { top, right, bottom, left } = frame.slices;
    const at: Record<Side, number> = {
      left: left * zoom,
      right: width - right * zoom,
      top: top * zoom,
      bottom: height - bottom * zoom,
    };
    for (const side of SIDES) {
      const guide = guides.get(side)!;
      if (side === 'left' || side === 'right') guide.style.left = `${at[side]}px`;
      else guide.style.top = `${at[side]}px`;
      guide.setAttribute('aria-valuenow', String(frame.slices[side]));
      guide.setAttribute('aria-valuemin', '0');
      guide.setAttribute('aria-valuemax', String(SKIN_LIMITS.slice));
      setText(guide.querySelector<HTMLElement>('.value')!, String(frame.slices[side]));
      const input = inputs.get(side)!;
      if (!focused(input)) input.value = String(frame.slices[side]);
    }
    // Shade the four stretched bands so the fixed corners read at a glance.
    const bands = [
      { left: at.left, top: 0, width: Math.max(0, at.right - at.left), height: at.top },
      { left: at.left, top: at.bottom, width: Math.max(0, at.right - at.left), height: height - at.bottom },
      { left: 0, top: at.top, width: at.left, height: Math.max(0, at.bottom - at.top) },
      { left: at.right, top: at.top, width: width - at.right, height: Math.max(0, at.bottom - at.top) },
    ];
    bands.forEach((band, index) => {
      const shade = shades[index]!;
      shade.style.left = `${band.left}px`;
      shade.style.top = `${band.top}px`;
      shade.style.width = `${band.width}px`;
      shade.style.height = `${band.height}px`;
    });
  }
  image.addEventListener('load', () => {
    const frame = dragging?.frame ?? frameOf(view?.skin, tab);
    if (frame) layoutGuides(frame);
    if (view) renderSizes(view);
  });

  // Size preview: the same border-image the engine writes, set through CSSOM properties only.
  const paint = (element: HTMLElement, frame: SkinFrame | undefined, background: string) => {
    const value = frame && url(frame.assetId);
    if (!frame || !value) {
      element.style.borderImageSource = 'none';
      element.style.background = '#8884';
      return;
    }
    const k = frame.scalePct / 100,
      { top, right, bottom, left } = frame.slices;
    element.style.borderImageSource = `url("${value}")`;
    element.style.borderImageSlice = `${top} ${right} ${bottom} ${left} fill`;
    element.style.borderImageWidth = `${top * k}px ${right * k}px ${bottom * k}px ${left * k}px`;
    element.style.borderImageRepeat = frame.center === 'repeat' ? 'round' : 'stretch';
    element.style.background = background;
  };
  function renderSizes(state: EditorView) {
    const part = target(),
      skin = state.skin;
    previews.replaceChildren();
    const actual = page.get(part?.id ?? '');
    setText(
      get<HTMLElement>('.size-actual'),
      actual?.width ? `ページ上の大きさ：約${Math.round(actual.width)}×${Math.round(actual.height ?? 0)}px` : '',
    );
    if (!part || !skin) return;
    const base = part.skin?.sample ?? { width: 160, height: 40 };
    const frame = tab === 'compact' ? skin.states.normal : (skin.states[tab] ?? skin.states.normal);
    const k = skin.states.normal.scalePct / 100,
      minWidth = (skin.states.normal.slices.left + skin.states.normal.slices.right) * k,
      minHeight = (skin.states.normal.slices.top + skin.states.normal.slices.bottom) * k;
    const sizes = [
      {
        name: '小さいとき',
        width: Math.max(16, Math.round(base.width * 0.45)),
        height: Math.max(12, Math.round(base.height * 0.6)),
      },
      { name: 'いつもの大きさ', ...base },
      { name: '大きいとき', width: Math.round(base.width * 1.6), height: Math.round(base.height * 1.6) },
    ];
    for (const size of sizes) {
      const wrapper = doc.createElement('div');
      wrapper.className = 'size-preview';
      const caption = doc.createElement('small');
      const compact = Boolean(skin.compact) && (size.width < minWidth || size.height < minHeight);
      caption.textContent = `${size.name}（${size.width}×${size.height}px）${compact ? '・小さいときの見た目' : ''}`;
      const box = doc.createElement('div');
      box.className = 'size-box';
      box.textContent = part.label.replace(/ボタン$/, '');
      box.style.width = `${size.width}px`;
      box.style.height = `${size.height}px`;
      const background = state.style.backgroundColor ?? 'transparent';
      if (compact && skin.compact?.kind === 'color') {
        box.style.background = skin.compact.color;
      } else paint(box, compact && skin.compact?.kind === 'frame' ? skin.compact.frame : frame, background);
      const holder = doc.createElement('div');
      holder.className = 'size-frame';
      // Real CSS pixels inside; only the preview is scaled to fit the panel.
      const fit = Math.min(1, 280 / size.width);
      box.style.transform = fit < 1 ? `scale(${fit})` : '';
      holder.style.height = `${size.height * fit + 8}px`;
      holder.append(box);
      wrapper.append(caption, holder);
      previews.append(wrapper);
    }
  }

  const openFile = (slot: SkinSlot) => {
    if (!options.import || view?.saving) return;
    fileSlot = slot;
    file.click();
  };
  file.addEventListener('change', () => {
    const files = [...(file.files ?? [])];
    file.value = '';
    if (files.length) options.import?.(files, fileSlot);
  });
  for (const zone of [drop, compactDrop]) {
    zone.addEventListener('click', () => openFile(zone.dataset.skinSlot as SkinSlot));
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFile(zone.dataset.skinSlot as SkinSlot);
      }
    });
    zone.addEventListener('dragenter', () => zone.toggleAttribute('data-over', true));
    zone.addEventListener('dragleave', () => zone.removeAttribute('data-over'));
    zone.addEventListener('drop', () => zone.removeAttribute('data-over'));
  }
  get<HTMLButtonElement>('.skin-replace').addEventListener('click', () => openFile(tab));
  get<HTMLButtonElement>('.skin-copy').addEventListener('click', () => {
    const skin = view?.skin;
    if (skin && tab !== 'compact')
      actions.skin({ ...skin, states: { ...skin.states, [tab]: { ...skin.states.normal } } });
  });
  remove.addEventListener('click', () => {
    const skin = view?.skin;
    if (!skin) return;
    if (tab === 'normal') actions.skin(null);
    else if (tab === 'compact') {
      const { compact: _compact, ...rest } = skin;
      actions.skin(rest);
      tab = 'normal';
    } else {
      const { [tab]: _removed, ...states } = skin.states;
      actions.skin({ ...skin, states: states as SurfaceSkin['states'] });
    }
  });
  center.addEventListener('change', () => {
    const frame = frameOf(view?.skin, tab);
    if (frame) commit({ ...frame, center: center.value === 'repeat' ? 'repeat' : 'stretch' });
  });
  scale.addEventListener('change', () => {
    const frame = frameOf(view?.skin, tab);
    if (frame && scale.checkValidity()) commit({ ...frame, scalePct: Math.round(Number(scale.value)) });
  });
  force.addEventListener('change', () => {
    actions.preview(force.checked && tab !== 'compact' ? { state: tab } : {});
  });
  forceCompact.addEventListener('change', () => actions.preview(forceCompact.checked ? { compact: true } : {}));
  get<HTMLButtonElement>('.compact-edit').addEventListener('click', () => {
    tab = 'compact';
    if (view) render(view);
  });
  root.querySelectorAll<HTMLInputElement>('input[name="skin-compact"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      const skin = view?.skin;
      if (!skin || !radio.checked) return;
      const { compact: _compact, ...rest } = skin;
      if (radio.value === 'none') actions.skin(rest);
      else if (radio.value === 'color')
        actions.skin({ ...rest, compact: { kind: 'color', color: compactColor.value } });
      else if (skin.compact?.kind !== 'frame') {
        compactDrop.hidden = false;
        openFile('compact');
      }
    }),
  );
  compactColor.addEventListener('change', () => {
    const skin = view?.skin;
    if (skin) actions.skin({ ...skin, compact: { kind: 'color', color: compactColor.value } });
  });

  function renderTabs(part: DesignTarget, skin: SurfaceSkin | undefined) {
    const states = skinStates(part);
    const all: Tab[] = [...states, ...(skin?.compact?.kind === 'frame' ? (['compact'] as const) : [])];
    if (!all.includes(tab)) tab = 'normal';
    const key = all.join(',') + '|' + part.id;
    if (tabs.dataset.key !== key) {
      tabs.dataset.key = key;
      tabs.replaceChildren(
        ...all.map((state) => {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'skin-tab';
          button.dataset.state = state;
          button.setAttribute('role', 'tab');
          button.textContent = state === 'compact' ? '小さいとき' : skinStateName(part, state);
          button.addEventListener('click', () => {
            tab = state;
            if (view?.skinPreview?.state !== undefined && state !== 'compact') actions.preview({ state });
            if (view) render(view);
          });
          return button;
        }),
      );
    }
    tabs.querySelectorAll<HTMLButtonElement>('.skin-tab').forEach((button) => {
      const state = button.dataset.state as Tab;
      button.setAttribute('aria-selected', String(state === tab));
      button.tabIndex = state === tab ? 0 : -1;
      button.toggleAttribute('data-own', Boolean(frameOf(skin, state)));
      button.title =
        state === 'compact'
          ? '部品が小さいときの絵'
          : frameOf(skin, state) || state === 'normal'
            ? STATE_HELP[state]
            : `${STATE_HELP[state]}（今は通常の絵）`;
    });
  }

  function render(state: EditorView) {
    view = state;
    const active = state.tool === 'skin';
    root.hidden = !active;
    if (!active) return;
    const part = target();
    for (const item of targets) {
      const button = partButtons.get(item.id)!;
      button.setAttribute('aria-pressed', String(item.id === part?.id));
      const reason = skinReason(item, item.id === state.target ? state.skin : undefined, page.get(item.id));
      // Only the selected part's skin is in the view; others show page presence only.
      const status = item.id === state.target ? reason.status : page.get(item.id)?.count === 0 ? 'missing' : 'empty';
      button.dataset.status = status;
      setText(
        button.querySelector<HTMLElement>('.state')!,
        item.id === state.target
          ? reason.text
          : page.get(item.id)?.count === 0
            ? '見つかりません'
            : page.has(item.id)
              ? `${page.get(item.id)!.count}個`
              : '確認中…',
      );
    }
    editor.hidden = !part;
    setText(get<HTMLElement>('.skin-parts-summary'), part ? `部品を選ぶ（選択中：${part.label}）` : '部品を選ぶ');
    get<HTMLElement>('.skin-note').hidden = Boolean(options.import);
    if (!part) return;
    if (lastTarget !== part.id) {
      // The list folds away once a part is chosen; its summary keeps the choice visible.
      get<HTMLDetailsElement>('.skin-parts-section').open = false;
      lastTarget = part.id;
      tab = 'normal';
    }
    const skin = state.skin;
    const info = page.get(part.id);
    setText(get<HTMLElement>('.skin-name'), part.label);
    setText(get<HTMLElement>('.skin-reach'), info?.count ? `ページ上の${info.count}個に同時に反映されます` : '');
    const reason = skinReason(part, skin, info);
    const reasonText = get<HTMLElement>('.skin-reason');
    reasonText.hidden = !['missing', 'loading', 'error'].includes(reason.status);
    reasonText.dataset.kind = reason.status === 'error' ? 'error' : 'warn';
    setText(reasonText, reason.text);
    renderTabs(part, skin);
    setText(
      get<HTMLElement>('.skin-state-help'),
      tab === 'compact' ? '部品が小さいときに使う簡略版の絵です。' : STATE_HELP[tab],
    );
    const frame = frameOf(skin, tab);
    const tabName = tab === 'compact' ? '小さいとき' : skinStateName(part, tab);
    force.checked = state.skinPreview?.state === tab;
    force.disabled = state.saving || tab === 'compact' || !skin;
    force.closest('label')!.hidden = tab === 'compact';
    forceCompact.checked = Boolean(state.skinPreview?.compact);
    forceCompact.disabled = state.saving || !skin?.compact;
    drop.dataset.skinSlot = tab;
    drop.hidden = Boolean(frame) || !options.import || (tab !== 'normal' && !skin);
    setText(
      drop.querySelector<HTMLElement>('.drop-title')!,
      tab === 'normal' ? `${part.label}の絵をドロップ` : `「${tabName}」専用の絵をドロップ`,
    );
    inherit.hidden = Boolean(frame) || tab === 'normal' || tab === 'compact' || !skin;
    const appeared = slice.hidden && Boolean(frame);
    slice.hidden = !frame;
    if (appeared) slice.scrollIntoView({ block: 'nearest' });
    if (frame) {
      const source = url(frame.assetId);
      if (source && image.getAttribute('src') !== source) image.src = source;
      if (!source) image.removeAttribute('src');
      if (!dragging) layoutGuides(frame);
      center.value = frame.center;
      if (!focused(scale)) scale.value = String(frame.scalePct);
      setText(
        remove,
        tab === 'normal' ? '着せ替えを外す' : tab === 'compact' ? '簡略版の絵を外す' : `「${tabName}」の絵を外す`,
      );
      get<HTMLButtonElement>('.skin-replace').hidden = !options.import;
    }
    slice
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')
      .forEach((control) => {
        control.disabled = state.saving;
      });
    const compactKind = skin?.compact?.kind ?? 'none';
    root.querySelectorAll<HTMLInputElement>('input[name="skin-compact"]').forEach((radio) => {
      radio.checked = radio.value === compactKind;
      radio.disabled = state.saving || !skin || (radio.value === 'frame' && !options.import && compactKind !== 'frame');
    });
    if (skin?.compact?.kind === 'color') compactColor.value = skin.compact.color;
    compactColor.disabled = state.saving || !skin;
    compactDrop.hidden = compactKind !== 'frame' || Boolean(skin?.compact?.kind === 'frame') || !options.import;
    get<HTMLButtonElement>('.compact-edit').hidden = compactKind !== 'frame' || tab === 'compact';
    renderSizes(state);
  }

  return {
    element: root,
    render,
    setPage(info: readonly SkinPageInfo[]) {
      const next = new Map(info.map((item) => [item.id, item]));
      if (JSON.stringify([...next]) === JSON.stringify([...page])) return;
      page = next;
      if (view) render(view);
    },
    destroy() {
      if (frameRequest !== undefined) doc.defaultView?.cancelAnimationFrame(frameRequest);
      urls.clear();
    },
  };
}
