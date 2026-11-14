import type { PanelActions, PanelState } from '../editor/panel';
import type { StudioPreferences } from './preferences';
import {
  defaultSignalRule,
  propertyLabel,
  propertyRange,
  type SignalProperty,
  type SignalRule,
  type SignalKeyframe,
} from '../signals/keyframes';
import { sampleKeyframes, clampUnit } from '../world/keyframes';
import { buttonIcon } from '../editor/icons';
import type { TimelinePort } from '../timeline/types';
import { SIGNAL_PRESETS, signalPreset } from '../signals/presets';
import { sameSignalRule } from '../signals/equality';
import { createTimelineTransport } from './timeline-transport';

/** One authoring UI for every Studio surface; commands, never host APIs. */
export function createSignalTimeline(
  doc: Document,
  actions: PanelActions,
  preferences: StudioPreferences,
  onHeight: (inset: number) => void = () => undefined,
  timelinePort?: TimelinePort,
) {
  const root = doc.createElement('section');
  root.className = 'signal-timeline';
  root.setAttribute('aria-label', 'Signal Timeline');
  root.setAttribute('data-around-timeline-control', '');
  root.innerHTML = `<div class="timeline-resize" tabindex="0" role="separator" aria-label="タイムラインの高さ" aria-orientation="horizontal" aria-valuemin="240" aria-valuemax="480"></div>
    <div class="timeline-heading"><button type="button" class="timeline-toggle" aria-expanded="false">▸ Signal Timeline</button><span class="timeline-connection">スクロール ↔ 不透明度</span><span class="timeline-selection"></span></div>
    <div class="timeline-body" hidden><div class="timeline-routing"><label>対象<select class="timeline-property" aria-label="キーの対象プロパティ"><option value="opacity">不透明度</option><option value="position.x">X 位置</option><option value="position.y">Y 位置</option><option value="rotation">回転</option></select></label><label>入力<select class="timeline-driver" aria-label="駆動元シグナル"></select></label></div><div class="timeline-lane"><button type="button" class="timeline-connect">スクロールに接続</button><label class="timeline-enabled"><input type="checkbox" aria-label="スクロールルールを有効化">接続</label><span class="timeline-source">ページ Y / 往復</span><button type="button" class="timeline-remove"></button></div>
    <div class="timeline-range"><label>入力範囲<input type="number" class="timeline-range-start" aria-label="入力範囲の開始" step="any">〜<input type="number" class="timeline-range-end" aria-label="入力範囲の終了" step="any"><span class="timeline-range-unit">%</span></label></div><div class="timeline-tools"><button type="button" class="timeline-add-key"></button><button type="button" class="timeline-delete-key"></button><label>ズーム<input class="timeline-zoom" aria-label="タイムラインのズーム" type="range" min="1" max="8" step=".25" value="1"></label></div>
    <div class="timeline-scroll"><div class="timeline-canvas"><svg class="timeline-graph" aria-label="スクロール進捗と不透明度のカーブ"></svg><div class="timeline-keys"></div></div></div>
    <fieldset class="timeline-key-properties"><label><span class="timeline-input-label">進捗</span><input type="number" class="timeline-key-input" aria-label="キーのスクロール進捗" min="0" max="100" step=".1"><span class="timeline-input-unit">%</span></label><label><span class="timeline-value-label">不透明度</span><input type="number" class="timeline-key-value" aria-label="キーの不透明度" min="0" max="100" step=".1"><span class="timeline-value-unit">%</span></label><label>補間<select class="timeline-easing" aria-label="キーから次への補間"><option value="linear">線形</option><option value="ease-in">イーズイン</option><option value="ease-out">イーズアウト</option><option value="ease-in-out">イーズインアウト</option></select></label></fieldset>
    <p class="timeline-feedback" role="status">レイヤー・対象・入力を選び、接続してください。</p></div>`;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const body = get('.timeline-body'),
    toggle = get<HTMLButtonElement>('.timeline-toggle'),
    connect = get<HTMLButtonElement>('.timeline-connect');
  const scroll = get('.timeline-scroll'),
    canvas = get('.timeline-canvas'),
    graph = root.querySelector<SVGSVGElement>('.timeline-graph')!,
    keys = get('.timeline-keys');
  const input = get<HTMLInputElement>('.timeline-key-input'),
    value = get<HTMLInputElement>('.timeline-key-value'),
    easing = get<HTMLSelectElement>('.timeline-easing');
  const enabled = get<HTMLInputElement>('.timeline-enabled input'),
    add = get<HTMLButtonElement>('.timeline-add-key'),
    removeKey = get<HTMLButtonElement>('.timeline-delete-key'),
    remove = get<HTMLButtonElement>('.timeline-remove');
  buttonIcon(add, 'add', '再生ヘッドの位置にキーを追加');
  buttonIcon(removeKey, 'delete', '選択キーを削除', 'Delete');
  buttonIcon(remove, 'unlink', 'シグナルとの接続を外す');
  let state: PanelState | undefined,
    selectedKey: string | undefined,
    optimistic: SignalRule | undefined,
    layerId: string | undefined;
  let open = false,
    height = timelinePort ? 420 : 300,
    zoom = 1,
    cursor = 0.5,
    alive = true,
    dirtyPreferences = false,
    saveTimer: ReturnType<typeof setTimeout> | undefined;
  let transport: ReturnType<typeof createTimelineTransport> | undefined;
  const propertySelect = get<HTMLSelectElement>('.timeline-property'),
    driverSelect = get<HTMLSelectElement>('.timeline-driver');
  for (const preset of SIGNAL_PRESETS) driverSelect.add(new Option(preset.label, preset.id));
  let property: SignalProperty = 'opacity';
  const source = () => rule()?.source ?? SIGNAL_PRESETS.find((preset) => preset.id === driverSelect.value)!.source;
  const sourceScale = () => (signalPreset(source()).unit === '%' ? 100 : 1);
  const valueScale = () => (property === 'opacity' ? 100 : 1);
  const outputRange = (): [number, number] =>
    property === 'opacity'
      ? [0, 1]
      : [
          Math.min(property === 'rotation' ? -90 : -200, ...(rule()?.keyframes.map((key) => key.value) ?? [])),
          Math.max(property === 'rotation' ? 90 : 200, ...(rule()?.keyframes.map((key) => key.value) ?? [])),
        ];
  const toPlot = (value: number) => {
    const [a, b] = outputRange();
    return (value - a) / (b - a);
  };
  const fromPlot = (value: number) => {
    const [a, b] = outputRange();
    return a + clampUnit(value) * (b - a);
  };
  const roundValue = (value: number) => Math.round(value * 10000) / 10000;
  const minHeight = timelinePort ? 380 : 280;
  let frame: number | undefined, pending: SignalRule | undefined;
  let gesture:
    | { pointer: number; id: string; x: number; y: number; key: SignalKeyframe; rule: SignalRule; moved: boolean }
    | undefined;
  let sizeGesture: { pointer: number; y: number; height: number } | undefined;
  const preferenceKey = 'around.studio.timeline.v1';
  const persist = () => {
    saveTimer = undefined;
    void preferences.write(preferenceKey, { open, height, zoom }).catch(() => undefined);
  };
  const remember = () => {
    dirtyPreferences = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 100);
  };
  const model = () => {
    const rules = state?.signalRules?.filter(
      (rule) => rule.target.layerId === layerId && rule.target.property === property,
    );
    return rules?.find((rule) => rule.enabled) ?? rules?.[0];
  };
  const rule = () => optimistic ?? model();
  const toProgress = (value: number) => {
    const range = rule()?.source.inputRange ?? [0, 1];
    return range[0]! + value * (range[1]! - range[0]!);
  };
  const toInput = (value: number) => {
    const range = rule()?.source.inputRange ?? [0, 1];
    return clampUnit((value - range[0]!) / (range[1]! - range[0]!));
  };
  const locked = () =>
    !state?.image || state.saving || state.inheritedLocked || state.image.locked || Boolean(transport?.recording);
  const feedback = (message: string) => {
    const node = get('.timeline-feedback');
    node.textContent = message;
    node.title = message;
  };
  const clone = (current: SignalRule): SignalRule => JSON.parse(JSON.stringify(current)) as SignalRule;
  const round = (n: number) => Math.round(clampUnit(n) * 10000) / 10000;
  function commit(next: SignalRule) {
    optimistic = clone(next);
    actions.signalRule(next);
    draw();
  }
  function flush() {
    if (frame !== undefined) doc.defaultView!.cancelAnimationFrame(frame);
    frame = undefined;
    if (pending) {
      const next = pending;
      pending = undefined;
      commit(next);
    }
  }
  function schedule(next: SignalRule) {
    pending = next;
    optimistic = clone(next);
    draw();
    if (frame === undefined)
      frame = doc.defaultView!.requestAnimationFrame(() => {
        frame = undefined;
        flush();
      });
  }
  function metrics() {
    const width = Math.max(280, scroll.clientWidth) * zoom;
    return { width, left: 28, top: 14, plotWidth: width - 44, plotHeight: 90 };
  }
  function position(clientX: number, clientY: number) {
    const m = metrics(),
      rect = canvas.getBoundingClientRect();
    return {
      input: round((clientX - rect.left - m.left) / m.plotWidth),
      value: roundValue(fromPlot(1 - (clientY - rect.top - m.top) / m.plotHeight)),
    };
  }
  function updateOpen() {
    const shownHeight = Math.min(height, doc.defaultView!.innerHeight * 0.65);
    body.hidden = !open;
    root.toggleAttribute('data-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = `${open ? '▾' : '▸'} Signal Timeline`;
    root.style.setProperty('--timeline-height', `${shownHeight}px`);
    onHeight(open ? shownHeight + 32 : 28);
    get('.timeline-resize').setAttribute('aria-valuenow', String(height));
    transport?.expanded(open);
    if (open) draw();
  }
  toggle.addEventListener('click', () => {
    open = !open;
    updateOpen();
    remember();
  });
  connect.addEventListener('click', () => {
    if (locked() || !layerId) return;
    const next = defaultSignalRule(layerId, property, { ...source(), inputRange: [...source().inputRange] });
    if (property === 'opacity' && source().signal === 'page.scroll.progress')
      next.id = `scroll-${layerId}`.slice(0, 64);
    selectedKey = next.keyframes[1]!.id;
    cursor = 0.5;
    commit(next);
    feedback(
      property === 'opacity' && source().signal === 'page.scroll.progress'
        ? '0% → 0%、50% → 100%、100% → 0%。実ページをスクロールして確認できます。'
        : '接続しました。キーを動かして入力と値の関係を編集できます。',
    );
  });
  propertySelect.addEventListener('change', () => {
    if (gesture) finish(true);
    property = propertySelect.value as SignalProperty;
    optimistic = undefined;
    selectedKey = undefined;
    const current = model();
    if (current) driverSelect.value = signalPreset(current.source).id;
    draw();
  });
  driverSelect.addEventListener('change', () => {
    const current = rule(),
      preset = SIGNAL_PRESETS.find((preset) => preset.id === driverSelect.value)!;
    if (current && !locked())
      commit({ ...clone(current), source: { ...preset.source, inputRange: [...preset.source.inputRange] } });
    else draw();
  });
  for (const field of root.querySelectorAll<HTMLInputElement>('.timeline-range input'))
    field.addEventListener('change', () => {
      const current = rule();
      if (!current || locked()) return;
      const a = get<HTMLInputElement>('.timeline-range-start').valueAsNumber / sourceScale(),
        b = get<HTMLInputElement>('.timeline-range-end').valueAsNumber / sourceScale();
      if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b || a < -1e6 || b > 1e6) {
        feedback('入力範囲の開始は終了より小さくしてください。');
        return;
      }
      commit({ ...clone(current), source: { ...current.source, inputRange: [a, b] } });
    });
  enabled.addEventListener('change', () => {
    const current = rule();
    if (current && !locked()) commit({ ...clone(current), enabled: enabled.checked });
  });
  remove.addEventListener('click', () => {
    const current = rule();
    if (current && !locked()) {
      optimistic = undefined;
      selectedKey = undefined;
      actions.removeSignalRule(current.id);
    }
  });
  function addKey(at: number, opacity?: number) {
    const current = rule();
    if (!current || locked()) return;
    const x = round(at),
      found = current.keyframes.find((key) => Math.abs(key.input - x) < 0.0001);
    if (found) {
      selectedKey = found.id;
      cursor = found.input;
      draw();
      feedback('この進捗にはキーがあります。値を編集できます。');
      return;
    }
    if (current.keyframes.length >= 64) {
      feedback('キーは64個までです。');
      return;
    }
    const next = clone(current);
    let index = 1;
    while (next.keyframes.some((key) => key.id === `key-${index}`)) index++;
    const key = {
      id: `key-${index}`,
      input: x,
      value: opacity === undefined ? sampleKeyframes(current.keyframes, x) : roundValue(opacity),
      easing: 'linear' as const,
    };
    next.keyframes.push(key);
    next.keyframes.sort((a, b) => a.input - b.input);
    selectedKey = key.id;
    cursor = x;
    commit(next);
    feedback('キーを追加しました。ドラッグで進捗と値を調整できます。');
  }
  add.addEventListener('click', () => addKey(cursor));
  const deleteKey = () => {
    const current = rule();
    if (!current || locked() || !selectedKey || current.keyframes.length < 2) return;
    const next = clone(current);
    next.keyframes = next.keyframes.filter((key) => key.id !== selectedKey);
    selectedKey = undefined;
    commit(next);
    feedback('キーを削除しました。');
  };
  removeKey.addEventListener('click', deleteKey);
  const selectKey = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-key-id]'),
      key = rule()?.keyframes.find((key) => key.id === button?.dataset.keyId);
    if (key) {
      selectedKey = key.id;
      cursor = key.input;
      if (event.type === 'click') transport?.preview(toProgress(cursor));
      draw();
    }
  };
  keys.addEventListener('click', selectKey);
  keys.addEventListener('focusin', selectKey);
  canvas.addEventListener('dblclick', (event) => {
    if (!(event.target as Element).closest('.timeline-key')) {
      const point = position(event.clientX, event.clientY);
      addKey(point.input, point.value);
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const button = (event.target as Element).closest<HTMLElement>('[data-key-id]'),
      current = rule();
    if (!button || !current) {
      cursor = position(event.clientX, event.clientY).input;
      transport?.preview(toProgress(cursor));
      draw();
      return;
    }
    selectedKey = button.dataset.keyId;
    const key = current.keyframes.find((key) => key.id === selectedKey)!;
    cursor = key.input;
    if (!locked()) {
      gesture = {
        pointer: event.pointerId,
        id: key.id,
        x: event.clientX,
        y: event.clientY,
        key: { ...key },
        rule: clone(current),
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
    }
    transport?.preview(toProgress(cursor));
    draw();
    event.preventDefault();
    button.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointer || locked()) return;
    const dx = event.clientX - gesture.x,
      dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    if (!gesture.moved) {
      gesture.moved = true;
      actions.beginEdit();
    }
    const m = metrics(),
      next = clone(gesture.rule),
      key = next.keyframes.find((key) => key.id === gesture!.id)!;
    const x = round(gesture.key.input + dx / m.plotWidth);
    key.input = next.keyframes.some((candidate) => candidate.id !== key.id && Math.abs(candidate.input - x) < 0.0001)
      ? key.input
      : x;
    key.value = roundValue(fromPlot(toPlot(gesture.key.value) - dy / m.plotHeight));
    next.keyframes.sort((a, b) => a.input - b.input);
    cursor = key.input;
    schedule(next);
    transport?.preview(toProgress(cursor));
    event.preventDefault();
  });
  function finish(cancel = false) {
    const current = gesture;
    gesture = undefined;
    flush();
    if (current?.moved) {
      actions.endEdit(cancel);
      if (cancel) optimistic = undefined;
    }
    if (current && canvas.hasPointerCapture(current.pointer)) canvas.releasePointerCapture(current.pointer);
    draw();
  }
  canvas.addEventListener('pointerup', () => finish());
  canvas.addEventListener('pointercancel', () => finish(true));
  canvas.addEventListener('lostpointercapture', () => {
    if (gesture) finish(true);
  });
  function numeric() {
    const current = rule();
    if (!current || !selectedKey || locked()) return;
    const next = clone(current),
      key = next.keyframes.find((key) => key.id === selectedKey);
    if (!key) return;
    const progress = input.valueAsNumber / sourceScale(),
      opacity = value.valueAsNumber / valueScale(),
      [low, high] = current.source.inputRange;
    const [minValue, maxValue] = propertyRange(property);
    if (
      !Number.isFinite(progress) ||
      !Number.isFinite(opacity) ||
      progress < low ||
      progress > high ||
      opacity < minValue ||
      opacity > maxValue
    )
      return;
    const x = toInput(progress);
    if (next.keyframes.some((candidate) => candidate.id !== key.id && Math.abs(candidate.input - x) < 0.0001)) {
      feedback('同じ進捗に2個のキーは置けません。');
      return;
    }
    key.input = round(x);
    key.value = roundValue(opacity);
    key.easing = easing.value as SignalKeyframe['easing'];
    next.keyframes.sort((a, b) => a.input - b.input);
    cursor = key.input;
    commit(next);
  }
  for (const field of [input, value]) {
    field.addEventListener('focus', () => {
      if (!locked()) actions.beginEdit();
    });
    field.addEventListener('input', numeric);
    field.addEventListener('blur', () => {
      actions.endEdit();
      draw();
    });
  }
  easing.addEventListener('change', numeric);
  get<HTMLInputElement>('.timeline-zoom').addEventListener('input', (event) => {
    zoom = Number((event.target as HTMLInputElement).value);
    draw();
    remember();
  });
  const resize = get('.timeline-resize');
  resize.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    sizeGesture = { pointer: event.pointerId, y: event.clientY, height };
    resize.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  resize.addEventListener('pointermove', (event) => {
    if (sizeGesture) {
      height = Math.max(minHeight, Math.min(480, sizeGesture.height + sizeGesture.y - event.clientY));
      updateOpen();
    }
  });
  const finishSize = () => {
    if (sizeGesture) remember();
    sizeGesture = undefined;
  };
  resize.addEventListener('pointerup', finishSize);
  resize.addEventListener('pointercancel', finishSize);
  resize.addEventListener('lostpointercapture', finishSize);
  resize.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
      height = Math.max(minHeight, Math.min(480, height + (event.key === 'ArrowUp' ? 20 : -20)));
      updateOpen();
      remember();
      event.preventDefault();
      event.stopPropagation();
    }
  });
  root.addEventListener('keydown', (event) => {
    if (event.isComposing || (event.target as Element).matches('input,select,textarea,[role=separator]')) return;
    // Buttons retain native Space activation; the timeline's Space shortcut
    // applies to the canvas/keys rather than overriding Record or Collapse.
    if (event.key === ' ' && (event.target as Element).closest('button:not(.timeline-key)')) return;
    if (event.key === ' ' && transport) transport.togglePlay();
    else if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      if (event.shiftKey || event.key.toLowerCase() === 'y') actions.redo();
      else actions.undo();
    } else if (
      transport?.timeView &&
      ['Delete', 'Backspace', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    } else if (event.key === 'Delete' || event.key === 'Backspace') deleteKey();
    else if (event.key === 'Escape') {
      if (gesture) finish(true);
      else {
        selectedKey = undefined;
        draw();
      }
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selectedKey) {
      const current = rule(),
        key = current?.keyframes.find((key) => key.id === selectedKey);
      if (!key || locked()) return;
      input.value = String(
        toProgress(
          key.input +
            (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * (event.shiftKey ? 0.1 : 0.01),
        ) * sourceScale(),
      );
      value.value = String(
        (key.value +
          (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0) *
            (event.shiftKey ? 0.1 : 0.01) *
            (outputRange()[1] - outputRange()[0])) *
          valueScale(),
      );
      numeric();
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  function draw() {
    if (!alive) return;
    const current = rule(),
      key = current?.keyframes.find((key) => key.id === selectedKey),
      disabled = locked();
    propertySelect.disabled = driverSelect.disabled = disabled;
    propertySelect.value = property;
    if (current) driverSelect.value = signalPreset(current.source).id;
    const preset = signalPreset(source()),
      unit = property === 'opacity' ? '%' : property === 'rotation' ? '°' : 'px';
    connect.textContent = preset.id === 'scroll' ? 'スクロールに接続' : 'シグナルに接続';
    get('.timeline-connection').textContent = `${preset.label} ↔ ${propertyLabel(property)}`;
    get('.timeline-source').textContent =
      `${preset.source.space === 'page' ? 'ページ Y' : preset.source.space === 'layer' ? '基本位置' : preset.source.space === 'anchor' ? '配置アンカー' : '画面'} / 往復`;
    get('.timeline-value-label').textContent = propertyLabel(property);
    get('.timeline-value-unit').textContent = unit;
    get('.timeline-input-unit').textContent = preset.unit;
    get('.timeline-input-label').textContent = preset.id === 'scroll' ? '進捗' : '入力';
    enabled.setAttribute('aria-label', preset.id === 'scroll' ? 'スクロールルールを有効化' : 'シグナルルールを有効化');
    get('.timeline-source').title =
      preset.source.signal === 'pointer.distance'
        ? '距離の100%は配置基準の対角線です。レイヤー参照は保存した基本位置を使います。'
        : preset.source.signal === 'pointer.angle'
          ? 'マウスから基準中心への角度。右0°、下90°です。'
          : preset.source.signal === 'pointer.speed'
            ? '採取時刻から求めたマウス速度（CSS px/s）です。'
            : '配置基準内の比率を入力範囲へ割り当てます。';
    graph.setAttribute('aria-label', `${preset.label}と${propertyLabel(property)}のカーブ`);
    input.setAttribute('aria-label', preset.id === 'scroll' ? 'キーのスクロール進捗' : 'キーの入力値');
    value.setAttribute('aria-label', `キーの${propertyLabel(property)}`);
    for (const [selector, index] of [
      ['.timeline-range-start', 0],
      ['.timeline-range-end', 1],
    ] as const) {
      const field = get<HTMLInputElement>(selector);
      field.disabled = disabled || !current;
      if ((root.getRootNode() as ShadowRoot).activeElement !== field && doc.activeElement !== field)
        field.value = String(source().inputRange[index] * sourceScale());
    }
    get('.timeline-range-unit').textContent = preset.unit;
    const [low, high] = propertyRange(property);
    value.min = String(low * valueScale());
    value.max = String(high * valueScale());
    transport?.track(current);
    connect.hidden = Boolean(current);
    connect.disabled = disabled;
    enabled.closest<HTMLElement>('label')!.hidden = !current;
    enabled.checked = current?.enabled ?? false;
    enabled.disabled = disabled;
    remove.hidden = !current;
    remove.disabled = disabled;
    add.disabled = !current || disabled || current.keyframes.length >= 64;
    removeKey.disabled = !key || disabled || (current?.keyframes.length ?? 0) < 2;
    get<HTMLFieldSetElement>('.timeline-key-properties').disabled = !key || disabled;
    get('.timeline-selection').textContent = state?.image?.name ?? 'レイヤーを選択';
    get('.timeline-selection').title = state?.image?.name ?? '';
    if (doc.activeElement !== input && doc.activeElement?.shadowRoot?.activeElement !== input)
      input.value = key ? String(roundValue(toProgress(key.input) * sourceScale())) : '';
    input.min = String(source().inputRange[0] * sourceScale());
    input.max = String(source().inputRange[1] * sourceScale());
    if (doc.activeElement !== value && doc.activeElement?.shadowRoot?.activeElement !== value)
      value.value = key ? String(roundValue(key.value * valueScale())) : '';
    easing.value = key?.easing ?? 'linear';
    transport?.setEditable(Boolean(state && !state.saving));
    transport?.render();
    if (!open) return;
    const m = metrics();
    canvas.style.width = `${m.width}px`;
    graph.setAttribute('viewBox', `0 0 ${m.width} 140`);
    const x = (p: number) => m.left + p * m.plotWidth,
      y = (v: number) => m.top + (1 - toPlot(v)) * m.plotHeight;
    graph.replaceChildren();
    const svg = (tag: string, attributes: Record<string, string>, text?: string) => {
      const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
      if (text) node.textContent = text;
      graph.append(node);
    };
    for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
      svg('line', { x1: String(x(tick)), x2: String(x(tick)), y1: '14', y2: '104', class: 'timeline-grid' });
      svg(
        'text',
        { x: String(x(tick)), y: '126', 'text-anchor': 'middle' },
        `${roundValue(toProgress(tick) * sourceScale())}${preset.unit}`,
      );
    }
    for (const tick of [0, 0.5, 1])
      svg('line', {
        x1: String(m.left),
        x2: String(x(1)),
        y1: String(y(fromPlot(tick))),
        y2: String(y(fromPlot(tick))),
        class: 'timeline-grid',
      });
    if (current)
      svg('path', {
        d: Array.from(
          { length: 201 },
          (_, index) => `${index ? 'L' : 'M'}${x(index / 200)} ${y(sampleKeyframes(current.keyframes, index / 200))}`,
        ).join(' '),
        class: 'timeline-curve',
      });
    svg('line', { x1: String(x(cursor)), x2: String(x(cursor)), y1: '8', y2: '110', class: 'timeline-cursor' });
    const wanted = new Set(current?.keyframes.map((key) => key.id));
    keys.querySelectorAll<HTMLElement>('[data-key-id]').forEach((button) => {
      if (!wanted.has(button.dataset.keyId!)) button.remove();
    });
    for (const key of current?.keyframes ?? []) {
      let button = [...keys.querySelectorAll<HTMLButtonElement>('[data-key-id]')].find(
        (button) => button.dataset.keyId === key.id,
      );
      if (!button) {
        button = doc.createElement('button');
        button.type = 'button';
        button.className = 'timeline-key';
        button.dataset.keyId = key.id;
        keys.append(button);
      }
      button.style.left = `${x(key.input)}px`;
      button.style.top = `${y(key.value)}px`;
      button.toggleAttribute('data-selected', key.id === selectedKey);
      button.disabled = disabled;
      button.title = `進捗 ${roundValue(toProgress(key.input) * sourceScale())}${preset.unit} → ${propertyLabel(property)} ${roundValue(key.value * valueScale())}${unit}`;
      button.setAttribute('aria-label', button.title);
    }
  }
  if (timelinePort)
    transport = createTimelineTransport(doc, root, timelinePort, {
      redraw: draw,
      rule,
      outputRatio: toPlot,
      scene: () => ({ decorations: state?.images ?? [], groups: state?.groups ?? [] }),
      selectKey(id) {
        const key = rule()?.keyframes.find((key) => key.id === id);
        if (key) {
          selectedKey = id;
          cursor = key.input;
          transport?.preview(toProgress(cursor));
        }
      },
      cursor(progress) {
        cursor = toInput(progress);
        if (open && !transport?.timeView) {
          const m = metrics(),
            x = m.left + cursor * m.plotWidth;
          graph.querySelector('.timeline-cursor')?.setAttribute('x1', String(x));
          graph.querySelector('.timeline-cursor')?.setAttribute('x2', String(x));
        }
      },
      zoom: () => zoom,
    });
  get('.timeline-resize').setAttribute('aria-valuemin', String(minHeight));
  const observer = new ResizeObserver(() => {
    if (open) draw();
  });
  observer.observe(scroll);
  doc.defaultView!.addEventListener('resize', updateOpen);
  void preferences.read(preferenceKey).then(
    (raw) => {
      if (!alive || dirtyPreferences || !raw || typeof raw !== 'object') return;
      const saved = raw as Record<string, unknown>;
      if (typeof saved.open === 'boolean') open = saved.open;
      if (typeof saved.height === 'number' && Number.isFinite(saved.height))
        height = Math.max(minHeight, Math.min(480, saved.height));
      if (typeof saved.zoom === 'number' && Number.isFinite(saved.zoom)) zoom = Math.max(1, Math.min(8, saved.zoom));
      get<HTMLInputElement>('.timeline-zoom').value = String(zoom);
      updateOpen();
    },
    () => undefined,
  );
  updateOpen();
  return {
    root,
    render(next: PanelState) {
      if (layerId !== next.image?.id) {
        if (gesture) finish(true);
        optimistic = undefined;
        selectedKey = undefined;
      }
      state = next;
      layerId = next.image?.id;
      if (optimistic && sameSignalRule(optimistic, model())) optimistic = undefined;
      if (model()) driverSelect.value = signalPreset(model()!.source).id;
      draw();
    },
    toggle() {
      open = !open;
      updateOpen();
      remember();
    },
    destroy() {
      finish(true);
      alive = false;
      transport?.destroy();
      flush();
      clearTimeout(saveTimer);
      if (dirtyPreferences) persist();
      observer.disconnect();
      doc.defaultView!.removeEventListener('resize', updateOpen);
      root.remove();
    },
  };
}
