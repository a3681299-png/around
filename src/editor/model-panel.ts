import type { EditorLayer, ImagePatch, ModelDecoration } from '../design/types';
import type { ModelSettings } from '../models/types';

/** The same controls/commands in every Studio surface. Metadata is worker-verified. */
export function createModelPanel(doc: Document, change: (patch: ImagePatch) => void, begin: () => void, end: () => void) {
  const fieldset = doc.createElement('fieldset'); fieldset.className = 'model-panel'; fieldset.hidden = true; fieldset.setAttribute('aria-label', '3Dモデル');
  fieldset.innerHTML = `<details open><summary>3Dモデルの向き</summary><div class="property row">${['X', 'Y', 'Z'].map((axis) => `<label>${axis} <input type="number" data-model="rotation${axis}" aria-label="3D回転${axis}" min="-180" max="180" step="1">°</label>`).join('')}</div></details>
    <details open><summary>3Dアニメーション</summary>
      <div class="property"><label>クリップ <select data-model="clip" aria-label="3Dクリップ"></select></label></div>
      <div class="property"><label><input type="checkbox" data-model="playing">3Dアニメーションを再生</label><label><input type="checkbox" data-model="loop">3Dループ再生</label></div>
      <div class="property row"><label>速度 <input type="number" aria-label="3D再生速度" data-model="speed" min="0.1" max="4" step="0.1">倍</label><label>フェード <input type="number" aria-label="3Dクロスフェード" data-model="crossFadeMs" min="0" max="5000" step="10">ms</label></div>
      <div class="property"><label title="ルートと骨格ルートのX/Z移動を抑え、上下動は残します。移動はWorld Runtimeが担当します。"><input type="checkbox" data-model="inPlace">In-place（素材内の水平移動を抑える）</label></div>
      <p class="model-empty" role="status"></p>
    </details>
    <details class="model-locomotion" open><summary>移動とモーション</summary>
      <div class="property"><label title="共通のマウス追従が計算した速度を使います。クリップ名は自由に選べます。"><input type="checkbox" data-model="locomotion.enabled">速度でクリップを切り替える</label></div>
      <div class="property"><label>待機 <select data-model="locomotion.idle" aria-label="待機クリップ"></select></label></div>
      <div class="property"><label>歩行 <select data-model="locomotion.walk" aria-label="歩行クリップ"></select></label></div>
      <div class="property"><label>走行 <select data-model="locomotion.run" aria-label="走行クリップ"></select></label></div>
      <div class="property row"><label>歩く速さ <input type="number" data-model="locomotion.walkSpeed" aria-label="歩行しきい値" min="0.1" max="10000" step="0.1">px/s</label><label>走る速さ <input type="number" data-model="locomotion.runSpeed" aria-label="走行しきい値" min="0.1" max="10000" step="0.1">px/s</label></div>
      <div class="property"><label><input type="checkbox" data-model="locomotion.faceMovement">3Dで進む向きに回転</label></div>
      <div class="property"><label>正面の補正 <input type="number" data-model="locomotion.forwardDeg" aria-label="モデル正面の補正" min="-180" max="180" step="1">°</label></div>
    </details>
    <details class="model-look"><summary>頭・首の視線</summary>
      <div class="property"><label><input type="checkbox" data-model="look.enabled">カーソルへ顔を向ける</label></div>
      <div class="property"><label>ボーン <select data-model="look.bone" aria-label="視線ボーン"></select></label></div>
      <div class="property row"><label>左右 <input type="number" data-model="look.yawLimit" aria-label="視線の左右制限" min="0" max="90" step="1">°</label><label>上下 <input type="number" data-model="look.pitchLimit" aria-label="視線の上下制限" min="0" max="80" step="1">°</label></div>
      <div class="property"><label>遅延 <input type="number" data-model="look.lagMs" aria-label="視線の遅延" min="0" max="5000" step="10">ms</label></div>
      <p class="model-help">ボーンのローカルYが上、Zが正面のリグ向け。アニメーションのポーズに加算します。モデルに合わない場合はOFFにしてください。</p>
    </details>`;
  let current: ModelDecoration | undefined;
  fieldset.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement, path = input.dataset.model, key = path?.split('.')[0] as keyof ModelSettings | undefined;
    if (!key || !current || !input.checkValidity() || input.value === '') return;
    const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value === 'none' ? null : Number(input.value);
    const child = path?.split('.')[1];
    change({ model: { [key]: child ? { [child]: value } : value } });
  });
  fieldset.querySelectorAll('input[type="number"]').forEach((input) => { input.addEventListener('focus', begin); input.addEventListener('blur', () => end()); });
  return { fieldset, render(layer: EditorLayer | undefined) {
    fieldset.hidden = layer?.kind !== 'model3d'; current = layer?.kind === 'model3d' ? layer : undefined; if (!current) return;
    const model = current.model;
    for (const clip of fieldset.querySelectorAll<HTMLSelectElement>('select')) {
      if (clip.dataset.model === 'look.bone') {
        const signature = JSON.stringify(current.source.bones); if (clip.dataset.source === signature) continue; clip.dataset.source = signature; clip.replaceChildren();
        const empty = doc.createElement('option'); empty.value = 'none'; empty.textContent = '頭や首のボーンを選択'; clip.append(empty);
        current.source.bones.forEach((b) => { const option = doc.createElement('option'); option.value = String(b.node); option.textContent = `${b.name || 'Bone'} · #${b.node}`; clip.append(option); }); continue;
      }
      const signature = JSON.stringify(current.source.clips); if (clip.dataset.source === signature) continue;
      clip.dataset.source = signature; clip.replaceChildren(); const empty = doc.createElement('option'); empty.value = 'none'; empty.textContent = clip.dataset.model === 'clip' ? '静止ポーズ' : '基本クリップを使う'; clip.append(empty);
      current.source.clips.forEach((c, i) => { const option = doc.createElement('option'); option.value = String(i); option.textContent = `${c.name || `Clip ${i + 1}`} · ${c.duration.toFixed(2)}s`; clip.append(option); });
    }
    fieldset.querySelector<HTMLSelectElement>('[data-model="clip"]')!.disabled = model.locomotion.enabled;
    fieldset.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-model]').forEach((input) => {
      if ((fieldset.getRootNode() as ShadowRoot).activeElement === input && input.tagName === 'INPUT' && (input as HTMLInputElement).type === 'number') return;
      const [key, child] = input.dataset.model!.split('.'), parent = model[key as keyof ModelSettings];
      const value = child ? (parent as unknown as Record<string, unknown>)[child] : parent; if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value); else input.value = value === null ? 'none' : String(value);
    });
    fieldset.querySelector('.model-empty')!.textContent = current.source.clips.length ? '' : 'このGLBにはアニメーションクリップがありません。';
  } };
}
