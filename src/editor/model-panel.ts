import type { EditorLayer, ImagePatch, ModelDecoration } from '../design/types';
import type { ModelSettings } from '../models/types';
import { DEFAULT_CHARACTER_PERSONALITY, modelClips, motionUsable } from '../characters/settings';
import { classifyBody, type BodyReason } from '../characters/humanoid';
import { parseMotionManifest, type MotionLabel } from '../characters/manifest';

export interface MotionImportOptions {
  import(
    files: readonly File[],
    layer: string,
    labels: readonly [string, MotionLabel][],
    origin: 'standard' | 'character',
  ): void;
}
const REASONS: Record<BodyReason, string> = { head: '頭が大きい', legs: '足が短い', hips: '腰が低い' };
const ROLES: Record<string, string> = {
  idle: '待機',
  gesture: '身ぶり',
  react: '反応',
  dance: '踊り',
  move: '移動',
  sit: '座る',
  edge: '縁',
};

/** The same controls/commands in every Studio surface. Metadata is worker-verified. */
export function createModelPanel(
  doc: Document,
  change: (patch: ImagePatch) => void,
  begin: () => void,
  end: () => void,
  motions?: MotionImportOptions,
) {
  const fieldset = doc.createElement('fieldset');
  fieldset.className = 'model-panel';
  fieldset.hidden = true;
  fieldset.setAttribute('aria-label', '3Dモデル');
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
    </details>
    <details class="vrm-options" open><summary>VRM</summary><p class="vrm-capabilities model-help"></p>
      <div class="property"><label><input type="checkbox" data-model="vrm.lookAt">VRMの眼球・LookAtを使う</label></div>
      <div class="property"><label><input type="checkbox" data-model="vrm.headFollow">Humanoidの頭も追従</label></div>
      <div class="property"><label><input type="checkbox" data-model="vrm.springBone">揺れ物（SpringBone）</label></div>
      <div class="property"><label>表情 <select class="vrm-expression" aria-label="VRM表情"></select></label></div>
      <div class="property"><label>強さ <input type="number" class="vrm-weight" aria-label="VRM表情の強さ" min="0" max="1" step="0.05"></label></div>
    </details>
    <details class="character-options" open><summary>キャラの動作</summary>
      <p class="character-body model-help" role="status"></p>
      <div class="property"><label>標準の動作 <select class="character-standard" aria-label="標準の動作"><option value="auto">体型に合わせる</option><option value="on">使う</option><option value="off">使わない</option></select></label></div>
      <div class="property"><label><input type="checkbox" class="character-computed" aria-label="計算の動き"> 計算の動き（呼吸・まばたき・見回すなど）</label></div>
      <div class="property"><label><input type="checkbox" class="character-autonomy" aria-label="自律"> 自律（カーソルから逃げる・寄ってくる・うとうとする）</label></div>
      <div class="property character-personality"><label>臆病さ <input type="range" class="character-trait" data-trait="shyness" aria-label="臆病さ" min="0" max="100" step="1"></label><label>好奇心 <input type="range" class="character-trait" data-trait="curiosity" aria-label="好奇心" min="0" max="100" step="1"></label><label>眠りやすさ <input type="range" class="character-trait" data-trait="sleepiness" aria-label="眠りやすさ" min="0" max="100" step="1"></label></div>
      <ul class="character-motions" aria-label="キャラの動作"></ul>
      <div class="property row character-import"><label>種類 <select class="character-origin" aria-label="追加する動作の種類"><option value="character">このキャラ専用</option><option value="standard">どのモデルにも当てられる版</option></select></label><button type="button" class="character-add">動作を追加</button></div>
      <input class="character-file" type="file" accept=".vrma,.json,application/json" multiple hidden aria-label="動作（.vrma）とmanifest.jsonを追加">
      <p class="character-status model-help" role="status"></p>
      <p class="model-help">.vrma と、あれば manifest.json をまとめて選びます。長さや腰の移動は、ファイルから測り直します。</p>
    </details>`;
  let current: ModelDecoration | undefined;
  const characterFile = fieldset.querySelector<HTMLInputElement>('.character-file')!,
    characterStatus = fieldset.querySelector<HTMLElement>('.character-status')!;
  fieldset.querySelector<HTMLElement>('.character-import')!.hidden = !motions;
  fieldset.querySelector('.character-add')!.addEventListener('click', () => characterFile.click());
  characterFile.addEventListener('change', () => {
    const files = [...(characterFile.files ?? [])],
      layer = current?.id;
    characterFile.value = '';
    if (!motions || !layer) return;
    const manifest = files.find((f) => f.name.toLowerCase().endsWith('.json')),
      vrma = files.filter((f) => f.name.toLowerCase().endsWith('.vrma'));
    const origin = fieldset.querySelector<HTMLSelectElement>('.character-origin')!.value as 'standard' | 'character';
    if (!vrma.length) {
      characterStatus.textContent = '.vrma を選んでください。';
      return;
    }
    void (manifest ? manifest.text() : Promise.resolve(undefined))
      .then((text) => {
        const labels = text === undefined ? new Map<string, MotionLabel>() : parseMotionManifest(text);
        characterStatus.textContent = `${vrma.length}個の動作を読み込みます…`;
        motions.import(vrma, layer, [...labels], origin);
      })
      .catch((error: unknown) => {
        characterStatus.textContent = error instanceof Error ? error.message : 'manifest.json を読めません。';
      });
  });
  fieldset.querySelector('.character-standard')!.addEventListener('change', (event) => {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value as 'auto' | 'on' | 'off';
    if (current?.character) change({ character: { standardMotions: value } });
  });
  for (const [selector, key] of [
    ['.character-computed', 'computedMotion'],
    ['.character-autonomy', 'autonomy'],
  ] as const)
    fieldset.querySelector(selector)!.addEventListener('change', (event) => {
      event.stopPropagation();
      if (current?.character) change({ character: { [key]: (event.target as HTMLInputElement).checked } });
    });
  fieldset.querySelector('.character-personality')!.addEventListener('change', (event) => {
    event.stopPropagation();
    if (!current?.character) return;
    const value = (trait: string) =>
      Number(fieldset.querySelector<HTMLInputElement>(`.character-trait[data-trait="${trait}"]`)!.value) / 100;
    change({
      character: {
        personality: { shyness: value('shyness'), curiosity: value('curiosity'), sleepiness: value('sleepiness') },
      },
    });
  });
  fieldset.querySelector('.character-motions')!.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-remove]');
    if (!button || !current?.character) return;
    change({
      character: { keep: current.character.motions.map((m) => m.id).filter((id) => id !== button.dataset.remove) },
    });
  });
  function renderCharacter(layer: ModelDecoration) {
    const body = layer.source.vrm?.body,
      section = fieldset.querySelector<HTMLElement>('.character-options')!;
    section.hidden = !layer.source.vrm;
    if (!layer.source.vrm) return;
    const verdict = body && classifyBody(body);
    fieldset.querySelector('.character-body')!.textContent = body
      ? `身長 ${body.height.toFixed(2)}m · ${body.headsTall.toFixed(1)}頭身 · 足 ${Math.round(body.legRatio * 100)}% → ` +
        (verdict!.stage === 2
          ? '標準の動作を使える体型です。'
          : `標準の動作が崩れやすい体型です（${verdict!.reasons.map((r) => REASONS[r]).join('・')}）。このキャラ専用の動作と、計算の動きを使います。`)
      : '体型を測れていません。読み込み直すと測ります。それまでは、このキャラ専用の動作だけを使います。';
    const select = fieldset.querySelector<HTMLSelectElement>('.character-standard')!;
    select.value = layer.character?.standardMotions ?? 'auto';
    select.disabled = !layer.character;
    // v15: absent means computed motion on and autonomy off (older artwork keeps its behaviour).
    const computed = fieldset.querySelector<HTMLInputElement>('.character-computed')!,
      autonomy = fieldset.querySelector<HTMLInputElement>('.character-autonomy')!;
    computed.checked = layer.character?.computedMotion !== false;
    autonomy.checked = Boolean(layer.character?.autonomy);
    computed.disabled = autonomy.disabled = !layer.character;
    const personality = layer.character?.personality ?? DEFAULT_CHARACTER_PERSONALITY;
    for (const input of fieldset.querySelectorAll<HTMLInputElement>('.character-trait')) {
      input.value = String(Math.round(personality[input.dataset['trait'] as keyof typeof personality] * 100));
      input.disabled = !layer.character || !layer.character.autonomy;
    }
    const list = fieldset.querySelector<HTMLUListElement>('.character-motions')!;
    list.replaceChildren(
      ...(layer.character?.motions ?? []).map((motion, index) => {
        const item = doc.createElement('li'),
          remove = doc.createElement('button');
        const usable = motionUsable(layer.character!, index, body);
        item.textContent =
          `${motion.id} · ${ROLES[motion.role]} · ${motion.source.duration.toFixed(2)}s · ` +
          `${motion.origin === 'character' ? '専用' : '標準'}${usable ? '' : '（今は使わない）'} `;
        remove.type = 'button';
        remove.dataset.remove = motion.id;
        remove.textContent = '外す';
        remove.setAttribute('aria-label', `${motion.id}を外す`);
        item.append(remove);
        return item;
      }),
    );
  }
  fieldset.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement,
      path = input.dataset.model,
      key = path?.split('.')[0] as keyof ModelSettings | undefined;
    if (input.classList.contains('vrm-expression')) {
      renderWeight();
      return;
    }
    if (input.classList.contains('vrm-weight') && current?.model.vrm && input.value !== '' && input.checkValidity()) {
      const name = fieldset.querySelector<HTMLSelectElement>('.vrm-expression')!.value;
      if (name) change({ model: { vrm: { expressions: { [name]: Number(input.value) } } } });
      return;
    }
    if (!key || !current || !input.checkValidity() || input.value === '') return;
    const value =
      input instanceof HTMLInputElement && input.type === 'checkbox'
        ? input.checked
        : input.value === 'none'
          ? null
          : Number(input.value);
    const child = path?.split('.')[1];
    change({ model: { [key]: child ? { [child]: value } : value } });
  });
  fieldset.querySelectorAll('input[type="number"]').forEach((input) => {
    input.addEventListener('focus', begin);
    input.addEventListener('blur', () => end());
  });
  function renderWeight() {
    const select = fieldset.querySelector<HTMLSelectElement>('.vrm-expression')!,
      weight = fieldset.querySelector<HTMLInputElement>('.vrm-weight')!;
    weight.disabled = !select.value;
    weight.value = String(current?.model.vrm?.expressions[select.value] ?? 0);
  }
  return {
    fieldset,
    render(layer: EditorLayer | undefined) {
      fieldset.hidden = layer?.kind !== 'model3d';
      current = layer?.kind === 'model3d' ? layer : undefined;
      if (!current) return;
      const model = current.model;
      const vrm = current.source.vrm;
      fieldset.querySelector<HTMLElement>('.vrm-options')!.hidden = !vrm;
      fieldset.querySelector<HTMLSelectElement>('[data-model="look.bone"]')!.disabled = Boolean(vrm);
      fieldset.querySelector('.model-help')!.textContent = vrm
        ? 'Humanoidの頭を自動選択。視線の角度・遅延はWorld Runtimeで制御します。'
        : 'ボーンのローカルYが上、Zが正面のリグ向け。アニメーションのポーズに加算します。モデルに合わない場合はOFFにしてください。';
      if (vrm) {
        fieldset.querySelector('.vrm-capabilities')!.textContent =
          `VRM ${vrm.version} · Humanoid ${vrm.humanoid.length} · ${vrm.mtoon ? 'MToon' : '標準材質'}`;
        const select = fieldset.querySelector<HTMLSelectElement>('.vrm-expression')!,
          signature = JSON.stringify(vrm.expressions);
        if (select.dataset.source !== signature) {
          const previous = select.value;
          select.dataset.source = signature;
          select.replaceChildren();
          for (const name of vrm.expressions) {
            const option = doc.createElement('option');
            option.value = name;
            option.textContent = name;
            select.append(option);
          }
          if (vrm.expressions.includes(previous)) select.value = previous;
        }
        if ((fieldset.getRootNode() as ShadowRoot).activeElement !== fieldset.querySelector('.vrm-weight'))
          renderWeight();
        fieldset.querySelector<HTMLInputElement>('[data-model="vrm.lookAt"]')!.disabled = !vrm.lookAt;
        fieldset.querySelector<HTMLInputElement>('[data-model="vrm.springBone"]')!.disabled = !vrm.springBone;
      }
      for (const clip of fieldset.querySelectorAll<HTMLSelectElement>('select[data-model]')) {
        if (clip.dataset.model === 'look.bone') {
          const signature = JSON.stringify(current.source.bones);
          if (clip.dataset.source === signature) continue;
          clip.dataset.source = signature;
          clip.replaceChildren();
          const empty = doc.createElement('option');
          empty.value = 'none';
          empty.textContent = '頭や首のボーンを選択';
          clip.append(empty);
          current.source.bones.forEach((b) => {
            const option = doc.createElement('option');
            option.value = String(b.node);
            option.textContent = `${b.name || 'Bone'} · #${b.node}`;
            clip.append(option);
          });
          continue;
        }
        // With a character, the clip list is its motions (and stage decides which may play).
        const clips = modelClips(current),
          body = current.source.vrm?.body,
          usable = clips.map((_, i) => !current!.character || motionUsable(current!.character, i, body));
        const signature = JSON.stringify([clips, usable]);
        if (clip.dataset.source === signature) continue;
        clip.dataset.source = signature;
        clip.replaceChildren();
        const empty = doc.createElement('option');
        empty.value = 'none';
        empty.textContent = clip.dataset.model === 'clip' ? '静止ポーズ' : '基本クリップを使う';
        clip.append(empty);
        clips.forEach((c, i) => {
          const option = doc.createElement('option');
          option.value = String(i);
          option.textContent = `${c.name || `Clip ${i + 1}`} · ${c.duration.toFixed(2)}s${usable[i] ? '' : '（今は使わない）'}`;
          clip.append(option);
        });
      }
      renderCharacter(current);
      fieldset.querySelector<HTMLSelectElement>('[data-model="clip"]')!.disabled = model.locomotion.enabled;
      fieldset.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-model]').forEach((input) => {
        if (
          (fieldset.getRootNode() as ShadowRoot).activeElement === input &&
          input.tagName === 'INPUT' &&
          (input as HTMLInputElement).type === 'number'
        )
          return;
        const [key, child] = input.dataset.model!.split('.'),
          parent = model[key as keyof ModelSettings];
        const value = child ? (parent as unknown as Record<string, unknown> | undefined)?.[child] : parent;
        if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = value === null ? 'none' : String(value);
      });
      fieldset.querySelector('.model-empty')!.textContent = modelClips(current).length
        ? ''
        : vrm
          ? '内蔵クリップなし。視線・表情・揺れ物は利用できます。'
          : 'このGLBにはアニメーションクリップがありません。';
    },
  };
}
