import type { PanelActions, PanelState } from '../editor/panel';
import type { StudioPreferences } from './preferences';
import { defaultScrollOpacityRule, type SignalRule, type SignalKeyframe } from '../signals/keyframes';
import { sampleKeyframes, clampUnit } from '../world/keyframes';
import { buttonIcon } from '../editor/icons';
import type { TimelinePort } from '../timeline/types';
import { createTimelineTransport } from './timeline-transport';

/** One authoring UI for every Studio surface; commands, never host APIs. */
export function createSignalTimeline(doc: Document, actions: PanelActions, preferences: StudioPreferences, onHeight: (inset: number) => void = () => undefined, timelinePort?: TimelinePort) {
  const root = doc.createElement('section'); root.className = 'signal-timeline'; root.setAttribute('aria-label', 'Signal Timeline'); root.setAttribute('data-ww-timeline-control', '');
  root.innerHTML = `<div class="timeline-resize" tabindex="0" role="separator" aria-label="タイムラインの高さ" aria-orientation="horizontal" aria-valuemin="240" aria-valuemax="480"></div>
    <div class="timeline-heading"><button type="button" class="timeline-toggle" aria-expanded="false">▸ Signal Timeline</button><span class="timeline-connection">スクロール ↔ 不透明度</span><span class="timeline-selection"></span></div>
    <div class="timeline-body" hidden><div class="timeline-lane"><button type="button" class="timeline-connect">スクロールに接続</button><label class="timeline-enabled"><input type="checkbox" aria-label="スクロールルールを有効化">接続</label><span class="timeline-source">ページ Y / 往復</span><button type="button" class="timeline-remove"></button></div>
    <div class="timeline-tools"><button type="button" class="timeline-add-key"></button><button type="button" class="timeline-delete-key"></button><label>ズーム<input class="timeline-zoom" aria-label="タイムラインのズーム" type="range" min="1" max="8" step=".25" value="1"></label></div>
    <div class="timeline-scroll"><div class="timeline-canvas"><svg class="timeline-graph" aria-label="スクロール進捗と不透明度のカーブ"></svg><div class="timeline-keys"></div></div></div>
    <fieldset class="timeline-key-properties"><label>進捗<input type="number" class="timeline-key-input" aria-label="キーのスクロール進捗" min="0" max="100" step=".1">%</label><label>不透明度<input type="number" class="timeline-key-value" aria-label="キーの不透明度" min="0" max="100" step=".1">%</label><label>補間<select class="timeline-easing" aria-label="キーから次への補間"><option value="linear">線形</option><option value="ease-in">イーズイン</option><option value="ease-out">イーズアウト</option><option value="ease-in-out">イーズインアウト</option></select></label></fieldset>
    <p class="timeline-feedback" role="status">レイヤーを選び、スクロールに接続してください。</p></div>`;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const body = get('.timeline-body'), toggle = get<HTMLButtonElement>('.timeline-toggle'), connect = get<HTMLButtonElement>('.timeline-connect');
  const scroll = get('.timeline-scroll'), canvas = get('.timeline-canvas'), graph = root.querySelector<SVGSVGElement>('.timeline-graph')!, keys = get('.timeline-keys');
  const input = get<HTMLInputElement>('.timeline-key-input'), value = get<HTMLInputElement>('.timeline-key-value'), easing = get<HTMLSelectElement>('.timeline-easing');
  const enabled = get<HTMLInputElement>('.timeline-enabled input'), add = get<HTMLButtonElement>('.timeline-add-key'), removeKey = get<HTMLButtonElement>('.timeline-delete-key'), remove = get<HTMLButtonElement>('.timeline-remove');
  buttonIcon(add, 'add', '再生ヘッドの位置にキーを追加'); buttonIcon(removeKey, 'delete', '選択キーを削除', 'Delete'); buttonIcon(remove, 'unlink', 'スクロールとの接続を外す');
  let state: PanelState | undefined, selectedKey: string | undefined, optimistic: SignalRule | undefined, layerId: string | undefined;
  let open = false, height = timelinePort ? 340 : 260, zoom = 1, cursor = .5, alive = true, dirtyPreferences = false, saveTimer: ReturnType<typeof setTimeout> | undefined;
  let transport: ReturnType<typeof createTimelineTransport> | undefined;
  const minHeight = timelinePort ? 300 : 240;
  let frame: number | undefined, pending: SignalRule | undefined;
  let gesture: { pointer: number; id: string; x: number; y: number; key: SignalKeyframe; rule: SignalRule; moved: boolean } | undefined;
  let sizeGesture: { pointer: number; y: number; height: number } | undefined;
  const preferenceKey = 'webWorldThemes.studio.timeline.v1';
  const persist = () => { saveTimer = undefined; void preferences.write(preferenceKey, { open, height, zoom }).catch(() => undefined); };
  const remember = () => { dirtyPreferences = true; clearTimeout(saveTimer); saveTimer = setTimeout(persist, 100); };
  const model = () => state?.signalRules?.find((rule) => rule.target.layerId === layerId);
  const rule = () => optimistic ?? model();
  const toProgress = (value: number) => { const range = rule()?.source.inputRange ?? [0, 1]; return range[0]! + value * (range[1]! - range[0]!); };
  const toInput = (value: number) => { const range = rule()?.source.inputRange ?? [0, 1]; return clampUnit((value - range[0]!) / (range[1]! - range[0]!)); };
  const locked = () => !state?.image || state.saving || state.inheritedLocked || state.image.locked || Boolean(transport?.recording);
  const feedback = (message: string) => { const node = get('.timeline-feedback'); node.textContent = message; node.title = message; };
  const clone = (current: SignalRule): SignalRule => JSON.parse(JSON.stringify(current)) as SignalRule;
  const round = (n: number) => Math.round(clampUnit(n) * 10000) / 10000;
  function commit(next: SignalRule) { optimistic = clone(next); actions.signalRule(next); draw(); }
  function flush() { if (frame !== undefined) doc.defaultView!.cancelAnimationFrame(frame); frame = undefined; if (pending) { const next = pending; pending = undefined; commit(next); } }
  function schedule(next: SignalRule) { pending = next; optimistic = clone(next); draw(); if (frame === undefined) frame = doc.defaultView!.requestAnimationFrame(() => { frame = undefined; flush(); }); }
  function metrics() { const width = Math.max(280, scroll.clientWidth) * zoom; return { width, left: 28, top: 14, plotWidth: width - 44, plotHeight: 90 }; }
  function position(clientX: number, clientY: number) { const m = metrics(), rect = canvas.getBoundingClientRect(); return { input: round((clientX - rect.left - m.left) / m.plotWidth), value: round(1 - (clientY - rect.top - m.top) / m.plotHeight) }; }
  function updateOpen() { const shownHeight = Math.min(height, doc.defaultView!.innerHeight * .65); body.hidden = !open; root.toggleAttribute('data-open', open); toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = `${open ? '▾' : '▸'} Signal Timeline`; root.style.setProperty('--timeline-height', `${shownHeight}px`); onHeight(open ? shownHeight + 32 : 28); get('.timeline-resize').setAttribute('aria-valuenow', String(height)); transport?.expanded(open); if (open) draw(); }
  toggle.addEventListener('click', () => { open = !open; updateOpen(); remember(); });
  connect.addEventListener('click', () => { if (locked() || !layerId) return; const next = defaultScrollOpacityRule(layerId); selectedKey = next.keyframes[1]!.id; cursor = .5; commit(next); feedback('0% → 0%、50% → 100%、100% → 0%。実ページをスクロールして確認できます。'); });
  enabled.addEventListener('change', () => { const current = rule(); if (current && !locked()) commit({ ...clone(current), enabled: enabled.checked }); });
  remove.addEventListener('click', () => { const current = rule(); if (current && !locked()) { optimistic = undefined; selectedKey = undefined; actions.removeSignalRule(current.id); } });
  function addKey(at: number, opacity?: number) {
    const current = rule(); if (!current || locked()) return;
    const x = round(at), found = current.keyframes.find((key) => Math.abs(key.input - x) < .0001);
    if (found) { selectedKey = found.id; cursor = found.input; draw(); feedback('この進捗にはキーがあります。値を編集できます。'); return; }
    if (current.keyframes.length >= 64) { feedback('キーは64個までです。'); return; }
    const next = clone(current); let index = 1; while (next.keyframes.some((key) => key.id === `key-${index}`)) index++;
    const key = { id: `key-${index}`, input: x, value: opacity === undefined ? sampleKeyframes(current.keyframes, x) : round(opacity), easing: 'linear' as const };
    next.keyframes.push(key); next.keyframes.sort((a, b) => a.input - b.input); selectedKey = key.id; cursor = x; commit(next); feedback('キーを追加しました。ドラッグで進捗と値を調整できます。');
  }
  add.addEventListener('click', () => addKey(cursor));
  const deleteKey = () => { const current = rule(); if (!current || locked() || !selectedKey || current.keyframes.length < 2) return; const next = clone(current); next.keyframes = next.keyframes.filter((key) => key.id !== selectedKey); selectedKey = undefined; commit(next); feedback('キーを削除しました。'); };
  removeKey.addEventListener('click', deleteKey);
  const selectKey = (event: Event) => { const button = (event.target as Element).closest<HTMLElement>('[data-key-id]'), key = rule()?.keyframes.find((key) => key.id === button?.dataset.keyId); if (key) { selectedKey = key.id; cursor = key.input; if (event.type === 'click') transport?.preview(toProgress(cursor)); draw(); } };
  keys.addEventListener('click', selectKey); keys.addEventListener('focusin', selectKey);
  canvas.addEventListener('dblclick', (event) => { if (!(event.target as Element).closest('.timeline-key')) { const point = position(event.clientX, event.clientY); addKey(point.input, point.value); } });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const button = (event.target as Element).closest<HTMLElement>('[data-key-id]'), current = rule();
    if (!button || !current) { cursor = position(event.clientX, event.clientY).input; transport?.preview(toProgress(cursor)); draw(); return; }
    selectedKey = button.dataset.keyId; const key = current.keyframes.find((key) => key.id === selectedKey)!; cursor = key.input;
    if (!locked()) { gesture = { pointer: event.pointerId, id: key.id, x: event.clientX, y: event.clientY, key: { ...key }, rule: clone(current), moved: false }; canvas.setPointerCapture(event.pointerId); }
    transport?.preview(toProgress(cursor)); draw(); event.preventDefault(); button.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointer || locked()) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    if (!gesture.moved) { gesture.moved = true; actions.beginEdit(); }
    const m = metrics(), next = clone(gesture.rule), key = next.keyframes.find((key) => key.id === gesture!.id)!;
    const x = round(gesture.key.input + dx / m.plotWidth);
    key.input = next.keyframes.some((candidate) => candidate.id !== key.id && Math.abs(candidate.input - x) < .0001) ? key.input : x; key.value = round(gesture.key.value - dy / m.plotHeight);
    next.keyframes.sort((a, b) => a.input - b.input); cursor = key.input; schedule(next); transport?.preview(toProgress(cursor)); event.preventDefault();
  });
  function finish(cancel = false) { const current = gesture; gesture = undefined; flush(); if (current?.moved) { actions.endEdit(cancel); if (cancel) optimistic = undefined; } if (current && canvas.hasPointerCapture(current.pointer)) canvas.releasePointerCapture(current.pointer); draw(); }
  canvas.addEventListener('pointerup', () => finish()); canvas.addEventListener('pointercancel', () => finish(true)); canvas.addEventListener('lostpointercapture', () => { if (gesture) finish(true); });
  function numeric() {
    const current = rule(); if (!current || !selectedKey || locked()) return;
    const next = clone(current), key = next.keyframes.find((key) => key.id === selectedKey); if (!key) return;
    const progress = input.valueAsNumber / 100, opacity = value.valueAsNumber / 100, [low, high] = current.source.inputRange;
    if (!Number.isFinite(progress) || !Number.isFinite(opacity) || progress < low || progress > high || opacity < 0 || opacity > 1) return;
    const x = toInput(progress);
    if (next.keyframes.some((candidate) => candidate.id !== key.id && Math.abs(candidate.input - x) < .0001)) { feedback('同じ進捗に2個のキーは置けません。'); return; }
    key.input = round(x); key.value = round(opacity); key.easing = easing.value as SignalKeyframe['easing']; next.keyframes.sort((a, b) => a.input - b.input); cursor = key.input; commit(next);
  }
  for (const field of [input, value]) { field.addEventListener('focus', () => { if (!locked()) actions.beginEdit(); }); field.addEventListener('input', numeric); field.addEventListener('blur', () => { actions.endEdit(); draw(); }); }
  easing.addEventListener('change', numeric);
  get<HTMLInputElement>('.timeline-zoom').addEventListener('input', (event) => { zoom = Number((event.target as HTMLInputElement).value); draw(); remember(); });
  const resize = get('.timeline-resize');
  resize.addEventListener('pointerdown', (event) => { if (event.button !== 0) return; sizeGesture = { pointer: event.pointerId, y: event.clientY, height }; resize.setPointerCapture(event.pointerId); event.preventDefault(); });
  resize.addEventListener('pointermove', (event) => { if (sizeGesture) { height = Math.max(minHeight, Math.min(480, sizeGesture.height + sizeGesture.y - event.clientY)); updateOpen(); } });
  const finishSize = () => { if (sizeGesture) remember(); sizeGesture = undefined; }; resize.addEventListener('pointerup', finishSize); resize.addEventListener('pointercancel', finishSize); resize.addEventListener('lostpointercapture', finishSize);
  resize.addEventListener('keydown', (event) => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { height = Math.max(minHeight, Math.min(480, height + (event.key === 'ArrowUp' ? 20 : -20))); updateOpen(); remember(); event.preventDefault(); event.stopPropagation(); } });
  root.addEventListener('keydown', (event) => {
    if (event.isComposing || (event.target as Element).matches('input,select,textarea,[role=separator]')) return;
    // Buttons retain native Space activation; the timeline's Space shortcut
    // applies to the canvas/keys rather than overriding Record or Collapse.
    if (event.key === ' ' && (event.target as Element).closest('button:not(.timeline-key)')) return;
    if (event.key === ' ' && transport) transport.togglePlay();
    else if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { if (event.shiftKey || event.key.toLowerCase() === 'y') actions.redo(); else actions.undo(); }
    else if (transport?.timeView && ['Delete', 'Backspace', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    else if (event.key === 'Delete' || event.key === 'Backspace') deleteKey();
    else if (event.key === 'Escape') { if (gesture) finish(true); else { selectedKey = undefined; draw(); } }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selectedKey) {
      const current = rule(), key = current?.keyframes.find((key) => key.id === selectedKey); if (!key || locked()) return;
      input.value = String(toProgress(key.input + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * (event.shiftKey ? .1 : .01)) * 100);
      value.value = String((key.value + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0) * (event.shiftKey ? .1 : .01)) * 100); numeric();
    } else return;
    event.preventDefault(); event.stopImmediatePropagation();
  });
  function draw() {
    if (!alive) return;
    const current = rule(), key = current?.keyframes.find((key) => key.id === selectedKey), disabled = locked();
    connect.hidden = Boolean(current); connect.disabled = disabled; enabled.closest<HTMLElement>('label')!.hidden = !current; enabled.checked = current?.enabled ?? false; enabled.disabled = disabled;
    remove.hidden = !current; remove.disabled = disabled; add.disabled = !current || disabled || current.keyframes.length >= 64; removeKey.disabled = !key || disabled || (current?.keyframes.length ?? 0) < 2;
    get<HTMLFieldSetElement>('.timeline-key-properties').disabled = !key || disabled;
    get('.timeline-selection').textContent = state?.image?.name ?? 'レイヤーを選択'; get('.timeline-selection').title = state?.image?.name ?? '';
    if (doc.activeElement !== input && doc.activeElement?.shadowRoot?.activeElement !== input) input.value = key ? String(Math.round(toProgress(key.input) * 10000) / 100) : '';
    input.min = String((current?.source.inputRange[0] ?? 0) * 100); input.max = String((current?.source.inputRange[1] ?? 1) * 100);
    if (doc.activeElement !== value && doc.activeElement?.shadowRoot?.activeElement !== value) value.value = key ? String(Math.round(key.value * 10000) / 100) : '';
    easing.value = key?.easing ?? 'linear';
    transport?.setEditable(Boolean(state && !state.saving)); transport?.render();
    if (!open) return;
    const m = metrics(); canvas.style.width = `${m.width}px`; graph.setAttribute('viewBox', `0 0 ${m.width} 140`);
    const x = (p: number) => m.left + p * m.plotWidth, y = (v: number) => m.top + (1 - v) * m.plotHeight;
    graph.replaceChildren();
    const svg = (tag: string, attributes: Record<string, string>, text?: string) => { const node = doc.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value)); if (text) node.textContent = text; graph.append(node); };
    for (const tick of [0, .25, .5, .75, 1]) { svg('line', { x1: String(x(tick)), x2: String(x(tick)), y1: '14', y2: '104', class: 'timeline-grid' }); svg('text', { x: String(x(tick)), y: '126', 'text-anchor': 'middle' }, `${Math.round(toProgress(tick) * 10000) / 100}%`); }
    for (const tick of [0, .5, 1]) svg('line', { x1: String(m.left), x2: String(x(1)), y1: String(y(tick)), y2: String(y(tick)), class: 'timeline-grid' });
    if (current) svg('path', { d: Array.from({ length: 201 }, (_, index) => `${index ? 'L' : 'M'}${x(index / 200)} ${y(sampleKeyframes(current.keyframes, index / 200))}`).join(' '), class: 'timeline-curve' });
    svg('line', { x1: String(x(cursor)), x2: String(x(cursor)), y1: '8', y2: '110', class: 'timeline-cursor' });
    const wanted = new Set(current?.keyframes.map((key) => key.id));
    keys.querySelectorAll<HTMLElement>('[data-key-id]').forEach((button) => { if (!wanted.has(button.dataset.keyId!)) button.remove(); });
    for (const key of current?.keyframes ?? []) {
      let button = [...keys.querySelectorAll<HTMLButtonElement>('[data-key-id]')].find((button) => button.dataset.keyId === key.id);
      if (!button) { button = doc.createElement('button'); button.type = 'button'; button.className = 'timeline-key'; button.dataset.keyId = key.id; keys.append(button); }
      button.style.left = `${x(key.input)}px`; button.style.top = `${y(key.value)}px`; button.toggleAttribute('data-selected', key.id === selectedKey); button.disabled = disabled;
      button.title = `進捗 ${Math.round(toProgress(key.input) * 10000) / 100}% → 不透明度 ${Math.round(key.value * 10000) / 100}%`; button.setAttribute('aria-label', button.title);
    }
  }
  if (timelinePort) transport = createTimelineTransport(doc, root, timelinePort, { redraw: draw, rule, selectKey(id) { const key = rule()?.keyframes.find((key) => key.id === id); if (key) { selectedKey = id; cursor = key.input; transport?.preview(toProgress(cursor)); } }, cursor(progress) { cursor = toInput(progress); if (open && !transport?.timeView) { const m = metrics(), x = m.left + cursor * m.plotWidth; graph.querySelector('.timeline-cursor')?.setAttribute('x1', String(x)); graph.querySelector('.timeline-cursor')?.setAttribute('x2', String(x)); } }, zoom: () => zoom });
  get('.timeline-resize').setAttribute('aria-valuemin', String(minHeight));
  const observer = new ResizeObserver(() => { if (open) draw(); }); observer.observe(scroll);
  doc.defaultView!.addEventListener('resize', updateOpen);
  void preferences.read(preferenceKey).then((raw) => { if (!alive || dirtyPreferences || !raw || typeof raw !== 'object') return; const saved = raw as Record<string, unknown>; if (typeof saved.open === 'boolean') open = saved.open; if (typeof saved.height === 'number' && Number.isFinite(saved.height)) height = Math.max(minHeight, Math.min(480, saved.height)); if (typeof saved.zoom === 'number' && Number.isFinite(saved.zoom)) zoom = Math.max(1, Math.min(8, saved.zoom)); get<HTMLInputElement>('.timeline-zoom').value = String(zoom); updateOpen(); }, () => undefined);
  updateOpen();
  return { root, render(next: PanelState) { if (layerId !== next.image?.id) { if (gesture) finish(true); optimistic = undefined; selectedKey = undefined; } state = next; layerId = next.image?.id; if (optimistic && JSON.stringify(optimistic) === JSON.stringify(model())) optimistic = undefined; draw(); },
    toggle() { open = !open; updateOpen(); remember(); }, destroy() { finish(true); alive = false; transport?.destroy(); flush(); clearTimeout(saveTimer); if (dirtyPreferences) persist(); observer.disconnect(); doc.defaultView!.removeEventListener('resize', updateOpen); root.remove(); } };
}
