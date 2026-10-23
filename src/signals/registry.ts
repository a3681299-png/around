import type { SignalSnapshot } from './types';
import type { PointerMemory } from '../world/signals';
import type { WorldEvent, WorldGeometry, WorldLayout } from '../world/types';
import type { Point } from '../world/geometry';
import { legacySignalOrigin, resolvePoint, type SpatialPoint } from '../world/points';
import { layoutEntry } from '../world/layout-index';

export type SignalSpace = 'page' | 'viewport' | 'anchor' | 'layer';
export type SignalAxis = 'x' | 'y';
export type SignalSubscription = 'pointer' | 'scroll' | 'video';
export type HostSignalValue = number | boolean | Point;
export interface NumericSource {
  signal: string;
  space: SignalSpace;
  axis: SignalAxis;
  inputRange: [number, number];
}
export interface SignalEvaluationContext {
  signals: SignalSnapshot;
  geometry?: WorldGeometry;
  layout?: WorldLayout;
  layerId?: string;
  source?: NumericSource;
  pointer?: PointerMemory;
  timeMs?: number;
  events?: readonly WorldEvent[];
  origin?: SpatialPoint;
}
interface PresetDefinition {
  id: string;
  label: string;
  unit: string;
  order: number;
  space: SignalSpace;
  axis: SignalAxis;
  inputRange: [number, number];
}
interface SignalMetadata {
  spaces: readonly SignalSpace[];
  axes: readonly SignalAxis[];
  subscriptions: readonly SignalSubscription[];
  hostSample?: boolean;
  historyDependent?: boolean;
  needsFrame?(context: SignalEvaluationContext): boolean;
}
export type SignalDefinition = SignalMetadata &
  (
    | {
        category: 'value';
        valueType: 'number';
        evaluate(context: SignalEvaluationContext): number | undefined;
        presets?: readonly PresetDefinition[];
        preview?(value: number, context: SignalEvaluationContext): SignalPreview;
        period?: number;
        projection?: 'scroll-ratio';
      }
    | { category: 'value'; valueType: 'point'; evaluate(context: SignalEvaluationContext): Point | undefined }
    | { category: 'state'; valueType: 'boolean'; evaluate(context: SignalEvaluationContext): boolean | undefined }
    | { category: 'event'; valueType: 'event'; evaluate(context: SignalEvaluationContext): readonly WorldEvent[] }
  );
export type SignalDefinitions = Readonly<Record<string, SignalDefinition>>;
export type SignalIds<
  D extends SignalDefinitions,
  Category extends SignalDefinition['category'],
  Value extends SignalDefinition['valueType'],
> = {
  [K in keyof D & string]: D[K] extends { category: Category; valueType: Value } ? K : never;
}[keyof D & string];
export type NumericSignalIds<D extends SignalDefinitions> = SignalIds<D, 'value', 'number'>;
export interface SignalPreview {
  signals: SignalSnapshot;
  pointer?: PointerMemory;
}

export function createSignalRegistry<const D extends SignalDefinitions>(definitions: D) {
  const definition = (id: unknown): SignalDefinition | undefined =>
    typeof id === 'string' && Object.hasOwn(definitions, id) ? definitions[id] : undefined;
  const presets = Object.entries(definitions)
    .flatMap(([signal, value]) =>
      value.valueType === 'number'
        ? (value.presets ?? []).map((preset) => ({
            id: preset.id,
            label: preset.label,
            unit: preset.unit,
            order: preset.order,
            source: {
              signal: signal as NumericSignalIds<D>,
              axis: preset.axis,
              // Preserve the established source serialization order for saved data.
              // Timeline compares rule values independently of object key order.
              space: preset.space,
              inputRange: [...preset.inputRange] as [number, number],
            },
          }))
        : [],
    )
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...preset }) => preset);
  return Object.freeze({
    definitions: Object.freeze(definitions),
    catalog: Object.freeze(
      Object.fromEntries(
        Object.entries(definitions).map(([id, value]) => [
          id,
          { category: value.category, valueType: value.valueType },
        ]),
      ) as { [K in keyof D]: Pick<D[K], 'category' | 'valueType'> },
    ),
    presets,
    definition,
    numericSource(signal: unknown, space: unknown, axis: unknown) {
      const entry = definition(signal);
      return (
        entry?.category === 'value' &&
        entry.valueType === 'number' &&
        typeof space === 'string' &&
        entry.spaces.includes(space as SignalSpace) &&
        typeof axis === 'string' &&
        entry.axes.includes(axis as SignalAxis)
      );
    },
    evaluate(id: string, context: SignalEvaluationContext) {
      return definition(id)?.evaluate(context);
    },
    numericValue(source: NumericSource, context: Omit<SignalEvaluationContext, 'source'>): number | undefined {
      const entry = definition(source.signal);
      if (entry?.category !== 'value' || entry.valueType !== 'number') return undefined;
      const value = entry.evaluate({ ...context, source });
      return value !== undefined && Number.isFinite(value) ? value : undefined;
    },
    numericPreview(
      source: NumericSource,
      value: number,
      context: Omit<SignalEvaluationContext, 'source'>,
    ): SignalPreview {
      const entry = definition(source.signal);
      if (entry?.valueType !== 'number') return { signals: { ...context.signals } };
      if (entry.preview) return entry.preview(value, { ...context, source });
      return {
        signals: {
          ...context.signals,
          ...(entry.hostSample ? { samples: { ...context.signals.samples, [source.signal]: value } } : {}),
        },
      };
    },
    requires(id: string, subscription: SignalSubscription) {
      return definition(id)?.subscriptions.includes(subscription) ?? false;
    },
    subscriptions(ids: readonly string[]) {
      const needed = { pointer: false, scroll: false, video: false };
      for (const id of ids) for (const subscription of definition(id)?.subscriptions ?? []) needed[subscription] = true;
      return needed;
    },
    needsFrame(id: string, context: SignalEvaluationContext) {
      return definition(id)?.needsFrame?.(context) ?? false;
    },
    parseSamples(value: unknown): Record<string, HostSignalValue> {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length > Object.keys(definitions).length
      )
        throw new Error('シグナル入力が不正です。');
      return Object.fromEntries(
        Object.entries(value).map(([id, sample]) => {
          const entry = definition(id);
          if (!entry?.hostSample) throw new Error('未登録のシグナル入力です。');
          if (
            entry.valueType === 'number' &&
            typeof sample === 'number' &&
            Number.isFinite(sample) &&
            Math.abs(sample) <= 1e9
          )
            return [id, sample];
          if (entry.valueType === 'boolean' && typeof sample === 'boolean') return [id, sample];
          if (
            entry.valueType === 'point' &&
            sample &&
            typeof sample === 'object' &&
            !Array.isArray(sample) &&
            Object.keys(sample).every((key) => key === 'x' || key === 'y') &&
            Number.isFinite(sample.x) &&
            Number.isFinite(sample.y) &&
            Math.abs(sample.x) <= 1e7 &&
            Math.abs(sample.y) <= 1e7
          )
            return [id, { x: sample.x, y: sample.y }];
          throw new Error('シグナル入力の型または値が不正です。');
        }),
      );
    },
  });
}

export const scrollProgress = (signals: SignalSnapshot): number => {
  const scroll = signals.scroll;
  const value = scroll && scroll.maxY > 0 ? scroll.y / scroll.maxY : 0;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
};
const entryFor = (context: SignalEvaluationContext) => context.layout && layoutEntry(context.layout, context.layerId);
const frameFor = (context: SignalEvaluationContext) =>
  context.source?.space === 'viewport' && context.geometry
    ? { left: 0, top: 0, ...context.geometry.viewport }
    : entryFor(context)?.frame;
function component(context: SignalEvaluationContext, axis: SignalAxis) {
  const pointer = context.signals.pointer,
    frame = frameFor(context);
  if (!pointer || !frame || frame.width <= 0 || frame.height <= 0) return undefined;
  return axis === 'x' ? (pointer.x - frame.left) / frame.width : (pointer.y - frame.top) / frame.height;
}
function vector(context: SignalEvaluationContext) {
  const pointer = context.signals.pointer,
    frame = frameFor(context);
  if (!pointer || !frame || frame.width <= 0 || frame.height <= 0 || !context.geometry) return undefined;
  const origin = context.origin ?? legacySignalOrigin(context.source?.space ?? '', context.layerId ?? '');
  const target =
    origin &&
    resolvePoint(origin, {
      geometry: context.geometry,
      signals: context.signals,
      ...(context.layout ? { layout: context.layout } : {}),
    });
  return target
    ? { x: target.x - pointer.x, y: target.y - pointer.y, diagonal: Math.hypot(frame.width, frame.height) }
    : undefined;
}
const recentSpeed = (context: SignalEvaluationContext) =>
  Boolean(context.pointer && context.pointer.speed > 0 && (context.timeMs ?? 0) - context.pointer.timeMs <= 100);
const occurrence = (id: WorldEvent['type']) => (context: SignalEvaluationContext) =>
  (context.events ?? []).filter((event) => event.type === id);

function pointerPreview(
  context: SignalEvaluationContext,
  change: (point: Point, frame: NonNullable<ReturnType<typeof frameFor>>, target: Point) => void,
): SignalPreview {
  const frame = frameFor(context);
  if (!frame) return { signals: { ...context.signals, pointer: undefined } };
  const entry = entryFor(context);
  const target =
    context.source?.space === 'layer' && entry?.frame
      ? {
          x: entry.frame.left + entry.layer.placement.x * entry.frame.width,
          y: entry.frame.top + entry.layer.placement.y * entry.frame.height,
        }
      : { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
  const point = { ...(context.signals.pointer ?? target) };
  change(point, frame, target);
  return { signals: { ...context.signals, pointer: point, pointerTimeMs: 100 } };
}

export const SIGNAL_REGISTRY = createSignalRegistry({
  'pointer.position': {
    category: 'value',
    valueType: 'point',
    spaces: ['viewport'],
    axes: ['x', 'y'],
    subscriptions: ['pointer'],
    evaluate: (context) => context.signals.pointer,
  },
  'pointer.x': {
    category: 'value',
    valueType: 'number',
    spaces: ['viewport', 'anchor'],
    axes: ['x', 'y'],
    subscriptions: ['pointer'],
    evaluate: (context) => component(context, 'x'),
    preview: (value, context) =>
      pointerPreview(context, (point, frame) => {
        point.x = frame.left + value * frame.width;
      }),
    presets: [
      {
        id: 'mouse-x',
        label: 'マウス X / 画面',
        unit: '%',
        order: 1,
        space: 'viewport',
        axis: 'x',
        inputRange: [0, 1],
      },
      {
        id: 'anchor-x',
        label: 'マウス X / 配置アンカー',
        unit: '%',
        order: 3,
        space: 'anchor',
        axis: 'x',
        inputRange: [0, 1],
      },
    ],
  },
  'pointer.y': {
    category: 'value',
    valueType: 'number',
    spaces: ['viewport', 'anchor'],
    axes: ['x', 'y'],
    subscriptions: ['pointer'],
    evaluate: (context) => component(context, 'y'),
    preview: (value, context) =>
      pointerPreview(context, (point, frame) => {
        point.y = frame.top + value * frame.height;
      }),
    presets: [
      {
        id: 'mouse-y',
        label: 'マウス Y / 画面',
        unit: '%',
        order: 2,
        space: 'viewport',
        axis: 'y',
        inputRange: [0, 1],
      },
      {
        id: 'anchor-y',
        label: 'マウス Y / 配置アンカー',
        unit: '%',
        order: 4,
        space: 'anchor',
        axis: 'y',
        inputRange: [0, 1],
      },
    ],
  },
  'pointer.distance': {
    category: 'value',
    valueType: 'number',
    spaces: ['viewport', 'anchor', 'layer'],
    axes: ['x', 'y'],
    subscriptions: ['pointer'],
    evaluate: (context) => {
      const value = vector(context);
      return value ? Math.hypot(value.x, value.y) / value.diagonal : undefined;
    },
    preview: (value, context) =>
      pointerPreview(context, (point, frame, target) => {
        point.x = target.x - Math.max(0, value) * Math.hypot(frame.width, frame.height);
        point.y = target.y;
      }),
    presets: [
      {
        id: 'layer-distance',
        label: 'マウスと基本位置の距離',
        unit: '%',
        order: 5,
        space: 'layer',
        axis: 'y',
        inputRange: [0, 1],
      },
      {
        id: 'anchor-distance',
        label: 'マウスとアンカー中心の距離',
        unit: '%',
        order: 6,
        space: 'anchor',
        axis: 'y',
        inputRange: [0, 1],
      },
    ],
  },
  'pointer.angle': {
    category: 'value',
    valueType: 'number',
    spaces: ['viewport', 'anchor', 'layer'],
    axes: ['x', 'y'],
    subscriptions: ['pointer'],
    evaluate: (context) => {
      const value = vector(context);
      return value ? (Math.atan2(value.y, value.x) * 180) / Math.PI : undefined;
    },
    period: 360,
    preview: (value, context) =>
      pointerPreview(context, (point, _frame, target) => {
        const angle = (value * Math.PI) / 180;
        point.x = target.x - Math.cos(angle) * 100;
        point.y = target.y - Math.sin(angle) * 100;
      }),
    presets: [
      {
        id: 'layer-angle',
        label: 'マウスから基本位置への角度',
        unit: '°',
        order: 7,
        space: 'layer',
        axis: 'y',
        inputRange: [-180, 180],
      },
      {
        id: 'anchor-angle',
        label: 'マウスからアンカーへの角度',
        unit: '°',
        order: 8,
        space: 'anchor',
        axis: 'y',
        inputRange: [-180, 180],
      },
    ],
  },
  'pointer.speed': {
    category: 'value',
    valueType: 'number',
    spaces: ['viewport', 'anchor'],
    axes: ['x', 'y'],
    subscriptions: ['pointer'],
    evaluate: (context) =>
      !context.signals.pointer
        ? undefined
        : context.pointer && (context.timeMs ?? 0) - context.pointer.timeMs <= 100
          ? context.pointer.speed
          : 0,
    needsFrame: recentSpeed,
    historyDependent: true,
    preview: (value, context) => {
      const result = pointerPreview(context, () => {});
      const point = result.signals.pointer;
      return {
        ...result,
        ...(point
          ? { pointer: { point: { x: point.x - Math.max(0, value) * 0.05, y: point.y }, timeMs: 50, speed: 0 } }
          : {}),
      };
    },
    presets: [
      {
        id: 'mouse-speed',
        label: 'マウスの速度',
        unit: 'px/s',
        order: 9,
        space: 'viewport',
        axis: 'y',
        inputRange: [0, 2000],
      },
    ],
  },
  'user.idle.duration': {
    category: 'value',
    valueType: 'number',
    spaces: ['page'],
    axes: ['y'],
    subscriptions: [],
    hostSample: true,
    evaluate: (context) => {
      const value = context.signals.samples?.['user.idle.duration'];
      return typeof value === 'number' ? value : undefined;
    },
    needsFrame: () => true,
    presets: [
      { id: 'idle', label: '操作していない時間', unit: '秒', order: 10, space: 'page', axis: 'y', inputRange: [0, 30] },
    ],
  },
  'page.scroll.progress': {
    category: 'value',
    valueType: 'number',
    spaces: ['page'],
    axes: ['y'],
    subscriptions: ['scroll'],
    evaluate: (context) => scrollProgress(context.signals),
    projection: 'scroll-ratio',
    preview: (value, context) => {
      const maxY = Math.max(1, context.signals.scroll?.maxY ?? 1);
      return { signals: { ...context.signals, scroll: { x: 0, y: value * maxY, maxX: 0, maxY } } };
    },
    presets: [
      { id: 'scroll', label: 'ページのスクロール', unit: '%', order: 0, space: 'page', axis: 'y', inputRange: [0, 1] },
    ],
  },
  'video.playing': {
    category: 'state',
    valueType: 'boolean',
    spaces: [],
    axes: [],
    subscriptions: ['video'],
    evaluate: (context) => context.signals.playing,
  },
  'video.play': {
    category: 'event',
    valueType: 'event',
    spaces: [],
    axes: [],
    subscriptions: ['video'],
    evaluate: occurrence('video.play'),
  },
  'video.pause': {
    category: 'event',
    valueType: 'event',
    spaces: [],
    axes: [],
    subscriptions: ['video'],
    evaluate: occurrence('video.pause'),
  },
  'video.ended': {
    category: 'event',
    valueType: 'event',
    spaces: [],
    axes: [],
    subscriptions: ['video'],
    evaluate: occurrence('video.ended'),
  },
});
export type SignalId = keyof typeof SIGNAL_REGISTRY.definitions;
export type NumericSignal = NumericSignalIds<typeof SIGNAL_REGISTRY.definitions>;
export type PointSignal = SignalIds<typeof SIGNAL_REGISTRY.definitions, 'value', 'point'>;
export type BooleanStateSignal = SignalIds<typeof SIGNAL_REGISTRY.definitions, 'state', 'boolean'>;
export type SignalRegistry = Pick<
  ReturnType<typeof createSignalRegistry>,
  | 'definition'
  | 'numericSource'
  | 'numericValue'
  | 'numericPreview'
  | 'subscriptions'
  | 'requires'
  | 'needsFrame'
  | 'evaluate'
  | 'parseSamples'
>;
