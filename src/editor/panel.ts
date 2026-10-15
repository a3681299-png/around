import styles from './panel.css';
import { STYLE_LIMITS, type SurfaceStyle } from '../design/types';

export interface PanelState {
  selected: boolean;
  style: SurfaceStyle;
  dirty: boolean;
  saving: boolean;
  status: string;
  error: boolean;
}

export interface PanelActions {
  change(style: SurfaceStyle): void;
  save(): void;
  discard(): void;
  reset(): void;
  close(): void;
}

/** This UI has no site selectors, theme CSS or persistence logic. */
export function createCreatorPanel(doc: Document, actions: PanelActions) {
  const host = doc.createElement('aside');
  host.id = 'web-world-themes-creator';
  host.lang = 'ja';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'デザインエディター');
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = doc.createElement('style');
  sheet.textContent = styles;
  const main = doc.createElement('main');
  main.innerHTML = `
    <header><h2>カードを編集</h2><button class="dock" type="button">パネルを左へ</button><button class="close" type="button" aria-label="編集を終了">×</button></header>
    <p class="hint">カードをクリックして選択してください。選択した種類の動画カード全体に適用します。</p>
    <p class="selection" role="status">カードが選択されていません</p>
    <fieldset class="properties" aria-label="カードのプロパティ" disabled>
      <div class="property">
        <label><input type="checkbox" data-override="backgroundColor">背景色を変更</label>
        <input type="color" aria-label="背景色" value="#f4efff" disabled>
      </div>
      <div class="property">
        <label><input type="checkbox" data-override="border">枠線を変更</label>
        <input type="color" aria-label="枠線の色" value="#78668f" disabled>
        <label>枠線の太さ <input type="number" aria-label="枠線の太さ" min="0" max="${STYLE_LIMITS.borderWidth}" step="1" value="2" required disabled>px</label>
      </div>
      <div class="property">
        <label><input type="checkbox" data-override="borderRadiusPx">角丸を変更</label>
        <label>角丸 <input type="number" aria-label="角丸" min="0" max="${STYLE_LIMITS.borderRadius}" step="1" value="12" required disabled>px</label>
      </div>
      <button class="reset" type="button">カードの変更をリセット</button>
    </fieldset>
    <p class="hint">チェックを外した項目はテーマの見た目に戻ります。終了すると未保存の変更を破棄します。</p>
    <div class="actions"><button class="primary save" type="button">保存</button><button class="discard" type="button">変更を破棄</button></div>
    <p class="status" role="status" aria-live="polite"></p>`;
  shadow.append(sheet, main);
  const get = <T extends HTMLElement>(selector: string) => main.querySelector<T>(selector)!;
  const backgroundToggle = get<HTMLInputElement>('[data-override="backgroundColor"]');
  const borderToggle = get<HTMLInputElement>('[data-override="border"]');
  const radiusToggle = get<HTMLInputElement>('[data-override="borderRadiusPx"]');
  const background = get<HTMLInputElement>('[aria-label="背景色"]');
  const borderColor = get<HTMLInputElement>('[aria-label="枠線の色"]');
  const borderWidth = get<HTMLInputElement>('[aria-label="枠線の太さ"]');
  const radius = get<HTMLInputElement>('[aria-label="角丸"]');
  const properties = get<HTMLFieldSetElement>('.properties');
  const save = get<HTMLButtonElement>('.save');
  const discard = get<HTMLButtonElement>('.discard');
  const close = get<HTMLButtonElement>('.close');
  const dock = get<HTMLButtonElement>('.dock');
  const status = get<HTMLParagraphElement>('.status');
  const selection = get<HTMLParagraphElement>('.selection');
  const setText = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };
  const onInput = () => {
    background.disabled = !backgroundToggle.checked;
    borderColor.disabled = borderWidth.disabled = !borderToggle.checked;
    radius.disabled = !radiusToggle.checked;
    if ((borderToggle.checked && !borderWidth.checkValidity()) || (radiusToggle.checked && !radius.checkValidity())) {
      setText(status, '大きさを範囲内の整数で入力してください。');
      status.dataset.error = 'true';
      save.disabled = true;
      return;
    }
    const style: SurfaceStyle = {};
    if (backgroundToggle.checked) style.backgroundColor = background.value;
    if (borderToggle.checked) style.border = { color: borderColor.value, widthPx: Number(borderWidth.value) };
    if (radiusToggle.checked) style.borderRadiusPx = Number(radius.value);
    actions.change(style);
  };
  main.addEventListener('input', onInput);
  save.addEventListener('click', actions.save);
  discard.addEventListener('click', actions.discard);
  close.addEventListener('click', actions.close);
  dock.addEventListener('click', () => {
    const left = host.dataset.wwDock !== 'left';
    host.dataset.wwDock = left ? 'left' : 'right';
    dock.textContent = left ? 'パネルを右へ' : 'パネルを左へ';
  });
  get<HTMLButtonElement>('.reset').addEventListener('click', actions.reset);
  // Keep page shortcuts and native video controls out of property editing.
  const stop = (event: Event) => event.stopPropagation();
  host.addEventListener('keydown', stop);
  host.addEventListener('keyup', stop);
  host.addEventListener('click', stop);

  return {
    host,
    focus() { close.focus(); },
    render(state: PanelState) {
      properties.disabled = !state.selected || state.saving;
      backgroundToggle.checked = state.style.backgroundColor !== undefined;
      borderToggle.checked = state.style.border !== undefined;
      radiusToggle.checked = state.style.borderRadiusPx !== undefined;
      background.value = state.style.backgroundColor ?? '#f4efff';
      borderColor.value = state.style.border?.color ?? '#78668f';
      borderWidth.value = String(state.style.border?.widthPx ?? 2);
      radius.value = String(state.style.borderRadiusPx ?? 12);
      background.disabled = !backgroundToggle.checked;
      borderColor.disabled = borderWidth.disabled = !borderToggle.checked;
      radius.disabled = !radiusToggle.checked;
      save.disabled = discard.disabled = !state.dirty || state.saving;
      close.disabled = state.saving;
      setText(selection, state.selected ? '動画カードを選択中' : 'カードが選択されていません');
      setText(status, state.status);
      status.dataset.error = String(state.error);
    },
    destroy() { host.remove(); },
  };
}
