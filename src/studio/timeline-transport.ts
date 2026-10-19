import { buttonIcon } from '../editor/icons';
import type { TimelinePort, TimelineCommand, TimelineUpdate } from '../timeline/types';
import { projectGhosts, sampleTakeInput, takeDuration } from '../world/takes';
import { ruleInput, sampleKeyframes, scrollProgress } from '../world/keyframes';
import type { SignalRule } from '../signals/keyframes';

/** Input playback controls. Artwork edits continue to use the Editor Core. */
export function createTimelineTransport(doc: Document, root: HTMLElement, port: TimelinePort, hooks: { redraw(): void; cursor(progress: number): void; zoom(): number; rule(): SignalRule | undefined; selectKey(id: string): void }) {
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const controls = doc.createElement('div'); controls.className = 'take-transport';
  const button = (icon: string, label: string, action: () => void) => { const node = doc.createElement('button'); node.type = 'button'; buttonIcon(node, icon, label); node.addEventListener('click', action); controls.append(node); return node; };
  const record = button('record', 'ページ操作の録画を開始', () => { view.value = 'take'; updateView(); send({ type: 'record' }); }); record.classList.add('take-record');
  const play = button('play', 'テイクを再生 / 一時停止', () => togglePlay()); play.classList.add('take-play');
  const stop = button('stop', '録画・再生を停止', () => send({ type: 'stop' })); stop.classList.add('take-stop');
  const live = button('live', 'ライブ入力に戻る', () => send({ type: 'live' })); live.classList.add('take-live');
  get('.timeline-heading').append(controls);
  const details = doc.createElement('div'); details.className = 'take-details';
  details.innerHTML = `<label><select class="timeline-view" aria-label="タイムラインの表示"><option value="signal">シグナル空間</option><option value="take">テイク（時間）</option></select></label><label><select class="take-rate" aria-label="テイクの再生速度"><option value="-1">逆再生 1×</option><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label><label class="take-time"><input type="number" class="take-position" aria-label="テイクの再生位置（秒）" min="0" max="180" step=".001" value="0">s</label><span class="take-source">LIVE</span>`;
  const libraryRow = doc.createElement('div'); libraryRow.className = 'take-library';
  libraryRow.innerHTML = `<button type="button" class="take-store">テイクを保存</button><select class="take-library-select" aria-label="保存したテイク"><option value="">保存したテイク</option></select><button type="button" class="take-library-refresh"></button><button type="button" class="take-library-delete"></button><span class="take-saved"></span>`;
  const body = get('.timeline-body'); body.prepend(details, libraryRow);
  const view = get<HTMLSelectElement>('.timeline-view'), rate = get<HTMLSelectElement>('.take-rate'), library = get<HTMLSelectElement>('.take-library-select');
  buttonIcon(get<HTMLButtonElement>('.take-library-refresh'), 'refresh', '保存したテイクを更新'); buttonIcon(get<HTMLButtonElement>('.take-library-delete'), 'delete', '選んだ保存テイクを削除');
  const takeScroll = doc.createElement('div'); takeScroll.className = 'timeline-take-scroll'; takeScroll.hidden = true;
  const canvas = doc.createElement('div'); canvas.className = 'take-canvas'; const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-label', '記録時間とスクロール進捗の波形'); canvas.append(svg); takeScroll.append(canvas); get('.timeline-scroll').before(takeScroll);
  let update = port.snapshot(), take = update.take ?? undefined, editable = true, alive = true, expanded = false, message = '', libraryKey = '', graphKey = '';
  let visual: { timeMs: number; progress: number }[] = [], drag = false, seekFrame: number | undefined, requestedTime: number | undefined, sending = false;
  let line: SVGLineElement | undefined;
  const feedback = (text: string) => { const node = get('.timeline-feedback'); node.textContent = text; node.title = text; };
  const send = (command: TimelineCommand) => { void port.dispatch(command); };
  function togglePlay() { send(update.status.mode === 'playing' ? { type: 'pause' } : { type: 'play', rate: Number(rate.value) }); }
  function updateView() {
    const time = view.value === 'take'; takeScroll.hidden = !time; get('.timeline-scroll').hidden = time; get('.timeline-key-properties').hidden = time; get('.timeline-add-key').hidden = time; get('.timeline-delete-key').hidden = time;
    graphKey = ''; draw(); hooks.redraw();
  }
  view.addEventListener('change', updateView);
  get<HTMLInputElement>('.take-position').addEventListener('change', (event) => { const position = (event.target as HTMLInputElement).valueAsNumber; if (take && Number.isFinite(position)) send({ type: 'seek', timeMs: Math.max(0, Math.min(takeDuration(take), position * 1000)) }); });
  rate.addEventListener('change', () => { if (update.status.mode === 'playing') send({ type: 'play', rate: Number(rate.value) }); });
  get('.take-store').addEventListener('click', () => send({ type: 'store' })); get('.take-library-refresh').addEventListener('click', () => send({ type: 'list' }));
  get('.take-library-delete').addEventListener('click', () => { if (library.value) send({ type: 'delete', id: library.value }); });
  library.addEventListener('change', () => { if (library.value) { view.value = 'take'; updateView(); send({ type: 'load', id: library.value }); } });
  function use(next: TimelineUpdate) {
    const previous = update.status.mode; update = { ...update, ...next };
    if (next.take !== undefined) { take = next.take ?? undefined; graphKey = ''; }
    if (next.library) { const signature = JSON.stringify(next.library); if (signature !== libraryKey) { libraryKey = signature; library.replaceChildren(new Option('保存したテイク', ''), ...next.library.map((item) => new Option(`${item.name} · ${(item.durationMs / 1000).toFixed(1)}s`, item.id))); } }
    if (next.status.mode === 'recording') {
      if (previous !== 'recording') { visual = []; graphKey = ''; }
      visual.push({ timeMs: next.status.timeMs, progress: next.status.progress }); if (visual.length > 3600) visual.shift();
    }
    if (message !== next.status.message) { message = next.status.message; if (message) feedback(message); }
    hooks.cursor(next.status.progress); if (previous !== next.status.mode) hooks.redraw(); render();
  }
  const unsubscribe = port.subscribe(use);
  function render() {
    if (!alive) return;
    const ready = editable && update.status.available;
    record.disabled = !ready || update.status.mode === 'recording'; play.disabled = !ready || !take; stop.disabled = !ready || update.status.mode === 'live'; live.disabled = !ready || update.status.source === 'live' && update.status.mode !== 'recording';
    record.setAttribute('aria-pressed', String(update.status.mode === 'recording')); play.setAttribute('aria-pressed', String(update.status.mode === 'playing'));
    root.toggleAttribute('data-recording', update.status.mode === 'recording'); root.toggleAttribute('data-input-preview', update.status.source !== 'live');
    const positionInput = get<HTMLInputElement>('.take-position'); if (root.getRootNode() instanceof ShadowRoot && (root.getRootNode() as ShadowRoot).activeElement !== positionInput) positionInput.value = String(Math.round(update.status.timeMs) / 1000); positionInput.disabled = !take || update.status.mode === 'recording' || !ready;
    get('.take-source').textContent = update.status.mode === 'recording' ? 'REC' : update.status.source === 'live' ? 'LIVE' : 'PREVIEW';
    const store = get<HTMLButtonElement>('.take-store'); store.disabled = !take || !editable || update.status.mode === 'recording' || update.status.saved;
    store.textContent = take && update.status.saved ? 'テイク保存済み' : 'テイクを保存'; store.title = '操作記録だけを保存。作品ルールの保存とは別です。';
    get('.take-saved').textContent = take ? update.status.saved ? 'テイク保存済み' : 'テイク未保存' : '';
    get<HTMLButtonElement>('.take-library-delete').disabled = !library.value || !editable; get<HTMLSelectElement>('.take-library-select').disabled = !editable || update.status.mode === 'recording';
    draw();
  }
  function draw() {
    if (!expanded || view.value !== 'take' || !alive) return;
    const recording = update.status.mode === 'recording', count = recording ? visual.length : take?.inputs.length ?? 0;
    const duration = Math.max(1000, recording ? Math.ceil(update.status.timeMs / 1000) * 1000 : take ? takeDuration(take) : 1000), width = Math.max(280, takeScroll.clientWidth) * hooks.zoom();
    const height = Math.max(140, takeScroll.clientHeight - 14), bottom = height - 36, current = hooks.rule();
    const x = (time: number) => 28 + time / duration * (width - 44), y = (progress: number) => 14 + (1 - progress) * (bottom - 14);
    const signature = `${take?.id}:${count}:${recording ? update.status.timeMs : 0}:${width}:${height}:${JSON.stringify(current)}`;
    if (signature !== graphKey) {
      graphKey = signature; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.replaceChildren();
      const points = recording ? visual : take?.inputs.map((input) => ({ timeMs: input.timeMs - take!.inputs[0]!.timeMs, progress: scrollProgress(input.signals) })) ?? [];
      const node = (name: string, attributes: Record<string, string>, text?: string) => { const n = doc.createElementNS('http://www.w3.org/2000/svg', name); for (const [key, value] of Object.entries(attributes)) n.setAttribute(key, value); if (text) n.textContent = text; svg.append(n); return n; };
      for (const tick of [0, .25, .5, .75, 1]) { node('line', { x1: String(x(duration * tick)), x2: String(x(duration * tick)), y1: '14', y2: String(bottom), class: 'timeline-grid' }); node('text', { x: String(x(duration * tick)), y: String(bottom + 18), 'text-anchor': 'middle' }, `${(duration * tick / 1000).toFixed(1)}s`); }
      for (const value of [0, .5, 1]) node('line', { x1: '28', x2: String(width - 16), y1: String(y(value)), y2: String(y(value)), class: 'timeline-grid' });
      node('path', { d: points.map((point, index) => `${index ? 'L' : 'M'}${x(point.timeMs)} ${y(point.progress)}`).join(' '), class: 'take-wave' });
      node('text', { x: '30', y: String(height - 3), class: 'take-wave-label' }, 'スクロール');
      if (!recording && take && current?.enabled) {
        const sampled = take, opacity = (time: number) => sampleKeyframes(current.keyframes, ruleInput(current, sampleTakeInput(sampled, time).signals));
        node('path', { d: Array.from({ length: 201 }, (_, index) => { const time = takeDuration(sampled) * index / 200; return `${index ? 'L' : 'M'}${x(time)} ${y(opacity(time))}`; }).join(' '), class: 'timeline-curve take-projection' });
        const ghosts = projectGhosts(sampled, current);
        node('text', { x: '104', y: String(height - 3), class: 'take-projection-label' }, `不透明度 · ◇ ${ghosts.length}${ghosts.length > 256 ? '（先頭256個）' : ''}`);
        for (const ghost of ghosts.slice(0, 256)) {
          const key = current.keyframes.find((key) => key.id === ghost.keyId)!, px = x(ghost.timeMs), py = y(key.value);
          const group = node('g', { class: 'take-ghost', 'data-ghost-key': key.id, tabindex: '0', role: 'button', 'aria-label': `${(ghost.timeMs / 1000).toFixed(2)}秒の投影キー。元の進捗 ${(current.source.inputRange[0] + key.input * (current.source.inputRange[1] - current.source.inputRange[0])) * 100}%を編集` });
          const hit = node('rect', { x: String(px - 8), y: String(py - 8), width: '16', height: '16', fill: 'transparent' });
          const diamond = node('path', { d: `M${px} ${py - 5}l5 5 -5 5 -5 -5Z` }); group.append(hit, diamond);
          const title = doc.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = '元のキーをシグナル空間で編集。ゴースト自体は保存されません。'; group.append(title);
        }
      }
      line = node('line', { x1: String(x(update.status.timeMs)), x2: String(x(update.status.timeMs)), y1: '8', y2: String(bottom + 6), class: 'timeline-cursor' }) as SVGLineElement;
    }
    line?.setAttribute('x1', String(x(update.status.timeMs))); line?.setAttribute('x2', String(x(update.status.timeMs)));
  }
  async function flushSeek() {
    seekFrame = undefined; if (requestedTime === undefined || sending) return;
    const timeMs = requestedTime; requestedTime = undefined; sending = true;
    try { await port.dispatch({ type: 'seek', timeMs }); } finally { sending = false; if (requestedTime !== undefined && alive) seekFrame = doc.defaultView!.requestAnimationFrame(() => { void flushSeek(); }); }
  }
  function seek(event: PointerEvent) {
    if (!take || update.status.mode === 'recording') return;
    const rect = canvas.getBoundingClientRect(); requestedTime = Math.max(0, Math.min(takeDuration(take), (event.clientX - rect.left - 28) / (rect.width - 44) * Math.max(1000, takeDuration(take))));
    if (seekFrame === undefined && !sending) seekFrame = doc.defaultView!.requestAnimationFrame(() => { void flushSeek(); });
  }
  canvas.addEventListener('pointerdown', (event) => { if ((event.target as Element).closest('.take-ghost') || event.button !== 0 || !take || update.status.mode === 'recording') return; drag = true; canvas.setPointerCapture(event.pointerId); seek(event); event.preventDefault(); });
  canvas.addEventListener('pointermove', (event) => { if (drag) seek(event); }); canvas.addEventListener('pointerup', (event) => { if (drag) { seek(event); drag = false; } }); canvas.addEventListener('pointercancel', () => { drag = false; });
  const selectGhost = (event: Event) => { const key = (event.target as Element).closest<SVGElement>('[data-ghost-key]')?.dataset.ghostKey; if (!key) return; view.value = 'signal'; hooks.selectKey(key); updateView(); feedback('同じ進捗を通過した位置の投影です。元のキーを編集します。'); event.preventDefault(); event.stopPropagation(); };
  canvas.addEventListener('click', selectGhost); canvas.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') selectGhost(event); });
  const observer = new ResizeObserver(draw); observer.observe(takeScroll); render();
  return { get recording() { return update.status.mode === 'recording'; }, get timeView() { return view.value === 'take'; },
    setEditable(value: boolean) { editable = value; },
    preview(progress: number) { if (update.status.mode !== 'recording') send({ type: 'preview', progress }); }, togglePlay, render,
    expanded(value: boolean) { if (expanded !== value) { expanded = value; send({ type: 'observe', value }); } draw(); },
    destroy() { alive = false; unsubscribe(); send({ type: 'observe', value: false }); if (seekFrame !== undefined) doc.defaultView!.cancelAnimationFrame(seekFrame); observer.disconnect(); controls.remove(); details.remove(); libraryRow.remove(); takeScroll.remove(); } };
}
