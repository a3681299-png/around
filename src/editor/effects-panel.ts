import type { ImagePatch, LayerState } from '../design/types';
import { defaultCircleMask, EFFECT_LIMITS, type MaskBinding } from '../effects/types';

/** Small binding presets today; the saved structure is not tied to this form. */
export function createEffectsPanel(doc: Document, change: (patch: ImagePatch) => void) {
  const fieldset = doc.createElement('fieldset');
  fieldset.setAttribute('aria-label', 'マスクと振る舞い');
  fieldset.innerHTML = `
    <details class="effects-section" open><summary>光とマスク</summary>
    <div class="property"><label><input type="checkbox" data-effect="enabled">円形マスクを使う</label></div>
    <div class="mask-settings" hidden>
      <div class="property"><label>光の半径 <input type="number" aria-label="光の半径" data-effect="radiusPx" min="1" max="${EFFECT_LIMITS.radius}" step="1" required>px</label></div>
      <div class="property"><label>境界のぼかし <input type="number" aria-label="境界のぼかし" data-effect="featherPx" min="0" max="${EFFECT_LIMITS.feather}" step="1" required>px</label></div>
      <div class="property"><label>表示強度 <output class="mask-value"></output><input type="range" aria-label="マスクの表示強度" data-effect="intensity" min="0" max="100" step="1"></label></div>
    </div></details>
    <details class="behavior-section" open><summary>振る舞い</summary>
    <p class="hint behavior-empty">円形マスクを有効にすると、マウスや動画に連動できます。</p>
    <div class="binding-settings" hidden>
      <div class="property"><label><input type="checkbox" data-effect="pointer">マウスに追従</label></div>
      <p class="hint">マウス位置 → レイヤー内の座標 → マスクの中心</p>
      <div class="property"><label><input type="checkbox" data-effect="video">動画の一時停止で隠す</label></div>
      <div class="property"><label>フェード時間 <input type="number" aria-label="マスクのフェード時間" data-effect="fadeMs" min="0" max="${EFFECT_LIMITS.fadeMs}" step="1" required>ms</label></div>
      <p class="hint">動画の再生状態 → フェード → 表示強度。プレイヤーのないページでは隠します。</p>
    </div></details>`;
  const get = (key: string) => fieldset.querySelector<HTMLInputElement>(`[data-effect="${key}"]`)!;
  let current: LayerState | undefined;
  fieldset.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!current || !input.dataset.effect || !input.checkValidity()) return;
    const mask = current.effects?.[0] ?? defaultCircleMask();
    const key = input.dataset.effect;
    const value =
      key === 'enabled'
        ? { enabled: input.checked }
        : key === 'intensity'
          ? { intensity: Number(input.value) / 100 }
          : ['radiusPx', 'featherPx'].includes(key)
            ? { [key]: Number(input.value) }
            : {};
    let bindings = [...mask.bindings];
    if (key === 'pointer')
      bindings = [
        ...bindings.filter((binding) => binding.source !== 'pointer.position'),
        ...(input.checked
          ? [
              {
                source: 'pointer.position',
                transform: { kind: 'layer-local' },
                target: 'mask.center',
              } satisfies MaskBinding,
            ]
          : []),
      ];
    if (key === 'video')
      bindings = [
        ...bindings.filter((binding) => binding.source !== 'video.playing'),
        ...(input.checked
          ? [
              {
                source: 'video.playing',
                transform: { kind: 'boolean-gate', fadeMs: 350 },
                target: 'mask.intensity',
              } satisfies MaskBinding,
            ]
          : []),
      ];
    if (key === 'fadeMs')
      bindings = bindings.map((binding) =>
        binding.source === 'video.playing'
          ? { ...binding, transform: { kind: 'boolean-gate', fadeMs: Number(input.value) } }
          : binding,
      );
    const effects = [{ ...mask, ...value, bindings }];
    // Preserve consecutive form edits while a remote Host acknowledges them.
    current = { ...current, effects };
    change({ effects });
  });
  return {
    fieldset,
    render(layer: LayerState | undefined) {
      current = layer;
      const mask = layer?.effects?.[0];
      get('enabled').checked = mask?.enabled ?? false;
      fieldset.querySelector<HTMLElement>('.mask-settings')!.hidden = !mask?.enabled;
      fieldset.querySelector<HTMLElement>('.binding-settings')!.hidden = !mask?.enabled;
      fieldset.querySelector<HTMLElement>('.behavior-empty')!.hidden = Boolean(mask?.enabled);
      if (!mask) return;
      get('radiusPx').value = String(mask.radiusPx);
      get('featherPx').value = String(mask.featherPx);
      get('intensity').value = String(Math.round(mask.intensity * 100));
      fieldset.querySelector<HTMLOutputElement>('.mask-value')!.value = `${Math.round(mask.intensity * 100)}%`;
      get('pointer').checked = mask.bindings.some((binding) => binding.source === 'pointer.position');
      const gate = mask.bindings.find((binding) => binding.source === 'video.playing');
      get('video').checked = Boolean(gate);
      get('fadeMs').value = String(gate?.transform.fadeMs ?? 350);
      get('fadeMs').disabled = !gate;
    },
  };
}
