import styles from './panel.css';
import { IMAGE_LIMITS, STYLE_LIMITS, type SurfaceStyle, type ImageDecoration, type ImagePatch, type DesignTarget } from '../design/types';

export interface PanelState {
  selected: boolean;
  style: SurfaceStyle;
  dirty: boolean;
  saving: boolean;
  status: string;
  error: boolean;
  images: readonly ImageDecoration[];
  image: ImageDecoration | undefined;
}

export interface PanelActions {
  change(style: SurfaceStyle): void;
  save(): void;
  discard(): void;
  reset(): void;
  close(): void;
  imageImport(files: readonly File[]): void;
  imageSelect(id: string): void;
  imageChange(patch: ImagePatch): void;
  imageDelete(): void;
}

/** This UI has no site selectors, theme CSS or persistence logic. */
export function createCreatorPanel(doc: Document, actions: PanelActions, anchors: readonly DesignTarget[] = []) {
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
    <header><h2>デザインを編集</h2><button class="dock" type="button">パネルを左へ</button><button class="close" type="button" aria-label="編集を終了">×</button></header>
    <section class="assets">
      <button class="add-image" type="button">画像を追加</button>
      <input class="file" type="file" accept="image/png,image/webp" multiple aria-label="画像素材を追加" hidden>
      <p class="hint">PNG・WebPを選択、または画面へドロップ。1枚4MBまで。</p>
      <div class="layers" role="group" aria-label="画像レイヤー"></div>
    </section>
    <p class="hint">カードまたは画像をクリックして選択。カードの変更は同じ種類の動画カード全体に適用します。</p>
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
    <fieldset class="image-properties" aria-label="画像のプロパティ" hidden>
      <div class="property"><label>基準 <select aria-label="配置の基準" data-image-prop="anchor"><option value="viewport">画面</option></select></label></div>
      <div class="property row">
        <label>X <input type="number" aria-label="画像のX位置" data-image-prop="x" min="0" max="100" step="0.01" required>%</label>
        <label>Y <input type="number" aria-label="画像のY位置" data-image-prop="y" min="0" max="100" step="0.01" required>%</label>
      </div>
      <div class="property row">
        <label>幅 <input type="number" aria-label="画像の幅" data-image-prop="widthPx" min="${IMAGE_LIMITS.minSize}" max="${IMAGE_LIMITS.maxSize}" step="0.1" required>px</label>
        <label>高さ <input type="number" aria-label="画像の高さ" data-image-prop="heightPx" min="${IMAGE_LIMITS.minSize}" max="${IMAGE_LIMITS.maxSize}" step="0.1" required>px</label>
      </div>
      <div class="property"><label>角度 <input type="number" aria-label="画像の角度" data-image-prop="rotationDeg" min="-180" max="180" step="0.1" required>°</label></div>
      <div class="property"><label>不透明度 <output class="opacity-value"></output></label><input type="range" aria-label="画像の不透明度" data-image-prop="opacity" min="0" max="100" step="1"></div>
      <div class="property"><label>重なり順 <input type="number" aria-label="画像の重なり順" data-image-prop="zIndex" min="-100" max="100" step="1" required></label></div>
      <div class="property"><label><input type="checkbox" data-image-prop="visible">画像を表示</label><button class="delete-image" type="button">画像を削除</button></div>
    </fieldset>
    <p class="hint card-help">チェックを外した項目はテーマの見た目に戻ります。</p>
    <p class="hint">終了すると未保存の変更を破棄します。</p>
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
  const imageProperties = get<HTMLFieldSetElement>('.image-properties');
  const fileInput = get<HTMLInputElement>('.file');
  const addImage = get<HTMLButtonElement>('.add-image');
  const layers = get<HTMLDivElement>('.layers');
  const anchorSelect = get<HTMLSelectElement>('[data-image-prop="anchor"]');
  for (const anchor of anchors) {
    const option = doc.createElement('option'); option.value = anchor.id; option.textContent = anchor.label; anchorSelect.append(option);
  }
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
  properties.addEventListener('input', onInput);
  addImage.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { actions.imageImport([...fileInput.files ?? []]); fileInput.value = ''; });
  layers.addEventListener('click', (event) => {
    const id = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-layer-id]')?.dataset.layerId : undefined;
    if (id) actions.imageSelect(id);
  });
  imageProperties.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const property = input.dataset.imageProp;
    if (!property) return;
    if (!input.checkValidity()) { setText(status, '画像の値を範囲内で入力してください。'); status.dataset.error = 'true'; save.disabled = true; return; }
    if (property === 'anchor') actions.imageChange({ placement: { anchor: input.value === 'viewport' ? { kind: 'viewport' } : { kind: 'surface', target: input.value } } });
    else if (property === 'visible') actions.imageChange({ visible: (input as HTMLInputElement).checked });
    else if (property === 'opacity') actions.imageChange({ opacity: Number(input.value) / 100 });
    else if (property === 'zIndex') actions.imageChange({ zIndex: Number(input.value) });
    else actions.imageChange({ placement: { [property]: Number(input.value) / (property === 'x' || property === 'y' ? 100 : 1) } });
  });
  get<HTMLButtonElement>('.delete-image').addEventListener('click', actions.imageDelete);
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

  let layerKey = '';
  return {
    host,
    focus() { close.focus(); },
    render(state: PanelState) {
      imageProperties.hidden = !state.image;
      imageProperties.disabled = state.saving;
      properties.hidden = Boolean(state.image);
      get<HTMLParagraphElement>('.card-help').hidden = Boolean(state.image);
      addImage.disabled = state.saving || state.images.length >= IMAGE_LIMITS.count;
      const nextKey = JSON.stringify(state.images.map(({ id, name, zIndex, visible }) => ({ id, name, zIndex, visible })));
      if (layerKey !== nextKey) {
        layerKey = nextKey;
        layers.replaceChildren();
        [...state.images].sort((a, b) => b.zIndex - a.zIndex).forEach((image) => {
          const button = doc.createElement('button'); button.type = 'button'; button.dataset.layerId = image.id;
          button.textContent = `${image.visible ? '' : '非表示: '}${image.name}`; layers.append(button);
        });
      }
      layers.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.layerId === state.image?.id)); button.disabled = state.saving;
      });
      if (state.image) {
        const image = state.image;
        anchorSelect.value = image.placement.anchor.kind === 'viewport' ? 'viewport' : image.placement.anchor.target;
        for (const [property, value] of Object.entries(image.placement)) {
          if (property === 'anchor') continue;
          const input = get<HTMLInputElement>(`[data-image-prop="${property}"]`);
          input.value = String(Math.round(Number(value) * (property === 'x' || property === 'y' ? 10_000 : 10)) / (property === 'x' || property === 'y' ? 100 : 10));
        }
        get<HTMLInputElement>('[data-image-prop="opacity"]').value = String(Math.round(image.opacity * 100));
        setText(get<HTMLOutputElement>('.opacity-value'), `${Math.round(image.opacity * 100)}%`);
        get<HTMLInputElement>('[data-image-prop="zIndex"]').value = String(image.zIndex);
        get<HTMLInputElement>('[data-image-prop="visible"]').checked = image.visible;
      }
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
      setText(selection, state.image ? `画像: ${state.image.name}` : state.selected ? '動画カードを選択中' : 'カードが選択されていません');
      setText(status, state.status);
      status.dataset.error = String(state.error);
    },
    destroy() { host.remove(); },
  };
}
