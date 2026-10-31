import { ungroupingReason } from './groups';
import type { PanelState, PanelOptions } from './panel';
import { transientPreferences } from '../studio/preferences';
import { drawPen, drawRule, goldenSpiral, line, arc, svg } from './pen';

type Area = 'layers' | 'properties' | 'help';
interface TreeView {
  setActive(active: boolean): void;
}

/** The editor's panes, tabs, selection bar and menus, which the workbench arranges. Onboarding
 * preferences stay outside the artwork, history and Runtime. */
export function createWorkspace(
  doc: Document,
  host: HTMLElement,
  main: HTMLElement,
  tree: TreeView,
  clear: () => void,
  selectAll: () => void,
  options: PanelOptions = {},
) {
  const preferences = options.preferences ?? transientPreferences;
  const get = <T extends HTMLElement>(selector: string) => main.querySelector<T>(selector)!;
  const body = get('.editor-body'),
    assets = get('.assets'),
    selection = get('.selection');
  const compact = doc.defaultView!.matchMedia('(max-width: 740px)');
  let area: Area = 'layers',
    split = false,
    state: PanelState | undefined,
    lastCard = false;
  let alive = true;
  const nav = doc.createElement('nav');
  nav.className = 'workspace-nav';
  nav.setAttribute('aria-label', '編集する領域');
  nav.innerHTML = `<div role="tablist" aria-label="作業領域"><button type="button" role="tab" id="ww-tab-layers" data-area="layers" aria-controls="ww-layers-pane">レイヤー</button><button type="button" role="tab" id="ww-tab-properties" data-area="properties" aria-controls="ww-properties-pane">プロパティ</button><button type="button" role="tab" id="ww-tab-help" data-area="help" aria-controls="ww-help-pane">使い方</button></div><button class="split" type="button" aria-pressed="false" title="一覧と設定を横に並べる">並べる</button>`;
  const selected = doc.createElement('section');
  selected.className = 'selection-bar';
  selected.setAttribute('aria-label', '選択したレイヤーの操作');
  const countRow = doc.createElement('div');
  countRow.className = 'selection-count-row';
  countRow.innerHTML = `<strong class="selected-count" role="status">0個選択中</strong><div><button class="select-all" type="button" title="最上位のレイヤーをすべて選択">すべて選択</button><button class="clear-selection" type="button" title="Esc">選択解除</button></div>`;
  selected.append(countRow, selection, get('.selection-actions'), get('.grouping-help'));
  const maskShortcut = doc.createElement('button');
  maskShortcut.type = 'button';
  maskShortcut.className = 'mask-shortcut';
  maskShortcut.textContent = '光とマスクを設定';
  selected.append(maskShortcut);
  const ungroupHelp = doc.createElement('p');
  ungroupHelp.className = 'hint ungroup-help';
  selected.append(ungroupHelp);
  main.insertBefore(nav, body);
  main.insertBefore(selected, body);

  const layersPane = doc.createElement('section');
  layersPane.className = 'layers-pane';
  layersPane.id = 'ww-layers-pane';
  layersPane.setAttribute('role', 'tabpanel');
  layersPane.setAttribute('aria-labelledby', 'ww-tab-layers');
  const guide = doc.createElement('aside');
  guide.className = 'quick-guide';
  guide.innerHTML = `<button class="dismiss-guide" type="button" aria-label="操作ガイドを閉じる">×</button><strong>はじめての制作</strong><ol><li>画像やアニメーションを追加</li><li>一覧のチェックで2個以上選択</li><li>グループ化 → 光とマスク → 保存</li></ol>`;
  const guideKey = 'webWorldThemes.creator.guideDismissed';
  void preferences.read(guideKey).then(
    (value) => {
      if (alive && value === true) guide.hidden = true;
    },
    () => undefined,
  );
  const empty = doc.createElement('div');
  empty.className = 'empty-layers';
  {
    // ww-empty: the golden rectangle and its spiral are constructed, then the words appear.
    empty.classList.add('ww-empty');
    const drawing = svg(doc, '0 0 236 152', 'ww-empty__drawing'),
      g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', 'translate(8 8)');
    drawing.append(g);
    // Guides (ruler), then the main lines (G-pen, ink; the compass arc in pen-bone), then the accent.
    [
      'M-6 136H226',
      'M0 0h136v136H0Z',
      'M68 136 136 0',
      'M136-4v144',
      'M132 84h92',
      'M168 80v60',
      'M132 104h40',
    ].forEach((d, i) => drawRule(g, d, i));
    drawPen(g, arc(68, 136, 152, Math.atan2(-136, 68), 0), { width: 1.8, color: 'var(--pen-bone)', delay: 7 });
    drawPen(g, line(-4, 0, 224, 0), { width: 3.4, color: 'var(--ink)', delay: 8 });
    drawPen(g, line(220, -4, 220, 140), { width: 3.4, color: 'var(--ink)', delay: 9 });
    drawPen(g, line(224, 136, -4, 136), { width: 3.4, color: 'var(--ink)', delay: 10 });
    drawPen(g, line(0, 140, 0, -4), { width: 3.4, color: 'var(--ink)', delay: 11 });
    // The spiral takes 8 frames; the words follow it (frames 20–22).
    drawPen(g, goldenSpiral(0, 0, [136, 84, 52, 32, 20, 12]), {
      width: 3.4,
      color: 'var(--cobalt)',
      delay: 12,
      frames: 8,
    });
    const title = doc.createElement('strong'),
      text = doc.createElement('p'),
      actions = doc.createElement('div'),
      add = doc.createElement('button');
    title.className = 'ww-empty__title ww-appear';
    title.textContent = 'まだレイヤーがありません';
    text.className = 'ww-empty__text ww-appear';
    text.textContent = '画像やアニメーションを置くと、YouTubeの上で動かせます。';
    actions.className = 'ww-empty__actions ww-appear';
    add.type = 'button';
    add.textContent = '画像を追加';
    actions.append(add);
    [title, text, actions].forEach((node, i) => node.style.setProperty('--ww-delay', `${Math.round((20 + i) * 83)}ms`));
    empty.append(drawing, title, text, actions);
  }
  const layerSection = get<HTMLDetailsElement>('.layers-section');
  layersPane.append(assets, guide, layerSection, empty);
  empty.querySelector('button')!.addEventListener('click', () => get<HTMLButtonElement>('.add-image').click());
  const propsPane = doc.createElement('section');
  propsPane.className = 'inspector-pane';
  propsPane.id = 'ww-properties-pane';
  propsPane.setAttribute('role', 'tabpanel');
  propsPane.setAttribute('aria-labelledby', 'ww-tab-properties');
  const propertySection = get<HTMLDetailsElement>('.properties-section');
  const snapHelp = get('.snap-toggle').nextElementSibling!;
  const layout = doc.createElement('details');
  layout.className = 'arrangement-section';
  layout.open = false;
  const layoutTitle = doc.createElement('summary');
  layoutTitle.textContent = 'スナップと整列';
  layout.append(layoutTitle, get('.snap-toggle'), snapHelp, get('.layout-tools'));
  propsPane.append(propertySection, layout);
  const noSelection = doc.createElement('p');
  noSelection.className = 'inspector-empty hint';
  noSelection.textContent = 'キャンバス上の素材や動画カード、またはレイヤー一覧から編集対象を選んでください。';
  propsPane.prepend(noSelection);
  const propsSummary = propertySection.querySelector('summary')!;
  propsSummary.textContent = '基本';
  const help = doc.createElement('section');
  help.id = 'ww-help-pane';
  help.className = 'help-pane';
  help.setAttribute('role', 'tabpanel');
  help.setAttribute('aria-labelledby', 'ww-tab-help');
  help.innerHTML = `<h3>つくる手順</h3><ol><li>素材を追加してキャンバスで位置を決める</li><li>一覧のチェックで複数選択し、グループ化</li><li>「光とマスクを設定」で円形マスクを有効にする</li><li>「振る舞い」でマウス追従や動画との連動を設定</li><li>保存すると、ほかのタブにも反映されます</li></ol><h3>選択とグループ</h3><p>行をクリックすると1個選択。チェックなら選択を追加・解除できます。Ctrl／Shiftクリックも使えます。</p><p>グループ化には、同じ配置基準と連続した重なり順が必要です。理由はグループ化ボタンの下に表示します。グループの中の素材は一覧から個別に選べます。</p><p>名前は行をダブルクリック、またはプロパティで変更。右クリックと「…」からも共通操作ができます。</p><h3>ショートカット</h3><dl><dt>V / H / C / U</dt><dd>選択・変形 / サイト操作 / カード編集 / UIの着せ替え</dd><dt>数値ラベルを左右にドラッグ</dt><dd>値を調整（Shiftで細かく調整、Escで中止）</dd><dt>Ctrl / Shift ＋ クリック</dt><dd>複数選択</dd><dt>矢印 / Shift ＋ 矢印</dt><dd>1px / 10px移動</dd><dt>Ctrl ＋ D</dt><dd>複製</dd><dt>Delete</dt><dd>削除（ロック中は保護）</dd><dt>Esc</dt><dd>選択解除 / メニューを閉じる</dd><dt>Ctrl ＋ Z</dt><dd>元に戻す</dd><dt>Ctrl ＋ Shift ＋ Z / Ctrl ＋ Y</dt><dd>やり直す</dd><dt>Alt ＋ ドラッグ</dt><dd>スナップを一時解除</dd></dl><p class="hint">MacではCtrlの代わりに⌘。入力欄では文字の編集を優先します。終了すると未保存の変更を破棄します。</p><button type="button" class="show-guide">操作ガイドをもう一度表示</button>`;
  body.replaceChildren(layersPane, propsPane, help);
  // Effects and playback are sections of the inspector, not transform controls.
  const imageProps = get('.image-properties');
  const basic = doc.createElement('details');
  basic.open = true;
  basic.className = 'transform-section';
  const basicTitle = doc.createElement('summary');
  basicTitle.textContent = '位置と外観';
  basic.append(basicTitle);
  [...imageProps.children]
    .filter(
      (node) => !node.matches('.playback, .model-panel, .motion-panel, [aria-label="マスクと振る舞い"], .group-help'),
    )
    .forEach((node) => basic.append(node));
  imageProps.prepend(basic);
  basic.append(get('.group-help'));
  const playback = get('.playback');
  const playbackSection = doc.createElement('details');
  playbackSection.className = 'playback-section';
  playbackSection.open = true;
  const playbackTitle = doc.createElement('summary');
  playbackTitle.textContent = 'アニメーション再生';
  playback.before(playbackSection);
  playbackSection.append(playbackTitle, playback);
  get('.group-help').textContent =
    'キャンバスの枠の縁をドラッグしてまとめて移動できます。子の素材は一覧から選んで編集できます。';

  const menu = doc.createElement('div');
  menu.className = 'context-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'レイヤーの操作');
  const commands: [string, string][] = [
    ['inspect', 'プロパティを編集'],
    ['duplicate-image', '複製'],
    ['group-layers', '選択をグループ化'],
    ['ungroup-layers', 'グループを解除'],
    ['delete-image', '削除'],
  ];
  commands.forEach(([command, label]) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.command = command;
    button.textContent = label;
    button.setAttribute('role', 'menuitem');
    menu.append(button);
  });
  main.append(menu);
  let menuOrigin: HTMLElement | undefined;
  function closeMenu(focus = false) {
    menu.hidden = true;
    if (focus && menuOrigin?.isConnected) menuOrigin.focus({ preventScroll: true });
  }
  menu.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-command]');
    if (!button || button.disabled) return;
    closeMenu();
    get<HTMLButtonElement>(`.${button.dataset.command}`).click();
  });
  const outside = (event: Event) => {
    if (!event.composedPath().includes(menu)) closeMenu();
  };
  doc.addEventListener('pointerdown', outside, true);
  // A scroll event arrives a frame after the scroll. One that moved before the menu opened (the
  // wheel just before a right-click, a row brought into view) must not close the new menu.
  let scrollAtOpen = new WeakMap<EventTarget, string>();
  const scrollKey = (node: Element) => `${node.scrollTop},${node.scrollLeft}`;
  body.addEventListener(
    'scroll',
    (event) => {
      const target = event.target as Element;
      if (scrollAtOpen.get(target) !== scrollKey(target)) closeMenu();
    },
    true,
  );
  // Menus/help own Escape before the editor's capture-phase selection shortcut.
  const menuKeys = (event: KeyboardEvent) => {
    if (menu.hidden || !event.composedPath().includes(host)) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      closeMenu(event.key === 'Escape');
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([hidden])')];
      const current = items.indexOf((host.shadowRoot?.activeElement ?? null) as HTMLButtonElement);
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  doc.addEventListener('keydown', menuKeys, true);

  function show(next: Area) {
    area = next;
    closeMenu();
    host.dataset.area = next;
    nav.querySelectorAll<HTMLButtonElement>('[data-area]').forEach((button) => {
      const selected = button.dataset.area === next;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    layersPane.hidden = next !== 'layers' && !(split && next === 'properties');
    propsPane.hidden = next !== 'properties' && !(split && next === 'layers');
    layersPane.setAttribute('role', split && !compact.matches ? 'region' : 'tabpanel');
    propsPane.setAttribute('role', split && !compact.matches ? 'region' : 'tabpanel');
    help.hidden = next !== 'help';
    selected.hidden = next === 'help';
    get('.inspect').hidden = next === 'properties';
    maskShortcut.hidden = next === 'properties' || !state?.image;
    get('.group-layers').hidden =
      state?.image?.kind === 'group' || (next === 'properties' && (state?.selectedIds.length ?? 0) < 2);
    get('.grouping-help').hidden = get('.group-layers').hidden;
    tree.setActive(!layersPane.hidden && !(split && compact.matches && next === 'properties'));
  }
  nav.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-area]');
    if (button) show(button.dataset.area as Area);
  });
  // Workbench owns its simultaneous panes; legacy tab adaptation must not hide
  // them after the Workbench's resize handler has already arranged the grid.
  const adapt = () => {
    if (!host.hasAttribute('data-workbench')) show(area);
  };
  compact.addEventListener('change', adapt);
  nav.addEventListener('keydown', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-area]');
    if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    // Only the tabs offered here: the side panel's column keeps 使い方 in its ヘルプ menu.
    const tabs = [...nav.querySelectorAll<HTMLButtonElement>('[data-area]')].filter((tab) => !tab.hidden),
      index = tabs.indexOf(button),
      count = tabs.length;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
    show(tabs[next]!.dataset.area as Area);
    tabs[next]!.focus();
    event.preventDefault();
  });
  get('.inspect').addEventListener('click', () => show('properties'));
  maskShortcut.addEventListener('click', () => {
    if (!host.hasAttribute('data-workbench')) basic.open = false;
    show('properties');
    const effects = get<HTMLDetailsElement>('.effects-section');
    effects.open = true;
    effects.scrollIntoView({ block: 'start' });
  });
  const splitButton = get<HTMLButtonElement>('.split');
  splitButton.setAttribute('aria-pressed', String(split));
  splitButton.textContent = split ? '切り替え表示' : '並べる';
  splitButton.addEventListener('click', () => {
    split = !split;
    host.toggleAttribute('data-split', split);
    splitButton.setAttribute('aria-pressed', String(split));
    splitButton.textContent = split ? '切り替え表示' : '並べる';
    show(area);
  });
  get('.clear-selection').addEventListener('click', clear);
  get('.select-all').addEventListener('click', selectAll);
  get('.dismiss-guide').addEventListener('click', () => {
    guide.hidden = true;
    void preferences.write(guideKey, true).catch(() => undefined);
  });
  get('.show-guide').addEventListener('click', () => {
    guide.hidden = false;
    void preferences.write(guideKey, false).catch(() => undefined);
    show('layers');
  });
  show(area);
  return {
    inspect() {
      show('properties');
    },
    context(x: number, y: number) {
      if (!state || state.saving) return;
      menuOrigin = (host.shadowRoot?.activeElement ?? undefined) as HTMLElement | undefined;
      commands.forEach(([command]) => {
        const source = get<HTMLButtonElement>(`.${command}`),
          target = menu.querySelector<HTMLButtonElement>(`[data-command="${command}"]`)!;
        target.disabled = source.disabled;
        target.hidden = source.hidden;
      });
      menu.hidden = false;
      scrollAtOpen = new WeakMap();
      for (const node of [body, ...body.querySelectorAll('.layers-pane, .layers, .inspector-pane, .help-pane')])
        scrollAtOpen.set(node, scrollKey(node));
      const rect = host.getBoundingClientRect(),
        menuRect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(4, Math.min(rect.width - menuRect.width - 4, x - rect.left))}px`;
      menu.style.top = `${Math.max(4, Math.min(rect.height - menuRect.height - 4, y - rect.top))}px`;
      menu.querySelector<HTMLButtonElement>('button:not(:disabled):not([hidden])')?.focus();
    },
    render(next: PanelState) {
      // Repeated transport snapshots must not close an unchanged context menu.
      if (
        !menu.hidden &&
        state &&
        (state.saving !== next.saving ||
          state.selected !== next.selected ||
          state.selectedIds.join(',') !== next.selectedIds.join(',') ||
          JSON.stringify([state.images, state.groups]) !== JSON.stringify([next.images, next.groups]))
      )
        closeMenu();
      state = next;
      get('.selected-count').textContent = `${next.selectedIds.length}個選択中`;
      get<HTMLButtonElement>('.clear-selection').disabled = next.saving || (!next.selectedIds.length && !next.selected);
      get<HTMLButtonElement>('.select-all').disabled = next.saving || !next.images.length;
      get<HTMLButtonElement>('.inspect').disabled = !next.selectedIds.length && !next.selected;
      maskShortcut.hidden = !next.image || area === 'properties';
      maskShortcut.disabled = next.saving || Boolean(next.image?.locked) || next.inheritedLocked;
      empty.hidden = next.images.length > 0;
      layerSection.hidden = !next.images.length;
      guide.dataset.step = next.groups.length
        ? 'mask'
        : next.selectedIds.length > 1
          ? 'group'
          : next.images.length
            ? 'select'
            : 'add';
      noSelection.hidden = Boolean(next.image || next.selected || next.selectedIds.length > 1);
      playbackSection.hidden = next.image?.kind !== 'animation';
      layout.hidden = !next.selectedIds.length;
      get<HTMLElement>('.dirty').dataset.error = String(next.error);
      get<HTMLElement>('.status').setAttribute('role', next.error ? 'alert' : 'status');
      const ungroupReason = ungroupingReason(
        next.image?.kind === 'group' ? next.image : undefined,
        next.signalRules ? [...next.signalRules] : [],
      );
      get('.ungroup-layers').title = ungroupReason || '子の基本配置を維持して解除します。グループのマスクは外れます。';
      get('.group-layers').title = next.groupingReason || '選択した素材をまとめます。';
      get('.group-layers').hidden =
        next.image?.kind === 'group' || (area === 'properties' && next.selectedIds.length < 2);
      get('.grouping-help').hidden = get('.group-layers').hidden;
      ungroupHelp.hidden = next.image?.kind !== 'group';
      ungroupHelp.textContent = ungroupReason || '解除するとグループのマスクが外れます。素材の基本配置は維持します。';
      selection.hidden = next.selectedIds.length > 1;
      get<HTMLButtonElement>('.duplicate-image').hidden = get<HTMLButtonElement>('.delete-image').hidden =
        !next.selectedIds.length;
      if (next.selected && !lastCard) show('properties');
      lastCard = next.selected;
    },
    destroy() {
      alive = false;
      closeMenu();
      compact.removeEventListener('change', adapt);
      doc.removeEventListener('keydown', menuKeys, true);
      doc.removeEventListener('pointerdown', outside, true);
    },
  };
}
