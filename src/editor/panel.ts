import tokens from './studio-tokens.css';
import styles from './panel.css';
import {
  IMAGE_LIMITS,
  STYLE_LIMITS,
  renderModeOf,
  type SurfaceStyle,
  type SurfaceSkin,
  type ImagePatch,
  type DesignTarget,
} from '../design/types';
import { ATMOSPHERE_ALPHA_CAP } from '../world/operations';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import { ASSET_MESSAGES } from '../assets/limits';
import type { Alignment, Distribution } from '../design/layout';
import { createModelPanel } from './model-panel';
import { createMotionPanel } from './motion-panel';
import { createEffectsPanel } from './effects-panel';
import { createLayerTree } from './layer-tree';
import { createStudioWorkbench } from '../studio/workbench';
import { glyphButton } from './icons';
import { arc, drawPen, svg } from './pen';
import { mountNumberScrub } from './number-scrub';
import { createSkinPanel, SKIN_PANEL_STYLES, type SkinPageInfo, type SkinPanelOptions } from './skin-panel';
import type { EditorTool, SkinPreview } from '../editor-core/types';
import type { SignalRule } from '../signals/keyframes';
import type { TimelinePort } from '../timeline/types';

export type { EditorView as PanelState } from '../editor-core/types';
import type { EditorView as PanelState } from '../editor-core/types';
import type { StudioPreferences } from '../studio/preferences';
export interface PanelOptions {
  onSettings?(): void;
  preferences?: StudioPreferences;
  /** The side panel's arrangement (one column, tabs): chosen by width, not by where the page runs. */
  sidePanel?: boolean;
  /** Where this editor page runs, for the 「サイドパネルで開く」/「別ウィンドウで開く」 actions. */
  surface?: 'sidepanel' | 'window';
  onSurface?(surface: 'sidepanel' | 'window'): void;
  hostLabel?: string;
  timeline?: TimelinePort | undefined;
  /** UI skin editing; omitted where the panel has no native page parts to dress. */
  skin?: SkinPanelOptions;
}

export interface PanelActions {
  change(style: SurfaceStyle): void;
  selectTarget(id: string): void;
  skin(skin: SurfaceSkin | null): void;
  skinPreview(value: SkinPreview): void;
  save(): void;
  discard(): void;
  reset(): void;
  close(): void;
  imageImport(files: readonly File[]): void;
  imageSelect(id: string, additive?: boolean): void;
  imageChange(patch: ImagePatch, id?: string): void;
  layerChange(id: string, patch: ImagePatch): void;
  imageDelete(id?: string): void;
  duplicate(id?: string): void;
  reorder(id: string, targetId: string, after: boolean): void;
  undo(): void;
  redo(): void;
  snap(value: boolean): void;
  layout(mode: Alignment | Distribution): void;
  group(): void;
  ungroup(): void;
  clearSelection(): void;
  selectAll(): void;
  tool(tool: EditorTool): void;
  beginEdit(): void;
  endEdit(cancel?: boolean): void;
  signalRule(rule: SignalRule): void;
  removeSignalRule(id: string): void;
  thumbnail(id: string): Promise<string | undefined>;
}

/** The editor page's panel (side panel or window). This UI has no site selectors, theme CSS or
 * persistence logic. */
export function createCreatorPanel(
  doc: Document,
  actions: PanelActions,
  anchors: readonly DesignTarget[] = [],
  options: PanelOptions = {},
) {
  const host = doc.createElement('aside');
  host.id = 'web-world-themes-creator';
  host.setAttribute('data-ww-signal-control', '');
  host.lang = 'ja';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'デザインエディター');
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = doc.createElement('style');
  // The WWT Studio system; the workbench adds its arrangement on top.
  sheet.textContent = tokens + styles + (options.skin ? SKIN_PANEL_STYLES : '');
  const main = doc.createElement('main');
  main.innerHTML = `
    <header><div><span class="eyebrow">WORLD CREATOR</span><h2>デザインを編集</h2></div><button class="dock" type="button" title="YouTubeの見たい場所に合わせて左右を切り替え">パネルを左へ</button><button class="close" type="button" aria-label="編集を終了" title="未保存の変更を破棄して終了">×</button></header>
    <div class="toolbar"><button class="undo" type="button" title="Ctrl＋Z">元に戻す</button><button class="redo" type="button" title="Ctrl＋Shift＋Z / Ctrl＋Y">やり直す</button><span class="dirty" role="status"></span></div>
    <div class="editor-body">
    <section class="assets">
      <button class="add-image" type="button">画像を追加</button>
      <button class="add-animation" type="button">アニメーションを追加</button>
      <button class="add-model" type="button">3Dモデルを追加</button>
      <input class="model-file" type="file" accept=".glb,.vrm,model/gltf-binary,model/vrm" multiple aria-label="3Dモデルを追加" hidden>
      <input class="file" type="file" accept="image/png,image/webp" multiple aria-label="画像素材を追加" hidden>
      <input class="animation-file" type="file" accept="image/gif,image/png,image/apng,image/webp,video/webm,application/json,.json,.apng" multiple aria-label="アニメーション素材を追加" hidden>
      <p class="hint asset-hint">ここへ素材をドロップしても追加できます。<span title="${ASSET_MESSAGES.formats}">対応形式 ⓘ</span></p>
    </section>
    <details class="layers-section" open><summary>レイヤー <span class="layer-count"></span></summary>
      <p class="hint selection-tip">行のチェックで複数選択できます。上が手前、つまみをドラッグして並び替え。</p>
      <div class="layers" role="group" aria-label="画像レイヤー"></div>
    </details>
    <p class="selection" role="status">カードが選択されていません</p>
    <label class="snap-toggle"><input class="snap" type="checkbox">スナップを有効にする</label>
    <p class="hint">画面・プレイヤー・他レイヤーに吸着。Altを押している間は自由配置。</p>
    <div class="selection-actions"><button class="group-layers" type="button" aria-describedby="ww-group-reason">選択をグループ化</button><button class="ungroup-layers" type="button" hidden>グループを解除</button><button class="duplicate-image" type="button" title="選択を複製（Ctrl＋D）">複製</button><button class="delete-image" type="button" title="選択を削除（Delete）" aria-label="画像を削除">削除</button><button class="inspect" type="button">プロパティを編集</button></div>
    <p class="hint grouping-help" id="ww-group-reason"></p>
    <fieldset class="layout-tools" aria-label="整列と配置" hidden>
      <div class="align-row"><button type="button" data-align="left">左揃え</button><button type="button" data-align="center-x">左右中央揃え</button><button type="button" data-align="right">右揃え</button></div>
      <div class="align-row"><button type="button" data-align="top">上揃え</button><button type="button" data-align="center-y">上下中央揃え</button><button type="button" data-align="bottom">下揃え</button></div>
      <div class="align-row"><button type="button" data-align="horizontal">横に等間隔</button><button type="button" data-align="vertical">縦に等間隔</button></div>
    </fieldset>
    <details class="properties-section" open><summary>プロパティ</summary>
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
      <p class="hint group-help" hidden>枠の縁、または子の画像をドラッグしてまとめて移動。Ctrlクリックか一覧で子を選ぶと個別に編集できます。ロックされた子がある間は全体を移動・削除できません。解除ではグループのマスクを外します。不透明度を100%に戻してから解除してください。</p>
      <div class="property"><label>名前 <input type="text" aria-label="レイヤー名" class="layer-name" maxlength="120" required></label></div>
      <div class="property"><label>基準 <select aria-label="配置の基準" data-image-prop="anchor"><option value="viewport">画面</option></select></label></div>
      <div class="property row">
        <label>X <input type="number" aria-label="画像のX位置" data-image-prop="x" min="0" max="100" step="0.01" required>%</label>
        <label>Y <input type="number" aria-label="画像のY位置" data-image-prop="y" min="0" max="100" step="0.01" required>%</label>
      </div>
      <div class="property row size-property">
        <label>幅 <input type="number" aria-label="画像の幅" data-image-prop="widthPx" min="${IMAGE_LIMITS.minSize}" max="${IMAGE_LIMITS.maxSize}" step="0.1" required>px</label>
        <label>高さ <input type="number" aria-label="画像の高さ" data-image-prop="heightPx" min="${IMAGE_LIMITS.minSize}" max="${IMAGE_LIMITS.maxSize}" step="0.1" required>px</label>
      </div>
      <div class="property rotation-property"><label>角度 <input type="number" aria-label="画像の角度" data-image-prop="rotationDeg" min="-180" max="180" step="0.1" required>°</label></div>
      <div class="property"><label>不透明度 <output class="opacity-value"></output></label><input type="range" aria-label="画像の不透明度" data-image-prop="opacity" min="0" max="100" step="1"></div>
      <div class="property render-mode-property"><label>描画モード <select aria-label="描画モード" data-image-prop="renderMode"><option value="normal">通常</option><option value="atmosphere">雰囲気</option></select></label><p class="hint render-mode-help" hidden>雰囲気レイヤーは操作面の上にも重なります。すべての雰囲気レイヤーを合わせた濃さは${Math.round(ATMOSPHERE_ALPHA_CAP * 100)}%以下に固定され、ぼかし・影・クリックは使えません。通常のレイヤーより下に描きます。</p></div>
      <fieldset class="playback" aria-label="アニメーションの再生" hidden>
        <div class="property playback-mode"><label>再生方式 <select data-playback="mode" aria-label="再生方式"><option value="auto">軽量再生（自動）</option><option value="controlled">時刻制御</option></select></label></div>
        <div class="property"><label><input type="checkbox" data-playback="playing">アニメーションを再生</label><label><input type="checkbox" data-playback="loop">ループ再生</label></div>
        <div class="property playback-speed"><label>再生速度 <input type="number" aria-label="再生速度" data-playback="speed" min="${ANIMATION_LIMITS.speedMin}" max="${ANIMATION_LIMITS.speedMax}" step="0.25" required>倍</label></div>
        <p class="hint">非表示タブ・動きを減らす設定では停止します。再読み込み後は先頭から再生します。</p>
        <p class="hint playback-help"></p>
        <p class="hint">再生予算を超えた素材は一時待機します。ほかの素材を非表示にすると再開できます。</p>
      </fieldset>
    </fieldset>
    <p class="hint card-help">チェックを外した項目はテーマの見た目に戻ります。</p>
    <p class="hint multi-help" hidden>複数選択は一括移動に対応しています。拡縮・回転は1枚ずつ操作してください。</p>
    </details>
    </div>
    <footer>
    <div class="actions"><button class="primary save" type="button">保存</button><button class="discard" type="button">変更を破棄</button></div>
    <p class="status" role="status" aria-live="polite"></p></footer>`;
  shadow.append(sheet, main);
  const displaySettings = doc.createElement('button');
  displaySettings.type = 'button';
  displaySettings.className = 'display-settings';
  displaySettings.textContent = '設定';
  displaySettings.title = '作品の表示のON/OFFと緊急OFFを開く';
  displaySettings.hidden = !options.onSettings;
  displaySettings.addEventListener('click', () => options.onSettings?.());
  main.querySelector('header')!.append(displaySettings);
  const get = <T extends HTMLElement>(selector: string) => main.querySelector<T>(selector)!;
  const tools = doc.createElement('div');
  tools.className = 'interaction-tools';
  tools.setAttribute('aria-label', '操作ツール');
  for (const [tool, label, key] of [
    ['select', '選択・変形', 'V'],
    ['browse', 'サイト操作', 'H'],
    ['card', '動画カードを編集', 'C'],
    ...(options.skin ? ([['skin', 'UIを着せ替え', 'U']] as const) : []),
  ] as const) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.tool = tool;
    glyphButton(button, tool, label, key);
    button.addEventListener('click', () => actions.tool(tool));
    tools.append(button);
  }
  get('.toolbar').append(tools);
  const saveState = doc.createElement('div'),
    saveFailure = doc.createElement('div'),
    retry = doc.createElement('button');
  glyphButton(get('.undo'), 'undo', '元に戻す', 'Ctrl＋Z');
  glyphButton(get('.redo'), 'redo', 'やり直す', 'Ctrl＋Shift＋Z / Ctrl＋Y');
  // The one save chip. A failed save keeps its words in the chip, then one reason and the way out.
  saveState.className = 'save-state';
  saveFailure.className = 'save-failure';
  saveFailure.hidden = true;
  const reason = doc.createElement('p');
  reason.className = 'save-reason';
  reason.textContent = 'ブラウザの保存領域に書き込めませんでした。';
  retry.type = 'button';
  retry.className = 'retry-save';
  retry.textContent = 'もう一度保存';
  retry.addEventListener('click', actions.save);
  saveFailure.append(reason, retry);
  saveState.append(get('.dirty'), saveFailure);
  get('.toolbar').append(saveState);
  // ww-rail: the chosen tool gets a G-pen circle, drawn round in 4 frames when it is chosen.
  let ringTool: string | undefined;
  const ringOn = (button: HTMLButtonElement | null) => {
    if (ringTool === button?.dataset.tool) return;
    tools.querySelector('.tool-ring')?.remove();
    ringTool = button?.dataset.tool;
    if (!button) return;
    const ring = svg(doc, '0 0 44 44', 'tool-ring');
    // An open ring from just right of the top, round, ending just left of it: thin at both ends.
    drawPen(ring, arc(22, 22, 17, -Math.PI / 2 + 0.35, Math.PI * 1.5 - 0.35), { width: 2.4, frames: 4 });
    button.append(ring);
  };
  const skinPanel = options.skin
    ? createSkinPanel(
        doc,
        {
          selectTarget: actions.selectTarget,
          skin: actions.skin,
          preview: actions.skinPreview,
          begin: actions.beginEdit,
          end: actions.endEdit,
        },
        options.skin,
      )
    : undefined;
  const backgroundToggle = get<HTMLInputElement>('[data-override="backgroundColor"]');
  const borderToggle = get<HTMLInputElement>('[data-override="border"]');
  const radiusToggle = get<HTMLInputElement>('[data-override="borderRadiusPx"]');
  const background = get<HTMLInputElement>('[aria-label="背景色"]');
  const borderColor = get<HTMLInputElement>('[aria-label="枠線の色"]');
  const borderWidth = get<HTMLInputElement>('[aria-label="枠線の太さ"]');
  const radius = get<HTMLInputElement>('[aria-label="角丸"]');
  const properties = get<HTMLFieldSetElement>('.properties');
  const imageProperties = get<HTMLFieldSetElement>('.image-properties');
  const changeImage = (patch: ImagePatch) => actions.imageChange(patch, current?.image?.id);
  const effects = createEffectsPanel(doc, changeImage);
  const motion = createMotionPanel(doc, changeImage, actions.beginEdit, actions.endEdit);
  const model = createModelPanel(doc, changeImage, actions.beginEdit, actions.endEdit);
  imageProperties.append(model.fieldset, motion.fieldset, effects.fieldset);
  const modelInput = get<HTMLInputElement>('.model-file'),
    addModel = get<HTMLButtonElement>('.add-model');
  addModel.addEventListener('click', () => modelInput.click());
  modelInput.addEventListener('change', () => {
    actions.imageImport([...(modelInput.files ?? [])]);
    modelInput.value = '';
  });
  const fileInput = get<HTMLInputElement>('.file');
  const addImage = get<HTMLButtonElement>('.add-image');
  const addAnimation = get<HTMLButtonElement>('.add-animation');
  const animationInput = get<HTMLInputElement>('.animation-file');
  glyphButton(addImage, 'image', '画像を追加');
  glyphButton(addAnimation, 'animation', 'アニメーションを追加');
  glyphButton(addModel, 'model3d', '3Dモデルを追加');
  const layers = get<HTMLDivElement>('.layers');
  const anchorSelect = get<HTMLSelectElement>('[data-image-prop="anchor"]');
  for (const anchor of anchors) {
    const option = doc.createElement('option');
    option.value = anchor.id;
    option.textContent = anchor.label;
    anchorSelect.append(option);
  }
  const save = get<HTMLButtonElement>('.save');
  const discard = get<HTMLButtonElement>('.discard');
  const close = get<HTMLButtonElement>('.close');
  const dock = get<HTMLButtonElement>('.dock');
  const status = get<HTMLParagraphElement>('.status');
  const selection = get<HTMLParagraphElement>('.selection');
  let current: PanelState | undefined;
  let pendingContext: { id: string; x: number; y: number } | undefined;
  const setText = (element: HTMLElement, value: string) => {
    if (element.textContent !== value) element.textContent = value;
  };
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
  addAnimation.addEventListener('click', () => animationInput.click());
  animationInput.addEventListener('change', () => {
    actions.imageImport([...(animationInput.files ?? [])]);
    animationInput.value = '';
  });
  fileInput.addEventListener('change', () => {
    actions.imageImport([...(fileInput.files ?? [])]);
    fileInput.value = '';
  });
  let workspace: ReturnType<typeof createStudioWorkbench>;
  const tree = createLayerTree(doc, layers, {
    select: actions.imageSelect,
    change: actions.layerChange,
    reorder: actions.reorder,
    thumbnail: actions.thumbnail,
    context: (id, x, y) => {
      if (!current?.selectedIds.includes(id)) actions.imageSelect(id);
      // A remote selection must be acknowledged before the menu uses its actions.
      if (current?.selectedIds.includes(id)) workspace.context(x, y);
      else pendingContext = { id, x, y };
    },
  });
  workspace = createStudioWorkbench(doc, host, main, tree, actions, options);
  // The workbench rebuilds the body, so the skin editor joins its inspector column.
  if (skinPanel) get('.studio-inspectors').prepend(skinPanel.element);
  const layerName = get<HTMLInputElement>('.layer-name');
  layerName.addEventListener('change', () => {
    const name = layerName.value.trim();
    if (!name || /[\u0000-\u001f]/.test(name)) {
      layerName.value = current?.image?.name ?? '';
      return;
    }
    changeImage({ name });
  });
  imageProperties.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const property = input.dataset.imageProp;
    if (!property) return;
    if (!input.checkValidity()) {
      setText(status, '画像の値を範囲内で入力してください。');
      status.dataset.error = 'true';
      save.disabled = true;
      return;
    }
    if (property === 'anchor')
      changeImage({
        placement: {
          anchor: input.value === 'viewport' ? { kind: 'viewport' } : { kind: 'surface', target: input.value },
        },
      });
    else if (property === 'opacity') changeImage({ opacity: Number(input.value) / 100 });
    else if (property === 'renderMode')
      changeImage({ renderMode: input.value === 'atmosphere' ? 'atmosphere' : 'normal' });
    else
      changeImage({
        placement: { [property]: Number(input.value) / (property === 'x' || property === 'y' ? 100 : 1) },
      });
  });
  get<HTMLFieldSetElement>('.playback').addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.checkValidity()) {
      setText(status, '再生速度は0.25〜3倍で入力してください。');
      status.dataset.error = 'true';
      save.disabled = true;
      return;
    }
    const key = input.dataset.playback;
    if (key)
      changeImage({
        playback: { [key]: key === 'mode' ? input.value : key === 'speed' ? Number(input.value) : input.checked },
      });
  });
  get<HTMLButtonElement>('.delete-image').addEventListener('click', () => actions.imageDelete());
  get<HTMLButtonElement>('.duplicate-image').addEventListener('click', () => actions.duplicate());
  get<HTMLButtonElement>('.group-layers').addEventListener('click', actions.group);
  get<HTMLButtonElement>('.ungroup-layers').addEventListener('click', actions.ungroup);
  get<HTMLButtonElement>('.undo').addEventListener('click', actions.undo);
  get<HTMLButtonElement>('.redo').addEventListener('click', actions.redo);
  get<HTMLInputElement>('.snap').addEventListener('change', (event) =>
    actions.snap((event.target as HTMLInputElement).checked),
  );
  get<HTMLFieldSetElement>('.layout-tools').addEventListener('click', (event) => {
    const mode =
      event.target instanceof HTMLElement
        ? (event.target.dataset.align as Alignment | Distribution | undefined)
        : undefined;
    if (mode) actions.layout(mode);
  });
  save.addEventListener('click', actions.save);
  discard.addEventListener('click', actions.discard);
  close.addEventListener('click', actions.close);
  dock.addEventListener('click', () => {
    host.dataset.wwDock = host.dataset.wwDock !== 'left' ? 'left' : 'right';
    workspace.layoutChanged();
  });
  get<HTMLButtonElement>('.reset').addEventListener('click', actions.reset);
  // Keep page shortcuts and native video controls out of property editing.
  const stop = (event: Event) => event.stopPropagation();
  host.addEventListener('keydown', stop);
  host.addEventListener('keyup', stop);
  host.addEventListener('click', stop);

  const stopScrub = mountNumberScrub(doc, host, main, actions.beginEdit, actions.endEdit);
  return {
    host,
    focus() {
      get<HTMLButtonElement>('[data-tool="select"]').focus();
    },
    render(state: PanelState) {
      current = state;
      main.toggleAttribute('data-skin-tool', Boolean(skinPanel) && state.tool === 'skin');
      skinPanel?.render(state);
      imageProperties.hidden = state.selected;
      imageProperties.disabled = !state.image || state.saving || Boolean(state.image?.locked) || state.inheritedLocked;
      imageProperties.toggleAttribute('data-empty', !state.image);
      const opacityDriven = Boolean(
        state.image &&
        state.signalRules?.some(
          (rule) => rule.enabled && rule.target.property === 'opacity' && rule.target.layerId === state.image!.id,
        ),
      );
      imageProperties.toggleAttribute('data-opacity-driven', opacityDriven);
      tools.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.tool === (state.tool ?? 'select')));
      });
      ringOn(tools.querySelector<HTMLButtonElement>('[data-tool][aria-pressed="true"]'));
      const isGroup = state.image?.kind === 'group';
      imageProperties.setAttribute('aria-label', isGroup ? 'グループのプロパティ' : '画像のプロパティ');
      get<HTMLElement>('.group-help').hidden = !isGroup;
      get<HTMLElement>('.size-property').hidden = get<HTMLElement>('.rotation-property').hidden = isGroup;
      get<HTMLElement>('[data-image-prop="anchor"]').closest<HTMLElement>('.property')!.hidden = isGroup;
      for (const key of ['widthPx', 'heightPx', 'rotationDeg', 'anchor'])
        get<HTMLInputElement>(`[data-image-prop="${key}"]`).disabled =
          isGroup || (key === 'anchor' && !state.canChangeAnchor.allowed);
      for (const key of ['x', 'y']) {
        const input = get<HTMLInputElement>(`[data-image-prop="${key}"]`);
        input.disabled = isGroup && !state.groupPositionAvailable;
        if (isGroup) {
          input.removeAttribute('min');
          input.removeAttribute('max');
        } else {
          input.min = '0';
          input.max = '100';
        }
        input.setAttribute('aria-label', `${isGroup ? 'グループ' : '画像'}の${key.toUpperCase()}位置`);
      }
      get<HTMLInputElement>('[data-image-prop="opacity"]').setAttribute(
        'aria-label',
        `${isGroup ? 'グループ' : '画像'}の不透明度`,
      );
      effects.render(state.image);
      motion.render(state.image);
      model.render(state.image);
      motion.fieldset.disabled = !state.canChangeMotion.allowed;
      properties.hidden = !state.selected;
      get<HTMLParagraphElement>('.card-help').hidden = !state.selected;
      get<HTMLParagraphElement>('.multi-help').hidden = state.selectedIds.length < 2;
      // Studio also uses saving to lock its surface while disconnected. That
      // transport lock can be newer than the last authoritative capabilities.
      get<HTMLButtonElement>('.delete-image').disabled = state.saving || !state.canDelete.allowed;
      get<HTMLButtonElement>('.duplicate-image').disabled = state.saving || !state.canDuplicate.allowed;
      get<HTMLButtonElement>('.group-layers').disabled = state.saving || !state.canGroup.allowed;
      get<HTMLButtonElement>('.group-layers').hidden = isGroup;
      get<HTMLButtonElement>('.ungroup-layers').hidden = !isGroup;
      get<HTMLButtonElement>('.ungroup-layers').disabled = state.saving || !state.canUngroup.allowed;
      get<HTMLElement>('.grouping-help').hidden = isGroup;
      setText(
        get<HTMLElement>('.grouping-help'),
        state.groupingReason || 'まとめて移動したり、同じマスクを適用できます。',
      );
      get<HTMLButtonElement>('.undo').disabled = !state.canUndo || state.saving;
      get<HTMLButtonElement>('.redo').disabled = !state.canRedo || state.saving;
      get<HTMLInputElement>('.snap').checked = state.snapping;
      get<HTMLInputElement>('.snap').disabled = state.saving;
      get<HTMLFieldSetElement>('.layout-tools').hidden = state.selectedIds.length < 2;
      main.querySelectorAll<HTMLButtonElement>('[data-align]').forEach((button) => {
        const availability = ['horizontal', 'vertical'].includes(button.dataset.align!)
          ? state.canDistribute
          : state.canAlign;
        button.disabled = state.saving || !availability.allowed;
      });
      const saveFailed = state.error && state.status.startsWith('保存でき');
      // The chip carries the save state only, in the README's words; other errors are told in the
      // footer.
      setText(
        get<HTMLElement>('.dirty'),
        saveFailed ? '保存できませんでした' : state.saving ? '処理中…' : state.dirty ? '未保存' : '保存済み',
      );
      get<HTMLElement>('.dirty').dataset.dirty = String(state.dirty);
      get<HTMLElement>('.dirty').dataset.state = saveFailed
        ? 'failed'
        : state.saving
          ? 'saving'
          : state.dirty
            ? 'dirty'
            : 'saved';
      saveFailure.hidden = !saveFailed;
      saveState.toggleAttribute('data-failed', Boolean(saveFailed));
      retry.disabled = state.saving;
      setText(
        get<HTMLElement>('.layer-count'),
        `${state.images.length} / ${IMAGE_LIMITS.count}${state.groups.length ? `・グループ${state.groups.length}` : ''}`,
      );
      addImage.disabled = state.saving || !state.canAddImage.allowed;
      addModel.disabled = state.saving || !state.canAddModel.allowed;
      addAnimation.disabled = state.saving || !state.canAddAnimation.allowed;
      get<HTMLFieldSetElement>('.playback').hidden = state.image?.kind !== 'animation';
      if (state.image?.kind === 'animation') {
        get<HTMLInputElement>('[data-playback="playing"]').checked = state.image.playback.playing;
        get<HTMLInputElement>('[data-playback="loop"]').checked = state.image.playback.loop;
        get<HTMLInputElement>('[data-playback="speed"]').value = String(state.image.playback.speed);
        get<HTMLSelectElement>('[data-playback="mode"]').value = state.image.playback.mode ?? 'controlled';
        get<HTMLElement>('.playback-mode').hidden = state.image.format === 'lottie' || state.image.format === 'webm';
        get<HTMLElement>('.playback-speed').hidden = false;
        setText(
          get<HTMLElement>('.playback-help'),
          state.image.format === 'webm'
            ? '動画は標準プレイヤーで再生します。シーク位置には誤差があります。'
            : state.image.format === 'lottie'
              ? '対応する図形アニメーションをフレーム単位で再生します。'
              : '軽量再生では切替時の再開位置に誤差があります。停止・速度変更時は時刻制御に切り替わります。',
        );
      }
      tree.render(state);
      if (state.image) {
        const image = state.image;
        if (shadow.activeElement !== layerName) layerName.value = image.name;
        anchorSelect.value = image.placement.anchor.kind === 'viewport' ? 'viewport' : image.placement.anchor.target;
        for (const [property, value] of Object.entries(image.placement)) {
          if (property === 'anchor') continue;
          const input = get<HTMLInputElement>(`[data-image-prop="${property}"]`);
          input.value = String(
            Math.round(Number(value) * (property === 'x' || property === 'y' ? 10_000 : 10)) /
              (property === 'x' || property === 'y' ? 100 : 10),
          );
        }
        get<HTMLInputElement>('[data-image-prop="opacity"]').value = String(Math.round(image.opacity * 100));
        get<HTMLSelectElement>('[data-image-prop="renderMode"]').value = renderModeOf(image);
        get<HTMLElement>('.render-mode-help').hidden = renderModeOf(image) !== 'atmosphere';
        setText(get<HTMLOutputElement>('.opacity-value'), `${Math.round(image.opacity * 100)}%`);
      } else {
        imageProperties
          .querySelectorAll<HTMLInputElement>('input[type="text"],input[type="number"]')
          .forEach((input) => {
            input.value = '';
          });
        get<HTMLOutputElement>('.opacity-value').value = '—';
      }
      if (opacityDriven)
        setText(
          get<HTMLOutputElement>('.opacity-value'),
          state.signalRules?.find(
            (rule) => rule.enabled && rule.target.property === 'opacity' && rule.target.layerId === state.image?.id,
          )?.source.signal === 'page.scroll.progress'
            ? 'スクロールに接続'
            : 'シグナルに接続',
        );
      get<HTMLInputElement>('[data-image-prop="opacity"]').disabled = opacityDriven;
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
      close.title = state.dirty ? '編集を終了（未保存の変更を破棄）' : '編集を終了';
      setText(
        selection,
        state.image
          ? `${state.image.kind === 'group' ? 'グループ' : state.image.kind === 'animation' ? 'アニメーション' : '画像'}: ${state.image.name}${state.image.locked || state.inheritedLocked ? '（ロック中）' : ''}`
          : state.selectedIds.length > 1
            ? `${state.selectedIds.length}レイヤーを選択中`
            : state.selected
              ? `${options.skin?.targets.find((target) => target.id === state.target)?.label ?? '動画カード'}を選択中`
              : 'カードまたは画像を選択してください',
      );
      setText(status, state.status);
      status.dataset.error = String(state.error);
      // The save state shows in the header chip alone. Save messages still reach assistive technology
      // through this live region, but are not drawn a second time in the footer.
      status.toggleAttribute('data-save', state.status === '保存しました。' || Boolean(saveFailed));
      workspace.render(state);
      if (pendingContext && state.selectedIds.includes(pendingContext.id)) {
        workspace.context(pendingContext.x, pendingContext.y);
        pendingContext = undefined;
      }
    },
    setSkinPage(info: readonly SkinPageInfo[]) {
      skinPanel?.setPage(info);
    },
    destroy() {
      skinPanel?.destroy();
      stopScrub();
      workspace.destroy();
      tree.destroy();
      host.remove();
    },
  };
}
