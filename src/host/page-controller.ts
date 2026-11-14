import { compileDesign, createDesignRenderer, type SkinAssetPort, type SkinAssetStatus } from '../design/renderer';
import type { InkDecision } from '../design/contrast';
import { readDesign } from '../design/immutable';
import { depthOf, type DesignDocument } from '../design/types';
import { createSpaceHost, type ResidentSource } from './space';
import { createImageRenderer, type ImageEditing } from '../design/image-renderer';
import type { SiteAdapter, SitePageChange } from '../sites/types';
import type { UserSettings } from '../storage/settings';
import { createTimelineHost, type TimelineHost } from './timeline';
import type { TakeStorage } from '../timeline/types';
import type { AssetPort } from '../assets/port';
import { createOperationGuardHost, guardWanted, type OperationGuardHost } from './operation-guard';
import { legacyPageChange } from '../diagnostics/page-change-probe';
import { g11GuardDisabled, g11RegisterRefresh } from '../diagnostics/g11-hooks';

/** The only base an artwork may still name: artwork saved while the retro theme existed (until
 * retro-theme-final) names it, and draws exactly as artwork with no base. */
const LEGACY_BASE_THEME = 'retro';

export interface PageController {
  safety: OperationGuardHost | undefined;
  suspend(value: boolean): void;
  timeline: TimelineHost;
  update(settings: UserSettings): void;
  updateDesign(design: DesignDocument | undefined): void;
  setImageEditing(editing: ImageEditing | undefined): void;
  /** Load state of a UI skin's art in the page renderer. */
  skinAssetStatus(assetId: string): SkinAssetStatus | undefined;
  skinInkStatus(target: string): Readonly<Record<string, InkDecision>> | undefined;
  setSkinPreviews(enabled: boolean): void;
  validateDesign(design: DesignDocument | undefined): void;
  destroy(): void;
}

/** The space's resident (v18): its 3D layer with a character, as the room's Host needs it. A
 * layer that is missing or has no character leaves the room without a resident. */
function residentOf(design: DesignDocument | undefined): ResidentSource | undefined {
  const id = design?.space?.resident?.layerId;
  const layer = id ? design.decorations.find((item) => item.id === id) : undefined;
  if (!layer || layer.kind !== 'model3d' || !layer.character) return undefined;
  return {
    layerId: layer.id,
    assetId: layer.assetId,
    motions: layer.character.motions.map((m) => ({ id: m.id, assetId: m.assetId, role: m.role })),
  };
}

/** What the page runtime reads and keeps outside the page. The extension's implementations live
 * in `src/browser/`; another host (the Playground) passes its own. The runtime never imports them. */
export interface PagePorts {
  assets: AssetPort;
  takes: TakeStorage;
  skinAssets?: SkinAssetPort;
}

/** Everything the page draws for the artwork — skin CSS, image and model layers, operation safety
 * and the timeline — started once and following the page while artwork is shown. */
export function createPageController(
  doc: Document,
  site: SiteAdapter,
  ports: PagePorts,
  onSurfacesChanged?: () => void,
): PageController {
  const designRenderer = createDesignRenderer(doc, site.designTargets ?? [], ports.skinAssets, () =>
    onSurfacesChanged?.(),
  );
  const timeline = createTimelineHost(doc, site.id, ports.takes);
  // g11GuardDisabled is false outside the G1 measurement build (src/diagnostics/g11-hooks.ts).
  const safety =
    site.operationSurfaces && !g11GuardDisabled()
      ? createOperationGuardHost(doc, site.operationSurfaces(), (stop) => {
          if (stop) images.holdSafety(stop === true ? undefined : stop);
          images.refresh();
        })
      : undefined;
  // The room behind the UI (docs/depth-foundation.md), on sites whose adapter has a backdrop.
  const space = site.backdrop
    ? createSpaceHost(doc, site.backdrop, ports.assets, () => {
        // The room appearing or going changes where room-depth artwork goes and whether it
        // needs the guard.
        if (shown()) {
          inspect();
          images.refresh();
        }
      })
    : undefined;
  const images = createImageRenderer(
    doc,
    ports.assets,
    site.decorationAnchors ?? [],
    site.signals?.videoPlayback,
    timeline,
    safety,
    site.signals?.page,
    space ? () => space.place() : undefined,
    // The resident's front drawing waits while the character lives in the room (v18).
    space ? () => space.away() : undefined,
  );
  g11RegisterRefresh(() => images.refresh());
  let suspended = false,
    editing = false;
  // Observation starts only once settings and artwork call for it.
  safety?.setActive(false);
  // Only what is in front of the UI needs the guard (ガードは手前の物だけ): while the room is
  // shown, room-depth layers are under the content by stacking order. Without the room they are
  // drawn in front as before, guarded.
  const guarded = () => {
    // The resident living in the room is not drawn in front meanwhile: nothing of it to guard.
    const away = space?.away();
    const layers = (design?.decorations ?? []).filter((layer) => layer.id !== away);
    // While the room loads, room-only artwork waits for it ('pending'): it is never drawn in front.
    if (!space?.place()) return layers.length;
    const front = layers.filter((layer) => depthOf(layer) !== 'room').length;
    // Room-only drawing needs every root behind (src/renderers/dom/scene.ts roomPlace).
    return front || (design?.groups ?? []).some((group) => depthOf(group) !== 'room') ? layers.length : 0;
  };
  const inspect = () => {
    const active = guardWanted({ suspended, enabled: Boolean(current?.enabled), layers: guarded(), editing });
    safety?.setActive(active);
    // The depth foundation's test probe (a .work build): whether the guard observes the page.
    // (Unit tests run the source unbuilt, with stand-in documents: the label is not dropped there.)
    AROUND_SPACE_PROBE: if (doc.documentElement?.dataset)
      doc.documentElement.dataset['aroundGuard'] = active ? 'on' : 'off';
  };
  let disconnect: (() => void) | undefined;
  let current: UserSettings | undefined;
  let design: DesignDocument | undefined;
  /** 作品を表示する is ON and 緊急OFF is not holding the page. */
  const shown = () => !suspended && Boolean(current?.enabled);

  const deactivate = () => {
    safety?.setActive(false);
    space?.update(undefined);
    images.destroy();
    designRenderer.destroy();
    disconnect?.();
    disconnect = undefined;
  };

  const followPage = (change?: SitePageChange, marked?: readonly Element[]) => {
    AROUND_TEST_PAGE_CHANGE: if (legacyPageChange()) return render();
    if (!shown()) return;
    designRenderer.refresh(change, marked);
    space?.changed();
    images.refresh();
    // Text can alter geometry too; active editors compare their anchor snapshot.
    onSurfacesChanged?.();
  };

  const render = () => {
    if (!shown()) return;
    inspect();
    syncParts();
    designRenderer.update(design);
    space?.update(design?.space, residentOf(design));
    images.update(design?.decorations ?? [], design?.groups ?? [], design?.signalRules ?? []);
    onSurfacesChanged?.();
  };
  /** Viewers who never dress a part do not pay for matching its selectors on every scan. */
  let picking = false;
  const syncParts = () =>
    site.setDesignParts?.(
      new Set(
        picking
          ? (site.designTargets ?? []).map((target) => target.id)
          : (design?.rules.map((rule) => rule.target) ?? []),
      ),
    );

  const connect = () => {
    if (disconnect) return;
    // The first scan already looks for the parts the artwork uses; no second scan follows.
    syncParts();
    disconnect = site.connect(followPage);
  };

  const validateDesign = (input: DesignDocument | undefined) => {
    const next = input ? readDesign(input) : undefined;
    if (next && (next.siteId !== site.id || (next.baseThemeId !== null && next.baseThemeId !== LEGACY_BASE_THEME))) {
      throw new Error('このサイト用の作品ではないため、表示できません。');
    }
    if (next) compileDesign(next, site.designTargets ?? []);
    if (
      next?.decorations.some(
        (item) =>
          item.placement.anchor.kind === 'surface' &&
          !site.decorationAnchors?.some(
            (anchor) => item.placement.anchor.kind === 'surface' && anchor.id === item.placement.anchor.target,
          ),
      )
    ) {
      throw new Error('このサイトでは画像の配置基準を利用できません。');
    }
    return next;
  };
  return {
    safety,
    suspend(value) {
      if (value === suspended) return;
      suspended = value;
      if (value) deactivate();
      else if (current?.enabled) {
        connect();
        render();
      }
    },
    timeline,
    update(settings) {
      current = settings;
      if (!shown()) {
        deactivate();
        return;
      }
      connect();
      render();
    },
    updateDesign(input) {
      design = validateDesign(input);
      render();
    },
    skinAssetStatus: designRenderer.assetStatus,
    skinInkStatus: designRenderer.inkStatus,
    setSkinPreviews(enabled) {
      designRenderer.setPreviews(enabled);
      // The skin tool lists and highlights every part, used or not.
      if (picking === enabled) return;
      picking = enabled;
      if (shown()) syncParts();
    },
    setImageEditing(next) {
      editing = Boolean(next);
      if (shown()) inspect();
      images.edit(next);
    },
    validateDesign(input) {
      validateDesign(input);
    },
    destroy() {
      current = undefined;
      deactivate();
      space?.destroy();
      safety?.destroy();
      designRenderer.dispose();
    },
  };
}
