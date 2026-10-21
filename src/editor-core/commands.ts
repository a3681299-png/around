import type { EditCommand } from './types';
import {
  assertCommandData,
  commandObject,
  parseImagePatch,
  parsePlacements,
  parseStyle,
  parseSignalRule,
} from './validation';

/** Reject unrecognized command keys, executable values and unbounded messages. */
export function parseEditCommand(value: unknown): EditCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('編集コマンドが不正です。');
  assertCommandData(value);
  const object = { ...(value as Record<string, unknown>) };
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
  commandObject(value, ['type', ...fields[object.type]!]);
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
  if (
    object.type === 'tool' &&
    (typeof object.tool !== 'string' || !['select', 'browse', 'card'].includes(object.tool))
  )
    throw new Error('未対応のツールです。');
  if (object.type === 'nudge') {
    const point = commandObject(object.delta, ['x', 'y']);
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
  if (object.type === 'placements') object.changes = parsePlacements(object.changes);
  if (
    object.type === 'layout' &&
    (typeof object.mode !== 'string' ||
      !['left', 'center-x', 'right', 'top', 'center-y', 'bottom', 'horizontal', 'vertical'].includes(object.mode))
  )
    throw new Error('整列方法が不正です。');
  if (object.type === 'change') object.patch = parseImagePatch(object.patch);
  if (object.type === 'style') object.style = parseStyle(object.style);
  if (object.type === 'signal-rule') object.rule = parseSignalRule(object.rule);
  if (object.type === 'remove-signal-rule' && typeof object.id !== 'string')
    throw new Error('接続の識別子が不正です。');
  const text = JSON.stringify(object);
  if (text.length > 100_000) throw new Error('編集コマンドの内容が不正です。');
  return JSON.parse(text) as EditCommand;
}
