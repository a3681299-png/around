import type { ImagePatch, LayerState } from '../design/types';
import { defaultFollowMotion, type FollowMotion } from '../signals/motion';

/** Shared by the quick editor, side panel and independent Studio. */
export function createMotionPanel(doc: Document, change: (patch: ImagePatch) => void, begin: () => void, end: () => void) {
  const fieldset = doc.createElement('fieldset'); fieldset.className = 'motion-panel'; fieldset.setAttribute('aria-label', 'レイヤーのモーション');
  fieldset.innerHTML = `<details class="motion-section" open><summary>モーション</summary>
    <div class="property"><label><input type="checkbox" data-motion="enabled" aria-label="レイヤーのマウス追跡">マウスを追いかける</label></div>
    <div class="motion-settings" hidden>
    <div class="property"><label>動き<select data-motion="mode" aria-label="追従方式"><option value="pursuit">加速して追いかける</option><option value="smooth">なめらかに遅れて追従</option><option value="direct">直接追従</option></select></label></div>
    <div class="property row"><label>遅延<input type="number" data-motion="lagMs" aria-label="追従の遅延" min="0" max="5000" step="10">ms</label><label>停止距離<input type="number" data-motion="stopRadius" aria-label="マウスとの停止距離" min="0" max="4096" step="1">px</label></div>
    <div class="motion-pursuit"><div class="property"><label>最高速度<input type="number" data-motion="maxSpeed" aria-label="追従の最高速度" min="1" max="10000" step="1">px/s</label></div>
    <div class="property row"><label>加速<input type="number" data-motion="acceleration" aria-label="追従の加速度" min="1" max="50000" step="1">px/s²</label><label>減速<input type="number" data-motion="deceleration" aria-label="追従の減速度" min="1" max="50000" step="1">px/s²</label></div></div>
    <div class="property"><label><input type="checkbox" data-motion="orientToMovement" aria-label="移動方向へ回転">移動方向へ回転</label><label>向きの補正<input type="number" data-motion="rotationOffsetDeg" aria-label="移動方向の角度補正" min="-180" max="180" step="1">°</label></div>
    <p class="hint">位置と角度の基本値を残して動かします。動きを減らす設定では追従を止めます。</p>
    </div></details>`;
  let current: LayerState | undefined;
  const render = (layer: LayerState | undefined) => {
    current = layer; const config = layer?.motion ?? { ...defaultFollowMotion(), enabled: false };
    fieldset.querySelector<HTMLElement>('.motion-settings')!.hidden = !config.enabled;
    fieldset.querySelector<HTMLElement>('.motion-pursuit')!.hidden = config.mode !== 'pursuit';
    for (const input of fieldset.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-motion]')) {
      const key = input.dataset.motion as keyof FollowMotion;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(config[key]);
      else if (input.getRootNode() !== doc || doc.activeElement !== input) { if ((input.getRootNode() as ShadowRoot).activeElement !== input) input.value = String(config[key]); }
      input.disabled = key === 'lagMs' && config.mode === 'direct' || key === 'rotationOffsetDeg' && !config.orientToMovement;
    }
  };
  fieldset.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement, key = input.dataset.motion as keyof FollowMotion;
    if (!current || !key || !input.checkValidity()) return;
    const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input instanceof HTMLInputElement ? input.valueAsNumber : input.value;
    const motion = { ...current.motion ?? defaultFollowMotion(), [key]: value } as FollowMotion;
    change({ motion }); render({ ...current, motion });
  });
  for (const input of fieldset.querySelectorAll('input[type="number"]')) { input.addEventListener('focus', () => begin()); input.addEventListener('blur', () => end()); }
  return { fieldset, render };
}
