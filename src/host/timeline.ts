import { createWorldRecorder } from '../world/recording';
import { createTakeSampler, parseSignalTake, takeDuration, TAKE_LIMITS, type SignalTake } from '../world/takes';
import type { SignalRule } from '../signals/keyframes';
import { signalValue } from '../world/signals';
import { evaluateLayout } from '../world/layout';
import { previewSignalInput } from '../world/signal-preview';
import { scrollProgress } from '../world/keyframes';
import { evaluateWorld, initialWorldState } from '../world/evaluate';
import {
  WORLD_RUNTIME_VERSION,
  type WorldInput,
  type WorldScene,
  type WorldState,
  type WorldFrame,
  type WorldEvent,
} from '../world/types';
import {
  parseTimelineCommand,
  type TimelineCommand,
  type TimelineUpdate,
  type TimelinePort,
  type TakeStorage,
  type TakeSummary,
} from '../timeline/types';

interface Binding {
  refresh(): void;
  reset(): void;
}
/** Browser scheduling and explicit input ownership. The evaluator remains pure. */
export function createTimelineHost(doc: Document, siteId: string, storage: TakeStorage) {
  const view = doc.defaultView!,
    recorder = createWorldRecorder(),
    observers = new Set<string>(),
    listeners = new Set<(update: TimelineUpdate) => void>();
  let binding: Binding | undefined, latest: { scene: WorldScene; input: WorldInput; state: WorldState } | undefined;
  let take: SignalTake | undefined,
    library: TakeSummary[] = [],
    saved = false,
    message = '',
    error = false;
  let mode: 'live' | 'recording' | 'playing' | 'paused' = 'live',
    source: 'live' | 'take' | 'signal' = 'live',
    progress = 0,
    positionMs = 0,
    rate = 1,
    signalPosition = 0;
  let timer: ReturnType<typeof setTimeout> | undefined,
    originClock = 0,
    originPosition = 0,
    lastPublish = -Infinity,
    changed = false,
    operationEpoch = 0;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let lastCaptured = -Infinity,
    pendingInput: WorldInput | undefined,
    pendingEvents: WorldEvent[] = [],
    recordedChars = 0,
    recordingId = '';
  let sampler: ReturnType<typeof createTakeSampler> | undefined, samplerScene: WorldScene | undefined;
  let persistentSignature = '';
  let trackedRule: SignalRule | undefined, previewRule: SignalRule | undefined;
  const driverValue = (scene: WorldScene, input: WorldInput, state: WorldState) =>
    trackedRule
      ? (signalValue(trackedRule, input, evaluateLayout(scene, input), state.motion?.pointer) ?? 0)
      : scrollProgress(input.signals);
  const status = () => ({
    available: Boolean(binding),
    mode,
    source,
    timeMs: positionMs,
    durationMs: mode === 'recording' ? positionMs : take ? takeDuration(take) : 0,
    samples: mode === 'recording' ? recorder.status().frames : (take?.inputs.length ?? 0),
    progress,
    rate,
    saved,
    message,
    error,
  });
  const snapshot = (includeTake = false): TimelineUpdate => ({
    status: status(),
    ...(includeTake ? { take: take ?? null, library } : {}),
  });
  const emit = (includeTake = false, force = true) => {
    const now = view.performance.now();
    if (!force && now - lastPublish < 100) {
      publishTimer ??= setTimeout(
        () => {
          publishTimer = undefined;
          emit(false);
        },
        100 - (now - lastPublish),
      );
      return;
    }
    clearTimeout(publishTimer);
    publishTimer = undefined;
    lastPublish = now;
    const update = snapshot(includeTake);
    listeners.forEach((listener) => listener(update));
  };
  const refresh = () => {
    if (changed) return;
    changed = true;
    queueMicrotask(() => {
      changed = false;
      binding?.refresh();
    });
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(publishTimer);
    publishTimer = undefined;
  };
  function recordInput(scene: WorldScene, input: WorldInput, force = false) {
    if (!recorder.active) return;
    pendingInput = input;
    pendingEvents.push(...input.events);
    if (pendingEvents.length > 64) {
      finishRecording('イベント数の上限に達しました。');
      return;
    }
    if (!force && input.timeMs - lastCaptured < TAKE_LIMITS.intervalMs) return;
    const sample = { ...input, events: pendingEvents },
      size = JSON.stringify(sample).length + 1;
    if (
      recordedChars + size > TAKE_LIMITS.chars - 20000 ||
      input.timeMs - (recorder.status().frames ? recordingStart : input.timeMs) > TAKE_LIMITS.durationMs
    ) {
      finishRecording('録画の容量または3分の上限に達しました。');
      return;
    }
    if (!recorder.status().frames) recordingStart = input.timeMs;
    recorder.capture(scene, sample);
    recordedChars += size;
    lastCaptured = input.timeMs;
    pendingInput = undefined;
    pendingEvents = [];
    positionMs = Math.max(0, input.timeMs - recordingStart);
    if (!recorder.active)
      finishRecording(
        recorder.status().reason === 'scene-changed'
          ? '作品が変更されたため録画を停止しました。'
          : '録画の上限に達しました。',
      );
  }
  let recordingStart = 0;
  function finishRecording(reason = '録画を停止しました。') {
    if (mode !== 'recording') return;
    if (pendingInput && latest && pendingInput.timeMs > lastCaptured && recorder.active) {
      const pending = pendingInput;
      pendingInput = undefined;
      const sample = { ...pending, events: pendingEvents.slice(0, 64) };
      pendingEvents = [];
      if (
        recordedChars + JSON.stringify(sample).length < TAKE_LIMITS.chars - 20000 &&
        pending.timeMs - recordingStart <= TAKE_LIMITS.durationMs
      )
        recorder.capture(latest.scene, sample);
    }
    const recording = recorder.stop();
    cancel();
    if (recording?.inputs.length)
      take = parseSignalTake({
        format: 'ww-signal-take',
        formatVersion: 1,
        runtimeVersion: WORLD_RUNTIME_VERSION,
        id: recordingId,
        name: `Take ${library.length + 1}`,
        siteId,
        initialState: recording.initialState,
        inputs: recording.inputs,
      });
    mode = take ? 'paused' : 'live';
    source = take ? 'take' : 'live';
    positionMs = take ? takeDuration(take) : 0;
    saved = false;
    message = reason;
    sampler = undefined;
    samplerScene = undefined;
    pendingInput = undefined;
    pendingEvents = [];
    emit(true);
    refresh();
  }
  function tick() {
    timer = undefined;
    if (!binding || doc.hidden) return;
    if (mode === 'playing' && take) {
      positionMs = Math.max(
        0,
        Math.min(takeDuration(take), originPosition + (view.performance.now() - originClock) * rate),
      );
      if ((rate > 0 && positionMs >= takeDuration(take)) || (rate < 0 && positionMs <= 0)) {
        mode = 'paused';
        message = '再生の端に到達しました。';
      }
    }
    refresh();
    if (mode === 'recording' || mode === 'playing') timer = setTimeout(tick, TAKE_LIMITS.intervalMs);
  }
  function live(reason = '') {
    const wasOverriding = source !== 'live';
    operationEpoch++;
    if (mode === 'recording') finishRecording();
    cancel();
    mode = 'live';
    source = 'live';
    positionMs = 0;
    message = reason;
    error = false;
    if (wasOverriding) binding?.reset();
    refresh();
    emit();
  }
  const hidden = () => {
    if (!doc.hidden) {
      refresh();
      return;
    }
    if (mode === 'recording') finishRecording('タブが非表示になったため録画を停止しました。');
    if (mode === 'playing') {
      tick();
      mode = 'paused';
      message = 'タブが非表示になったため一時停止しました。';
    }
    cancel();
    emit();
  };
  async function command(owner: string, raw: TimelineCommand) {
    const value = parseTimelineCommand(raw);
    error = false;
    const operation = value.type === 'observe' || value.type === 'track' ? operationEpoch : ++operationEpoch;
    try {
      if (value.type === 'track') {
        trackedRule = value.rule ?? undefined;
        if (latest && source === 'live') progress = driverValue(latest.scene, latest.input, latest.state);
        refresh();
        emit();
        return;
      }
      if (value.type === 'observe') {
        if (value.value) observers.add(owner);
        else observers.delete(owner);
        refresh();
        if (value.value) library = await storage.list();
        emit(true);
        return;
      }
      if (value.type === 'list') {
        library = await storage.list();
        emit(true);
        return;
      }
      if (value.type === 'store') {
        if (!take) throw new Error('保存するテイクがありません。');
        const stored = take;
        await storage.put(stored);
        if (take === stored) saved = true;
        library = await storage.list();
        message = 'テイクを作品とは別に保存しました。';
        emit(true);
        return;
      }
      if (value.type === 'delete') {
        await storage.remove(value.id);
        library = await storage.list();
        if (take?.id === value.id) saved = false;
        message = '保存したテイクを削除しました。';
        emit(true);
        return;
      }
      if (value.type === 'load') {
        const loaded = await storage.get(value.id);
        if (operation !== operationEpoch) return;
        if (loaded.siteId !== siteId) throw new Error('別のサイトのテイクです。');
        live();
        take = parseSignalTake(loaded);
        sampler = undefined;
        samplerScene = undefined;
        source = 'take';
        mode = 'paused';
        saved = true;
        message = 'テイクを読み込みました。';
        refresh();
        emit(true);
        return;
      }
      if (value.type === 'live') {
        live('ライブ入力に戻りました。');
        return;
      }
      if (value.type === 'clear') {
        live();
        take = undefined;
        saved = false;
        message = '現在のテイクを外しました。保存済みテイクは保持しています。';
        emit(true);
        return;
      }
      if (!binding) throw new Error('先に素材を配置してテーマをONにしてください。');
      if (value.type === 'record') {
        live();
        binding.refresh();
        if (!latest) throw new Error('ライブ入力の準備を待ってから録画してください。');
        recordingId = `take-${crypto.randomUUID()}`;
        recorder.start(latest.scene, latest.state);
        lastCaptured = -Infinity;
        recordingStart = 0;
        pendingInput = undefined;
        pendingEvents = [];
        recordedChars = 0;
        persistentSignature = JSON.stringify([latest.state.effects, latest.state.machine.video]);
        mode = 'recording';
        source = 'live';
        saved = false;
        message = '録画中。ページの操作だけを記録しています。';
        refresh();
        tick();
        emit();
      } else if (value.type === 'stop') {
        if (mode === 'recording') finishRecording();
        else {
          cancel();
          positionMs = 0;
          mode = 'paused';
          source = take ? 'take' : 'signal';
          refresh();
          emit();
        }
      } else if (value.type === 'pause') {
        if (mode === 'playing') {
          tick();
          cancel();
          mode = 'paused';
          refresh();
          emit();
        }
      } else if (value.type === 'play') {
        if (!take) throw new Error('先に録画するかテイクを読み込んでください。');
        if (mode === 'recording') finishRecording();
        cancel();
        rate = value.rate;
        if (rate > 0 && positionMs >= takeDuration(take)) positionMs = 0;
        if (rate < 0 && positionMs <= 0) positionMs = takeDuration(take);
        originClock = view.performance.now();
        originPosition = positionMs;
        mode = 'playing';
        source = 'take';
        message = '記録入力でプレビュー中。実ページの操作は再送しません。';
        tick();
        emit();
      } else if (value.type === 'seek') {
        if (!take) throw new Error('テイクがありません。');
        if (mode === 'recording') finishRecording();
        cancel();
        positionMs = Math.max(0, Math.min(takeDuration(take), value.timeMs));
        mode = 'paused';
        source = 'take';
        refresh();
        emit();
      } else if (value.type === 'preview') {
        if (mode === 'recording') finishRecording();
        cancel();
        previewRule = value.rule ?? trackedRule;
        signalPosition = progress = value.progress;
        mode = 'paused';
        source = 'signal';
        message = 'シグナル空間のプレビュー中。ライブに戻すと実ページの入力へ追従します。';
        refresh();
        emit();
      }
    } catch (reason) {
      error = true;
      message = reason instanceof Error ? reason.message : 'タイムライン操作に失敗しました。';
      emit();
    }
  }
  return {
    attach(next: Binding) {
      binding = next;
      doc.addEventListener('visibilitychange', hidden);
      return () => {
        if (binding !== next) return;
        operationEpoch++;
        if (mode === 'recording') finishRecording('描画を終了したため録画を停止しました。');
        cancel();
        binding = undefined;
        latest = undefined;
        mode = 'live';
        source = 'live';
        doc.removeEventListener('visibilitychange', hidden);
        emit();
      };
    },
    capture(
      scene: WorldScene,
      _previous: WorldState,
      input: WorldInput,
      result: { state: WorldState; frame: WorldFrame },
    ) {
      latest = { scene, input, state: result.state };
      progress = driverValue(scene, input, result.state);
      if (mode === 'recording') {
        const signature = JSON.stringify([result.state.effects, result.state.machine.video]),
          boundary = signature !== persistentSignature || Boolean(input.events.length);
        const historyDependent =
          [...scene.decorations, ...(scene.groups ?? [])].some(
            (layer) =>
              layer.motion?.enabled || (layer.kind === 'model3d' && (layer.model.playing || layer.model.look.enabled)),
          ) || scene.signalRules?.some((rule) => rule.enabled && rule.source.signal === 'pointer.speed');
        recordInput(scene, input, boundary || Boolean(historyDependent));
        persistentSignature = signature;
      }
      if (observers.size || mode === 'recording') emit(false, false);
    },
    preview(scene: WorldScene) {
      if (source === 'live') return undefined;
      if (source === 'signal') {
        if (!latest) return undefined;
        const preview = previewSignalInput(
          latest.input,
          previewRule,
          signalPosition,
          evaluateLayout(scene, latest.input),
        );
        const state = initialWorldState();
        if (preview.pointer) state.motion = { bodies: {}, pointer: preview.pointer };
        const result = evaluateWorld(scene, state, preview.input);
        progress = signalPosition;
        return { ...result, input: preview.input };
      }
      if (!take) return undefined;
      if (
        !sampler ||
        samplerScene?.decorations !== scene.decorations ||
        samplerScene?.groups !== scene.groups ||
        samplerScene?.signalRules !== scene.signalRules
      ) {
        sampler = createTakeSampler(scene, take);
        samplerScene = scene;
      }
      const result = sampler.at(positionMs);
      progress = driverValue(scene, result.input, result.state);
      emit(false, false);
      return result;
    },
    get observing() {
      return observers.size > 0;
    },
    get recording() {
      return mode === 'recording';
    },
    get overriding() {
      return source !== 'live';
    },
    get playing() {
      return mode === 'playing';
    },
    command,
    snapshot: () => snapshot(true),
    abortRecording: finishRecording,
    subscribe(listener: (update: TimelineUpdate) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    release(owner: string) {
      observers.delete(owner);
      refresh();
    },
    resumeLive: () => live(),
    port(owner: string): TimelinePort {
      return {
        snapshot: () => snapshot(true),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        dispatch: (value) => command(owner, value),
      };
    },
  };
}
export type TimelineHost = ReturnType<typeof createTimelineHost>;
