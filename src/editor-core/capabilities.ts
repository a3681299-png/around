import { GROUP_LIMITS, IMAGE_LIMITS, type DesignDocument } from '../design/types';
import { childrenOf, effectivelyLocked, groupMovable, parentGroup } from '../design/hierarchy';
import { MODEL_LIMITS } from '../models/types';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import { ASSET_MESSAGES } from '../assets/limits';
import { groupingReason, ungroupingReason } from '../editor/groups';
import type { EditorCapabilities, EditorCapability } from './types';

const capability = (reason: string): EditorCapability => ({ allowed: !reason, reason });

/** UI and hosts consume reasons from the same authoritative composition state. */
export function editorCapabilities(
  doc: DesignDocument,
  selectedIds: readonly string[],
  busy: boolean,
): EditorCapabilities {
  const groups = doc.groups ?? [],
    images = doc.decorations;
  const selected = [...images, ...groups].filter(
    (layer) =>
      selectedIds.includes(layer.id) &&
      (layer.kind === 'group' ? groupMovable(layer, images) : !effectivelyLocked(layer, groups)),
  );
  const media = selected.flatMap((layer) => (layer.kind === 'group' ? childrenOf(layer, images) : [layer]));
  const group = selectedIds.length === 1 ? groups.find((group) => group.id === selectedIds[0]) : undefined;
  const image = selectedIds.length === 1 ? images.find((image) => image.id === selectedIds[0]) : undefined;
  const working = busy ? '処理中です。完了を待ってください。' : '';
  const select = selected.length ? '' : 'ロックされていないレイヤーを選択してください。';
  const layerLimit = images.length >= IMAGE_LIMITS.count ? ASSET_MESSAGES.layerCount : '';
  const models = images.filter((image) => image.kind === 'model3d').length;
  const animations = images.filter((image) => image.kind === 'animation').length;
  const eligible = groups.some((group) => selectedIds.includes(group.id))
    ? 0
    : images.filter(
        (image) =>
          selectedIds.includes(image.id) &&
          image.visible &&
          !effectivelyLocked(image, groups) &&
          parentGroup(groups, image.id)?.visible !== false,
      ).length;
  const groupReason = groupingReason(doc, selectedIds);
  return {
    canDuplicate: capability(
      working ||
        select ||
        (images.length + media.length > IMAGE_LIMITS.count ? ASSET_MESSAGES.layerCount : '') ||
        (animations + media.filter((image) => image.kind === 'animation').length > ANIMATION_LIMITS.count
          ? ASSET_MESSAGES.layerCount
          : '') ||
        (models + media.filter((image) => image.kind === 'model3d').length > MODEL_LIMITS.count
          ? ASSET_MESSAGES.modelCount
          : '') ||
        (groups.length + selected.filter((layer) => layer.kind === 'group').length > GROUP_LIMITS.count
          ? 'グループは16個までです。'
          : ''),
    ),
    canDelete: capability(working || select),
    canGroup: capability(working || groupReason),
    canUngroup: capability(working || ungroupingReason(group, doc.signalRules)),
    canAddImage: capability(working || layerLimit),
    canAddModel: capability(working || layerLimit || (models >= MODEL_LIMITS.count ? ASSET_MESSAGES.modelCount : '')),
    canAddAnimation: capability(
      working || layerLimit || (animations >= ANIMATION_LIMITS.count ? ASSET_MESSAGES.layerCount : ''),
    ),
    canAlign: capability(
      working || (eligible < 2 ? '表示中でロックされていないレイヤーを2個以上選択してください。' : ''),
    ),
    canDistribute: capability(
      working || (eligible < 3 ? '表示中でロックされていないレイヤーを3個以上選択してください。' : ''),
    ),
    canChangeMotion: capability(group && !groupMovable(group, images) ? '子レイヤーをロック解除してください。' : ''),
    canChangeAnchor: capability(
      group || (image && parentGroup(groups, image.id)) ? 'グループ内では配置基準を変更できません。' : '',
    ),
  };
}
