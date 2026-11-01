import { parseEditCommand } from './commands';
import { editorCapabilities } from './capabilities';
import { defaultModelSettings, patchModel } from '../models/types';
import { ASSET_MESSAGES } from '../assets/limits';
import { emptyDesign, sameDesign } from '../design/schema';
import { readDesign, editDesign, commitDesign, shareDesign, freezeTree } from '../design/immutable';
import { IMAGE_LIMITS, type DesignDocument, type SurfaceStyle, type ImagePatch } from '../design/types';
import { moveGroup, reanchorPlacement, type PlacementChange } from '../world/geometry';
import {
  effectivelyLocked,
  groupMovable,
  groupView,
  normalizeSelection,
  parentGroup,
  rootLayers,
  sameAnchor,
} from '../world/hierarchy';
import { alignSamples, distributeSamples, type Alignment, type Distribution } from '../design/layout';
import { createHistory } from '../editor/history';
import { selectLayer } from '../editor/layers';
import {
  deleteDocumentLayers,
  duplicateDocumentLayers,
  groupLayers,
  groupingReason,
  reorderDocument,
  ungroupLayers,
} from '../editor/groups';
import {
  EDITOR_TOOLS,
  type EditCommand,
  type EditorCheckpoint,
  type EditorPorts,
  type EditorSnapshot,
  type EditorView,
  type EditorTool,
  type SkinPreview,
} from './types';
import { designAssetIds } from '../design/references';
import { defaultSkinFrame, fitSkinScale, putSkin, skinAssetProblem, withSkinFrame, type SkinSlot } from './skins';
import type { SignalRule } from '../signals/keyframes';

/** Portable, authoritative edit session. All environment access comes through ports. */
export function createEditorSession<Source extends { readonly length: number }>(ports: EditorPorts<Source>) {
  const storage = ports.storage,
    frameFor = ports.geometry.frameFor;
  const releaseAssets = storage.release,
    retainAssets = storage.retain;
  const checkDesignAssets = storage.validate,
    saveDesign = storage.save;
  let saved: DesignDocument | undefined,
    draft = readDesign(emptyDesign(ports.siteId, ports.baseThemeId)),
    pendingSave: DesignDocument | undefined;
  let active = false,
    enabled = false,
    settingsReceived = false,
    loaded = false,
    alive = true,
    loadError: string | undefined;
  const empty = draft;
  let tool: EditorTool = 'select';
  let selectedTarget: string | undefined,
    skinPreview: SkinPreview = {},
    selectedImageIds: string[] = [],
    snapping = false;
  let dirty = false,
    saving = false,
    importing = false,
    status = '',
    error = false;
  let interactionEpoch = 0,
    storageEpoch = 0,
    importEpoch = 0,
    assetSession: string | undefined,
    leased = '';
  let sessionId = '',
    revision = 0;
  let leaseQueue: Promise<void> = Promise.resolve();
  const deferredReleases = new Set<string>(),
    listeners = new Set<(state: EditorSnapshot) => void>();
  const history = createHistory<DesignDocument>(
    (doc) => doc,
    (a, b) => a === b,
  );
  const initial = () => saved ?? empty;
  const clearSelection = () => {
    selectedTarget = undefined;
    skinPreview = {};
  };
  function view(): EditorView {
    const groups = draft.groups ?? [];
    selectedImageIds = normalizeSelection(selectedImageIds, draft.decorations, groups);
    const group = selectedImageIds.length === 1 ? groups.find((group) => group.id === selectedImageIds[0]) : undefined;
    const image = group
      ? groupView(group, draft.decorations, frameFor)
      : selectedImageIds.length === 1
        ? draft.decorations.find((layer) => layer.id === selectedImageIds[0])
        : undefined;
    const rule = draft.rules.find((rule) => rule.target === selectedTarget);
    return {
      ...editorCapabilities(draft, selectedImageIds, saving || importing),
      selected: Boolean(selectedTarget),
      style: rule?.style ?? {},
      ...(selectedTarget ? { target: selectedTarget } : {}),
      ...(rule?.skin ? { skin: rule.skin } : {}),
      skinPreview: { ...skinPreview },
      dirty,
      saving: saving || importing,
      status,
      error,
      images: draft.decorations,
      groups,
      signalRules: draft.signalRules ?? [],
      image,
      inheritedLocked: Boolean(image && parentGroup(groups, image.id)?.locked),
      groupPositionAvailable: Boolean(
        !group || (group.visible && groupMovable(group, draft.decorations) && image && frameFor(image.placement)),
      ),
      groupingReason: groupingReason(draft, selectedImageIds),
      selectedIds: [...selectedImageIds],
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      snapping,
      tool,
    };
  }
  function snapshot(): EditorSnapshot {
    return {
      sessionId,
      revision,
      active,
      enabled,
      view: freezeTree(view()),
      document: draft,
      ...(saved ? { saved } : {}),
      ...(selectedTarget ? { selectedTarget } : {}),
    };
  }
  const render = () => {
    revision++;
    const state = snapshot();
    listeners.forEach((listener) => listener(state));
  };
  const syncAssets = (): Promise<void> => {
    const session = assetSession;
    if (!session) return Promise.resolve();
    const ids = [...new Set([draft, ...history.values()].flatMap(designAssetIds))];
    const key = ids.sort().join(',');
    leaseQueue = leaseQueue
      .catch(() => undefined)
      .then(async () => {
        if (session !== assetSession || leased === key) return;
        await retainAssets(session, ids);
        if (session === assetSession) leased = key;
      });
    return leaseQueue;
  };
  const settleAssets = () => {
    void syncAssets().catch((reason: unknown) => {
      if (active) {
        status = reason instanceof Error ? reason.message : '素材を保持できませんでした。';
        error = true;
        render();
      }
    });
  };
  const updateDraft = (next: DesignDocument, record = true) => {
    const parsed = shareDesign(initial(), commitDesign(next, draft));
    if (record) history.record(draft, parsed);
    draft = parsed;
    dirty = draft !== initial();
    status = dirty ? 'このタブでプレビュー中です。保存すると各タブに反映します。' : '保存済みの見た目です。';
    error = false;
    render();
  };
  function selectImage(id: string, additive = false, preserve = false) {
    const groups = draft.groups ?? [];
    if (!active || saving || importing || ![...draft.decorations, ...groups].some((image) => image.id === id)) return;
    if (additive && parentGroup(groups, id))
      selectedImageIds = selectedImageIds.filter((value) => value !== parentGroup(groups, id)!.id);
    clearSelection();
    selectedImageIds = normalizeSelection(
      selectLayer(selectedImageIds, id, additive, preserve),
      draft.decorations,
      groups,
    );
    status = '一覧のチェックで複数選択できます。Ctrl／Shiftクリックも使えます。';
    error = false;
    render();
  }
  const close = () => {
    storage.cancelImport();
    importEpoch++;
    importing = false;
    if (assetSession) {
      if (saving) deferredReleases.add(assetSession);
      else void releaseAssets(assetSession).catch(() => undefined);
      assetSession = undefined;
    }
    leased = '';
    selectedImageIds = [];
    interactionEpoch++;
    history.reset();
    clearSelection();
    active = false;
    draft = initial();
    dirty = false;
    render();
  };
  function changeImage(id: string, patch: ImagePatch) {
    if (!active || saving || importing) return;
    const groups = draft.groups ?? [],
      group = groups.find((group) => group.id === id),
      parent = parentGroup(groups, id);
    if (parent?.locked) return;
    const current = group ?? draft.decorations.find((image) => image.id === id);
    if (!current || (current.locked && Object.keys(patch).some((key) => !['locked', 'visible', 'name'].includes(key))))
      return;
    if (group) {
      if (patch.motion && !groupMovable(group, draft.decorations)) return;
      const next = editDesign(draft),
        { placement, playback: _playback, model: _model, ...properties } = patch;
      if (placement) {
        if (Object.keys(placement).some((key) => !['x', 'y'].includes(key)) || !groupMovable(group, draft.decorations))
          return;
        const view = groupView(group, draft.decorations, frameFor),
          frame = frameFor(view.placement);
        if (!frame) {
          status = '配置基準が画面に見つかりません。';
          error = true;
          render();
          return;
        }
        const changes = moveGroup(ports.geometry.samples(draft, [id]), {
          x: ((placement.x ?? view.placement.x) - view.placement.x) * frame.width,
          y: ((placement.y ?? view.placement.y) - view.placement.y) * frame.height,
        });
        const positions = new Map(changes.map((change) => [change.id, change.placement]));
        next.decorations = next.decorations.map((image) =>
          positions.has(image.id) ? { ...image, placement: positions.get(image.id)! } : image,
        );
      }
      next.groups = next.groups!.map((group) => (group.id === id ? { ...group, ...properties } : group));
      // A group renders as one subtree, so its members always follow its mode.
      const mode = properties.renderMode;
      if (mode)
        next.decorations = next.decorations.map((image) =>
          group.children.includes(image.id) ? { ...image, renderMode: mode } : image,
        );
      updateDraft(next);
      return;
    }
    if (current.kind === 'group') return;
    if (parent && patch.renderMode) {
      status = 'グループ内の描画モードはグループで変更してください。';
      error = true;
      render();
      return;
    }
    if (patch.placement?.anchor) {
      if (parent && !sameAnchor(current.placement.anchor, patch.placement.anchor)) {
        status = 'グループ内では配置基準を変更できません。解除してから変更してください。';
        error = true;
        render();
        return;
      }
      const from = frameFor(current.placement);
      const to = frameFor({ ...current.placement, anchor: patch.placement.anchor });
      if (!from || !to) {
        status = '配置基準が画面に見つかりません。';
        error = true;
        render();
        return;
      }
      patch = { ...patch, placement: reanchorPlacement(current.placement, from, to, patch.placement.anchor) };
    }
    const next = editDesign(draft);
    const { playback, model, ...properties } = patch;
    next.decorations = next.decorations.map((image) =>
      image.id !== id
        ? image
        : image.kind === 'model3d'
          ? {
              ...image,
              ...properties,
              placement: { ...image.placement, ...patch.placement },
              model: patchModel(image.model, model, image.source),
            }
          : image.kind === 'animation'
            ? {
                ...image,
                ...properties,
                placement: { ...image.placement, ...patch.placement },
                playback: { ...image.playback, ...playback },
              }
            : { ...image, ...properties, placement: { ...image.placement, ...patch.placement } },
    );
    updateDraft(next);
  }
  function changePlacements(changes: readonly PlacementChange[]) {
    if (!active || saving || importing) return;
    const next = editDesign(draft);
    const placements = new Map(changes.map((change) => [change.id, change.placement]));
    next.decorations = next.decorations.map((image) =>
      !effectivelyLocked(image, next.groups ?? []) && placements.has(image.id)
        ? { ...image, placement: placements.get(image.id)! }
        : image,
    );
    updateDraft(next);
  }
  function finishGesture(cancel = false) {
    if (!history.active) return;
    interactionEpoch++;
    if (cancel) {
      const before = history.cancel();
      if (before) updateDraft(before, false);
    } else {
      history.commit(draft);
      render();
    }
    settleAssets();
  }
  function changeSignalRule(value: SignalRule | string) {
    if (!active || saving || importing) return;
    const existing = draft.signalRules?.find((rule) => rule.id === (typeof value === 'string' ? value : value.id));
    const id = typeof value === 'string' ? existing?.target.layerId : value.target.layerId;
    const layer = [...draft.decorations, ...(draft.groups ?? [])].find((layer) => layer.id === id);
    if (!layer || layer.locked || parentGroup(draft.groups ?? [], layer.id)?.locked) return;
    if (existing && existing.target.layerId !== id)
      throw new Error('既存ルールの対象を直接変更できません。接続を外してから作り直してください。');
    const next = editDesign(draft);
    next.signalRules = (next.signalRules ?? []).filter(
      (rule) => rule.id !== (typeof value === 'string' ? value : value.id),
    );
    if (typeof value !== 'string') next.signalRules.push(value);
    updateDraft(next);
  }
  const undoRedo = (redo: boolean) => {
    if (saving || importing) return;
    if (history.active) {
      finishGesture(true);
      return;
    }
    const next = redo ? history.redo(draft) : history.undo(draft);
    if (next) {
      interactionEpoch++;
      updateDraft(next, false);
      settleAssets();
    }
  };
  const deleteImage = (id?: string) => {
    if (saving || importing) return;
    finishGesture();
    const next = deleteDocumentLayers(draft, id ? [id] : selectedImageIds);
    updateDraft(next);
    settleAssets();
  };
  const duplicate = (id?: string) => {
    if (saving || importing) return;
    finishGesture();
    try {
      const result = duplicateDocumentLayers(
        draft,
        id ? [id] : selectedImageIds,
        () => ports.makeId('image'),
        frameFor,
      );
      if (!result.ids.length) return;
      selectedImageIds = result.ids;
      clearSelection();
      updateDraft(result.doc);
      settleAssets();
    } catch (reason) {
      status = reason instanceof Error ? reason.message : '複製できませんでした。';
      error = true;
      render();
    }
  };
  const layoutSelection = (mode: Alignment | Distribution) => {
    if (saving || importing) return;
    finishGesture();
    if (draft.groups?.some((group) => selectedImageIds.includes(group.id))) {
      status = 'グループを含む整列は未対応です。子レイヤーを選択してください。';
      error = true;
      render();
      return;
    }
    const samples = ports.geometry.samples(draft, selectedImageIds);
    const distribution = mode === 'horizontal' || mode === 'vertical';
    if (samples.length < (distribution ? 3 : 2)) {
      status = '表示中でロックされていないレイヤーを選択してください。';
      error = true;
      render();
      return;
    }
    try {
      changePlacements(distribution ? distributeSamples(samples, mode) : alignSamples(samples, mode));
    } catch (reason) {
      status = reason instanceof Error ? reason.message : '整列できませんでした。';
      error = true;
      render();
    }
  };
  const groupSelection = (ungroup = false) => {
    if (saving || importing) return;
    finishGesture();
    try {
      if (ungroup) {
        const group =
          selectedImageIds.length === 1 ? draft.groups?.find((group) => group.id === selectedImageIds[0]) : undefined;
        if (!group) return;
        const next = ungroupLayers(draft, group.id);
        selectedImageIds = [...group.children];
        updateDraft(next);
      } else {
        const id = ports.makeId('group'),
          next = groupLayers(draft, selectedImageIds, id);
        selectedImageIds = [id];
        clearSelection();
        updateDraft(next);
      }
      status = ungroup
        ? `${selectedImageIds.length}個の素材に戻しました。位置は維持しています。`
        : 'グループにまとめました。「光とマスクを設定」から共通のマスクを作れます。';
      render();
      settleAssets();
    } catch (reason) {
      status = reason instanceof Error ? reason.message : 'グループを変更できませんでした。';
      error = true;
      render();
    }
  };
  const addImages = async (files: Source, point?: { x: number; y: number }) => {
    if (!active || !assetSession || saving || importing || !files.length) return;
    if (draft.decorations.length + files.length > IMAGE_LIMITS.count) {
      status = ASSET_MESSAGES.layerCount;
      error = true;
      render();
      return;
    }
    const epoch = importEpoch;
    const importSession = ports.makeId('session');
    let before: DesignDocument | undefined;
    const previousSelection = [...selectedImageIds];
    importing = true;
    status = '画像を読み込んでいます…';
    error = false;
    render();
    try {
      const assets = await storage.import(files, importSession);
      if (epoch !== importEpoch || !active) return;
      before = draft;
      const next = editDesign(draft);
      let importedSelection: string | undefined;
      const { width, height, origin } = ports.geometry.importFrame(point);
      assets.forEach((asset, index) => {
        const scale = Math.max(
          IMAGE_LIMITS.minSize / Math.min(asset.width, asset.height),
          Math.min(260 / asset.width, 200 / asset.height, (width * 0.28) / asset.width, (height * 0.3) / asset.height),
        );
        const id = ports.makeId('image');
        const common = {
          id,
          assetId: asset.id,
          name: asset.name,
          placement: {
            anchor: { kind: 'viewport' as const },
            x: Math.min(0.95, Math.max(0.05, origin.x / width + (index * 24) / width)),
            y: Math.min(0.95, Math.max(0.05, origin.y / height + (index * 24) / height)),
            widthPx: Math.round(asset.width * scale * 10) / 10,
            heightPx: Math.round(asset.height * scale * 10) / 10,
            rotationDeg: 0,
          },
          opacity: 1,
          zIndex: Math.min(100, next.decorations.length),
          visible: true,
          locked: false,
        };
        next.decorations.push(
          asset.model
            ? { ...common, kind: 'model3d', source: asset.model, model: defaultModelSettings(asset.model) }
            : asset.animation
              ? {
                  ...common,
                  kind: 'animation',
                  format: asset.animation.format,
                  playback: { playing: true, loop: true, speed: 1, mode: 'auto' },
                }
              : { ...common, kind: 'image' },
        );
        importedSelection = id;
      });
      await checkDesignAssets(next, importSession);
      if (epoch !== importEpoch || !active) return;
      if (before !== draft) {
        before = undefined;
        selectedImageIds = previousSelection;
        throw new Error('別のタブの保存値が変わったため、素材の追加を中止しました。もう一度読み込んでください。');
      }
      // A geometry snapshot during preflight still sees the old document.
      // Publish a new selected ID only when that layer enters the draft.
      if (importedSelection) selectedImageIds = [importedSelection];
      tool = 'select';
      clearSelection();
      updateDraft(next, false);
      leased = '';
      await syncAssets();
      if (epoch !== importEpoch || !active) return;
      history.record(before, draft);
      settleAssets();
    } catch (reason) {
      if (epoch !== importEpoch || !active) return;
      if (before) {
        selectedImageIds = previousSelection;
        updateDraft(before, false);
      }
      status = reason instanceof Error ? reason.message : '画像を読み込めませんでした。';
      error = true;
      leased = '';
      settleAssets();
    } finally {
      void releaseAssets(importSession).catch(() => undefined);
      if (epoch === importEpoch) {
        importing = false;
        render();
      }
    }
  };
  const discard = () => {
    history.reset();
    interactionEpoch++;
    draft = initial();
    dirty = false;
    status = '変更を破棄しました。';
    error = false;
    render();
    settleAssets();
  };
  const change = (style: SurfaceStyle) => {
    if (!selectedTarget || saving || importing) return;
    const next = editDesign(draft);
    // A part's UI skin survives colour edits; only an empty rule is removed.
    const skin = next.rules.find((rule) => rule.target === selectedTarget)?.skin;
    next.rules = next.rules.filter((rule) => rule.target !== selectedTarget!);
    if (Object.keys(style).length > 0 || skin)
      next.rules.push({ kind: 'surface-style', target: selectedTarget, style, ...(skin ? { skin } : {}) });
    updateDraft(next);
  };
  const skinTarget = () => {
    const target = ports.targets.find((item) => item.id === selectedTarget);
    if (!target) throw new Error('着せ替える部品を選んでください。');
    if (!target.skin) throw new Error(`${target.label}は着せ替えに対応していません。`);
    return target;
  };
  const refuse = (message: string) => {
    status = message;
    error = true;
    render();
  };
  /** Uses the shared asset import, then stores the asset in one skin slot instead of a layer. */
  const addSkinImage = async (files: Source, slot: SkinSlot) => {
    if (!active || !assetSession || saving || importing || !files.length) return;
    let target;
    try {
      target = skinTarget();
    } catch (reason) {
      return refuse(reason instanceof Error ? reason.message : '着せ替える部品を選んでください。');
    }
    if (files.length !== 1) return refuse('着せ替えの絵は1枚ずつ入れてください。');
    const existing = draft.rules.find((rule) => rule.target === target.id)?.skin;
    if (slot !== 'normal' && !existing) return refuse('先に通常状態の絵を入れてください。');
    finishGesture();
    const epoch = importEpoch,
      importSession = ports.makeId('session');
    let before: DesignDocument | undefined;
    importing = true;
    status = '着せ替えの絵を読み込んでいます…';
    error = false;
    render();
    try {
      const [asset] = await storage.import(files, importSession);
      if (epoch !== importEpoch || !active) return;
      if (!asset) throw new Error('画像を読み込めませんでした。');
      const problem = skinAssetProblem(asset);
      if (problem) throw new Error(problem);
      before = draft;
      // Keep the guides an author already placed when only the art of a slot changes.
      const previous =
        slot === 'compact'
          ? existing?.compact?.kind === 'frame'
            ? existing.compact.frame
            : undefined
          : existing?.states[slot];
      const frame =
        previous &&
        previous.slices.left + previous.slices.right <= asset.width &&
        previous.slices.top + previous.slices.bottom <= asset.height
          ? { ...previous, assetId: asset.id }
          : fitSkinScale(defaultSkinFrame(asset), target.skin?.sample);
      const next = putSkin(draft, target.id, withSkinFrame(existing, slot, frame));
      await checkDesignAssets(next, importSession);
      if (epoch !== importEpoch || !active) return;
      if (before !== draft) {
        before = undefined;
        throw new Error('別のタブの保存値が変わったため、素材の追加を中止しました。もう一度読み込んでください。');
      }
      updateDraft(next, false);
      leased = '';
      await syncAssets();
      if (epoch !== importEpoch || !active) return;
      history.record(before, draft);
      status = `${target.label}に絵を入れました。ガイドをドラッグして切り位置を調整できます。`;
      settleAssets();
    } catch (reason) {
      if (epoch !== importEpoch || !active) return;
      if (before && before !== draft) updateDraft(before, false);
      status = reason instanceof Error ? reason.message : '画像を読み込めませんでした。';
      error = true;
      leased = '';
      settleAssets();
    } finally {
      void releaseAssets(importSession).catch(() => undefined);
      if (epoch === importEpoch) {
        importing = false;
        render();
      }
    }
  };

  const accept = (incoming: DesignDocument | undefined) => {
    // Validate support before changing session state; unsupported data stays on disk.
    const previous = saved;
    incoming = incoming ? readDesign(incoming) : undefined;
    if (incoming && previous) incoming = shareDesign(previous, incoming);
    ports.validate(incoming);
    saved = incoming && pendingSave && sameDesign(incoming, pendingSave) ? pendingSave : incoming;
    storageEpoch++;
    loaded = true;
    loadError = undefined;
    if (pendingSave && sameDesign(incoming, pendingSave)) {
      draft = initial();
      dirty = false;
    } else if (!dirty) {
      if (!sameDesign(previous, incoming)) {
        history.reset();
        interactionEpoch++;
      }
      draft = initial();
      if (active) {
        status = '保存済みのデザインを読み込みました。';
        error = false;
      }
    } else if (!sameDesign(previous, incoming)) {
      status =
        '別のタブで保存されました。プレビューは保持しています。保存すると上書きし、破棄すると最新の保存値に戻ります。';
      error = true;
    }
    render();
    if (active) settleAssets();
  };
  const onStorageError = (reason: unknown) => {
    loaded = true;
    loadError = reason instanceof Error ? reason.message : 'デザインを読み込めませんでした。';
    saved = undefined;
    close();
  };
  const save = async () => {
    finishGesture();
    if (!dirty || saving || importing || !assetSession) return;
    const saveSession = assetSession;
    const snapshot = draft;
    pendingSave = snapshot;
    saving = true;
    status = '保存しています…';
    error = false;
    render();
    try {
      // Renew the session's complete draft/history lease before crossing the save boundary.
      leased = '';
      await syncAssets();
      await saveDesign(snapshot, saveSession);
      const epoch = storageEpoch;
      const latest = await storage.read();
      if (!alive) return;
      // A newer notification beats a read that was already in flight.
      if (epoch === storageEpoch) accept(latest);
      status = sameDesign(saved, snapshot) ? '保存しました。' : '別のタブの新しい保存値を読み込みました。';
      error = false;
    } catch {
      if (!alive) return;
      status = '保存できませんでした。プレビューを保持しています。もう一度保存してください。';
      error = true;
    } finally {
      pendingSave = undefined;
      saving = false;
      deferredReleases.forEach((session) => {
        void releaseAssets(session).catch(() => undefined);
      });
      deferredReleases.clear();
      if (alive) render();
    }
  };

  function open(): { ok: boolean; error?: string } {
    if (!settingsReceived) return { ok: false, error: '設定を読み込み中です。少し待ってから開いてください。' };
    if (!enabled) return { ok: false, error: 'テーマをONにし、強さを1%以上にしてから編集してください。' };
    if (!loaded) return { ok: false, error: 'デザインを読み込み中です。少し待ってから開いてください。' };
    if (loadError) return { ok: false, error: loadError };
    if (active) return { ok: true };
    draft = initial();
    history.reset();
    interactionEpoch++;
    selectedImageIds = [];
    clearSelection();
    dirty = false;
    tool = 'select';
    active = true;
    assetSession = ports.makeId('session');
    sessionId = assetSession;
    leased = '';
    importEpoch++;
    status = 'カードを選ぶか、画像を追加してください。';
    error = false;
    render();
    settleAssets();
    return { ok: true };
  }
  async function execute(command: EditCommand): Promise<void> {
    command = parseEditCommand(command);
    if (!active) throw new Error('編集セッションが開かれていません。');
    if ((saving || importing) && command.type !== 'close' && command.type !== 'tool')
      throw new Error('処理中です。完了を待ってください。');
    switch (command.type) {
      case 'tool':
        if (!EDITOR_TOOLS.includes(command.tool)) throw new Error('未対応のツールです。');
        finishGesture(true);
        tool = command.tool;
        // A forced preview belongs to the skin editor; other tools show the live page.
        if (tool !== 'skin') skinPreview = {};
        render();
        break;
      case 'select':
        selectImage(command.id, command.additive, command.preserve);
        break;
      case 'select-target':
        if (command.target !== undefined && !ports.targets.some((target) => target.id === command.target))
          throw new Error('編集できない対象です。');
        finishGesture(true);
        selectedImageIds = [];
        if (selectedTarget !== command.target) skinPreview = {};
        selectedTarget = command.target;
        render();
        break;
      case 'select-all':
        finishGesture();
        clearSelection();
        selectedImageIds = rootLayers(draft.decorations, draft.groups ?? []).map((layer) => layer.id);
        render();
        break;
      case 'clear-selection':
        finishGesture(true);
        clearSelection();
        selectedImageIds = [];
        render();
        break;
      case 'change': {
        const id = command.id ?? (selectedImageIds.length === 1 ? selectedImageIds[0] : undefined);
        if (id) changeImage(id, command.patch);
        break;
      }
      case 'signal-rule':
        changeSignalRule(command.rule);
        break;
      case 'remove-signal-rule':
        changeSignalRule(command.id);
        break;
      case 'style':
        change(command.style);
        break;
      case 'skin':
        if (saving || importing) break;
        updateDraft(putSkin(draft, skinTarget().id, command.skin));
        settleAssets();
        break;
      case 'skin-preview':
        if (!selectedTarget) break;
        skinPreview = {
          ...(command.state ? { state: command.state } : {}),
          ...(command.compact ? { compact: true } : {}),
        };
        render();
        break;
      case 'placements':
        changePlacements(command.changes);
        break;
      case 'begin':
        history.begin(draft);
        render();
        break;
      case 'end':
        finishGesture(command.cancel);
        break;
      case 'undo':
        undoRedo(false);
        break;
      case 'redo':
        undoRedo(true);
        break;
      case 'delete':
        deleteImage(command.id);
        break;
      case 'duplicate':
        duplicate(command.id);
        break;
      case 'group':
        groupSelection();
        break;
      case 'ungroup':
        groupSelection(true);
        break;
      case 'layout':
        layoutSelection(command.mode);
        break;
      case 'snap':
        snapping = command.value;
        render();
        break;
      case 'nudge':
        if (!history.active)
          changePlacements(moveGroup(ports.geometry.samples(draft, selectedImageIds), command.delta));
        break;
      case 'reorder':
        finishGesture();
        updateDraft(reorderDocument(draft, command.id, command.targetId, command.after));
        settleAssets();
        break;
      case 'discard':
        discard();
        break;
      case 'save':
        await save();
        break;
      case 'close':
        close();
        break;
    }
  }
  function checkpoint(): EditorCheckpoint {
    return {
      version: 1,
      siteId: ports.siteId,
      draft,
      ...(saved ? { saved } : {}),
      selectedIds: [...selectedImageIds],
      tool,
      ...(selectedTarget ? { selectedTarget } : {}),
      snapping,
      history: history.checkpoint(),
    };
  }
  async function restore(value: EditorCheckpoint) {
    if (!active || saving || importing || value.version !== 1 || value.siteId !== ports.siteId)
      throw new Error('この編集セッションに復元できません。');
    const restoringSession = sessionId;
    const next = readDesign(value.draft),
      restoredSaved = value.saved === undefined ? undefined : readDesign(value.saved);
    if (value.tool !== undefined && !EDITOR_TOOLS.includes(value.tool)) throw new Error('復旧ツールが不正です。');
    if (
      next.siteId !== ports.siteId ||
      !Array.isArray(value.selectedIds) ||
      value.selectedIds.length > 48 ||
      value.selectedIds.some((id) => typeof id !== 'string') ||
      typeof value.snapping !== 'boolean' ||
      (value.selectedTarget !== undefined && !ports.targets.some((target) => target.id === value.selectedTarget))
    )
      throw new Error('復旧データが不正です。');
    let previousRestored = next;
    const restored = createHistory<DesignDocument>((doc) => {
      previousRestored = shareDesign(previousRestored, readDesign(doc));
      return previousRestored;
    }, sameDesign);
    restored.restore(value.history);
    if (restored.values().some((doc) => doc.siteId !== ports.siteId))
      throw new Error('復旧データの対象が一致しません。');
    const ids = [...new Set([next, ...restored.values()].flatMap(designAssetIds))];
    await retainAssets(assetSession!, ids);
    await checkDesignAssets(next, assetSession!);
    if (!active || restoringSession !== sessionId) return;
    history.restore(restored.checkpoint());
    if (history.active) history.commit(next);
    draft = shareDesign(initial(), next);
    selectedImageIds = normalizeSelection(value.selectedIds, draft.decorations, draft.groups ?? []);
    selectedTarget = value.selectedTarget;
    snapping = value.snapping;
    tool = value.tool ?? 'select';
    dirty = draft !== initial();
    interactionEpoch++;
    error = !sameDesign(restoredSaved, saved);
    status = error
      ? '復旧中に保存済みデザインが変わりました。プレビューを保持しています。保存すると上書きし、破棄すると最新の保存値に戻ります。'
      : '編集セッションとUndo履歴を復元しました。';
    render();
    settleAssets();
  }
  let unwatch = storage.watch(accept, onStorageError);
  return {
    open,
    execute,
    snapshot,
    checkpoint,
    restore,
    import: addImages,
    importSkin: addSkinImage,
    subscribe(listener: (state: EditorSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(value: boolean) {
      settingsReceived = true;
      if (enabled === value) return;
      enabled = value;
      if (!enabled && active) close();
      else render();
    },
    reload() {
      unwatch();
      loaded = false;
      unwatch = storage.watch(accept, onStorageError);
    },
    // Host geometry is live input, not a document/selection revision.
    refreshGeometry() {
      if (active) {
        const state = snapshot();
        listeners.forEach((listener) => listener(state));
      }
    },
    get interactionEpoch() {
      return interactionEpoch;
    },
    get gestureActive() {
      return history.active;
    },
    get historyVersion() {
      return history.version;
    },
    fail(message: string) {
      status = message;
      error = true;
      render();
    },
    destroy() {
      alive = false;
      unwatch();
      close();
      listeners.clear();
    },
  };
}
