import { FEATURE_REGISTRY } from '../features';
import { DEFAULT_PALETTE, PALETTE_CHANNELS, PALETTE_PRESETS } from '../themes/retro/palette';

const paletteLabels = { hue: '色相', saturation: '彩度', brightness: '明るさ' };
const presetLabels = { silver: 'シルバー', lavender: 'ラベンダー', mint: 'ミント', pink: 'ピンク' };
const paletteControls = PALETTE_CHANNELS.map(
  (channel) => `
      <div class="palette-channel">
        <div class="control-row">
          <label for="palette-${channel}">${paletteLabels[channel]}</label>
          <output id="palette-${channel}-value" for="palette-${channel}">${DEFAULT_PALETTE[channel]}${channel === 'hue' ? '°' : '%'}</output>
        </div>
        <input id="palette-${channel}" data-palette-channel="${channel}" type="range" min="0" max="${channel === 'hue' ? 360 : 100}" step="1" value="${DEFAULT_PALETTE[channel]}" aria-describedby="palette-help" disabled />
      </div>`,
).join('');
const presetButtons = Object.keys(PALETTE_PRESETS)
  .map(
    (preset) => `
      <button type="button" data-palette-preset="${preset}" aria-pressed="${preset === 'silver'}" disabled>${presetLabels[preset as keyof typeof presetLabels]}</button>`,
  )
  .join('');

function escapeMarkup(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

const featureControls = FEATURE_REGISTRY.map(
  (feature) => `
      <div class="feature-control">
        <div class="control-row">
          <label for="feature-${escapeMarkup(feature.id)}">${escapeMarkup(feature.label)}</label>
          <input id="feature-${escapeMarkup(feature.id)}" type="checkbox" role="switch"
            data-feature-id="${escapeMarkup(feature.id)}"
            aria-describedby="feature-description-${escapeMarkup(feature.id)}" disabled />
        </div>
        <p id="feature-description-${escapeMarkup(feature.id)}" class="feature-description">${escapeMarkup(feature.description)}</p>
      </div>`,
).join('');

/** One markup template for the popup and the panel the in-video icon opens. It wears the WWT Studio
 * design system (settings.css): a tool surface, never the retro theme's window. */
export const SETTINGS_MARKUP = `
  <header class="ww-titlebar">
    <h2>表示設定</h2>
    <button type="button" class="close" aria-label="設定を閉じる"></button>
  </header>
  <div class="ww-editor-body">
    <section class="creator-entry">
      <div class="editor-actions">
        <button type="button" id="creator-editor-direct" class="primary" disabled>エディターを開く</button>
        <button type="button" id="creator-editor-window" disabled>別ウィンドウで開く</button>
      </div>
      <p id="creator-launch-status" class="status" role="status"></p>
      <div class="control-row">
        <label for="creator-mode">制作モード</label>
        <input id="creator-mode" type="checkbox" role="switch" aria-describedby="creator-mode-help" disabled />
      </div>
      <p id="creator-mode-help" class="feature-description">ONのとき、拡張アイコンと動画の中のアイコンから直接エディターを開きます。表示設定はエディター内から開けます。</p>
    </section>
    <fieldset class="ww-group">
      <legend>表示テーマ</legend>
      <p class="ww-theme-name">YouTube / レトロ</p>
      <div class="control-row">
        <label for="theme-enabled">テーマを使う</label>
        <div class="toggle-group">
          <output id="theme-state" for="theme-enabled">OFF</output>
          <input id="theme-enabled" type="checkbox" role="switch" disabled />
        </div>
      </div>
    </fieldset>
    <fieldset class="ww-group strength-control">
      <legend>エフェクト</legend>
      <div class="control-row">
        <label for="effect-strength">エフェクトの強さ</label>
        <output id="strength-value" for="effect-strength">60%</output>
      </div>
      <input id="effect-strength" type="range" min="0" max="100" step="1" value="60" disabled />
      <div class="range-hints" aria-hidden="true"><span>0%</span><span>100%</span></div>
    </fieldset>
    <fieldset class="ww-group palette-settings">
      <legend>自動配色</legend>
      <div class="palette-presets" role="group" aria-label="配色プリセット">${presetButtons}
      </div>
      ${paletteControls}
      <p id="palette-help" class="feature-description">UIだけの配色です。動画・画像は元の色を保ちます。配色がOFFでも値は保存されます。</p>
    </fieldset>
    <fieldset class="ww-group noise-control">
      <legend>表面の質感</legend>
      <div class="control-row">
        <label for="noise-strength">粒子の強さ</label>
        <output id="noise-strength-value" for="noise-strength">22%</output>
      </div>
      <input id="noise-strength" type="range" min="0" max="100" step="1" value="22" aria-describedby="noise-help" disabled />
      <p id="noise-help" class="feature-description">「表面のかすかな粒子」がONのときだけ、背景にごく薄い粒子を加えます。</p>
    </fieldset>
    <fieldset class="ww-group feature-settings">
      <legend>表示オプション</legend>
      ${featureControls}
    </fieldset>
    <p><a class="backup-open" href="#" target="_blank" rel="noopener">作品と設定のバックアップ</a></p>
    <p id="save-status" class="status" role="status" aria-live="polite">設定を読み込んでいます…</p>
  </div>`;
