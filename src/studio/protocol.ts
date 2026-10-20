import type { EditCommand, EditorCheckpoint, EditorSnapshot } from '../editor-core/types';
import type { DesignTarget } from '../design/types';
import type { AssetWireFile } from '../assets/protocol';
import { parseSignalRules } from '../signals/keyframe-schema';
import type { TimelineCommand, TimelineUpdate } from '../timeline/types';

export const STUDIO_PORT = 'web-world-themes:studio-v1';
export const STUDIO_PROBE = 'web-world-themes:studio-probe';
export interface StudioTarget {
  id: number;
  title: string;
  siteId: string;
  enabled: boolean;
  anchors: readonly DesignTarget[];
  targets: readonly DesignTarget[];
}
export type StudioRequest =
  | { id: number; type: 'attach'; owner: string; resume?: EditorCheckpoint; visible?: boolean }
  | { id: number; type: 'surface-visibility'; visible: boolean }
  | { id: number; type: 'command'; session: string; revision: number; command: EditCommand }
  | { id: number; type: 'import'; session: string; revision: number; files: AssetWireFile[] }
  | { id: number; type: 'import-assets'; session: string; revision: number; assets: string[] }
  | { id: number; type: 'thumbnail'; layer: string }
  | { id: number; type: 'timeline'; session: string; command: TimelineCommand }
  | { id: number; type: 'detach' };
export interface StudioUpdate {
  type: 'state';
  state: EditorSnapshot;
  checkpoint?: EditorCheckpoint;
}
export interface StudioReply {
  type: 'reply';
  id: number;
  ok: boolean;
  error?: string;
  state?: EditorSnapshot;
  checkpoint?: EditorCheckpoint;
  thumbnail?: string;
}
export type StudioMessage =
  StudioUpdate | StudioReply | { type: 'handoff' } | { type: 'timeline'; update: TimelineUpdate };

/** Reject unrecognized command keys, executable values and unbounded messages. */
export function parseEditCommand(value: unknown): EditCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('編集コマンドが不正です。');
  const object = value as Record<string, unknown>;
  const fields: Record<string, readonly string[]> = {
    select: ['id', 'additive', 'preserve'],
    'select-target': ['target'],
    'select-all': [],
    'clear-selection': [],
    group: [],
    ungroup: [],
    undo: [],
    redo: [],
    discard: [],
    save: [],
    close: [],
    begin: [],
    end: ['cancel'],
    change: ['id', 'patch'],
    style: ['style'],
    delete: ['id'],
    duplicate: ['id'],
    placements: ['changes'],
    reorder: ['id', 'targetId', 'after'],
    snap: ['value'],
    layout: ['mode'],
    nudge: ['delta'],
    tool: ['tool'],
    'signal-rule': ['rule'],
    'remove-signal-rule': ['id'],
  };
  if (
    typeof object.type !== 'string' ||
    !Object.hasOwn(fields, object.type) ||
    Object.keys(object).some((key) => key !== 'type' && !fields[object.type as string]!.includes(key))
  )
    throw new Error('未対応の編集コマンドです。');
  const text = JSON.stringify(object);
  function safe(input: unknown): boolean {
    if (!input || typeof input !== 'object') return typeof input !== 'function';
    return Object.entries(input).every(
      ([key, item]) =>
        !['__proto__', 'prototype', 'constructor', 'script', 'expression', 'javascript', 'onload'].includes(key) &&
        safe(item),
    );
  }
  if (text.length > 100_000 || !safe(object)) throw new Error('編集コマンドの内容が不正です。');
  for (const key of ['id', 'targetId', 'target'])
    if (object[key] !== undefined && (typeof object[key] !== 'string' || (object[key] as string).length > 120))
      throw new Error('レイヤー指定が不正です。');
  for (const key of ['additive', 'preserve', 'cancel', 'after', 'value'])
    if (object[key] !== undefined && typeof object[key] !== 'boolean') throw new Error('編集コマンドの値が不正です。');
  if (
    (object.type === 'select' && typeof object.id !== 'string') ||
    (object.type === 'reorder' &&
      (typeof object.id !== 'string' || typeof object.targetId !== 'string' || typeof object.after !== 'boolean')) ||
    (object.type === 'snap' && typeof object.value !== 'boolean')
  )
    throw new Error('編集コマンドの必須値がありません。');
  if (object.type === 'tool' && !['select', 'browse', 'card'].includes(String(object.tool)))
    throw new Error('未対応のツールです。');
  if (object.type === 'nudge') {
    const point = object.delta as { x?: unknown; y?: unknown } | undefined;
    if (
      !point ||
      typeof point.x !== 'number' ||
      typeof point.y !== 'number' ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      Math.abs(point.x) > 4096 ||
      Math.abs(point.y) > 4096
    )
      throw new Error('移動量が不正です。');
  }
  if (object.type === 'placements') {
    if (
      !Array.isArray(object.changes) ||
      object.changes.length > 32 ||
      object.changes.some(
        (entry) =>
          !entry ||
          typeof entry.id !== 'string' ||
          entry.id.length > 120 ||
          !entry.placement ||
          typeof entry.placement !== 'object',
      )
    )
      throw new Error('配置が不正です。');
  }
  if (
    object.type === 'layout' &&
    !['left', 'center-x', 'right', 'top', 'center-y', 'bottom', 'horizontal', 'vertical'].includes(String(object.mode))
  )
    throw new Error('整列方法が不正です。');
  if (object.type === 'change' && (!object.patch || typeof object.patch !== 'object' || Array.isArray(object.patch)))
    throw new Error('プロパティが不正です。');
  if (object.type === 'style' && (!object.style || typeof object.style !== 'object' || Array.isArray(object.style)))
    throw new Error('外観が不正です。');
  if (object.type === 'signal-rule') {
    const rule = object.rule as { target?: { layerId?: unknown } } | undefined;
    parseSignalRules([rule], new Set(typeof rule?.target?.layerId === 'string' ? [rule.target.layerId] : []));
  }
  if (object.type === 'remove-signal-rule' && typeof object.id !== 'string')
    throw new Error('接続の識別子が不正です。');
  return JSON.parse(text) as EditCommand;
}
