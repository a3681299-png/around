import { FEATURE_REGISTRY } from '../features';
import { DEFAULT_PALETTE, PALETTE_CHANNELS, PALETTE_PRESETS } from '../themes/retro/palette';

const paletteLabels = { hue: '色相 / Hue', saturation: '彩度 / Saturation', brightness: '明るさ / Brightness' };
const presetLabels = { silver: 'Silver', lavender: 'Lavender', mint: 'Mint', pink: 'Pink' };
const paletteControls = PALETTE_CHANNELS.map((channel) => `
      <div class="palette-channel">
        <div class="control-row">
          <label for="palette-${channel}">${paletteLabels[channel]}</label>
          <output id="palette-${channel}-value" for="palette-${channel}">${DEFAULT_PALETTE[channel]}${channel === 'hue' ? '°' : '%'}</output>
        </div>
        <input id="palette-${channel}" data-palette-channel="${channel}" type="range" min="0" max="${channel === 'hue' ? 360 : 100}" step="1" value="${DEFAULT_PALETTE[channel]}" aria-describedby="palette-help" disabled />
      </div>`).join('');
const presetButtons = Object.keys(PALETTE_PRESETS).map((preset) => `
      <button type="button" data-palette-preset="${preset}" aria-pressed="${preset === 'silver'}" disabled>${presetLabels[preset as keyof typeof presetLabels]}</button>`).join('');

function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

const featureControls = FEATURE_REGISTRY.map((feature) => `
      <div class="feature-control">
        <div class="control-row">
          <label for="feature-${escapeMarkup(feature.id)}">${escapeMarkup(feature.label)}</label>
          <input id="feature-${escapeMarkup(feature.id)}" type="checkbox" role="switch"
            data-feature-id="${escapeMarkup(feature.id)}"
            aria-describedby="feature-description-${escapeMarkup(feature.id)}" disabled />
        </div>
        <p id="feature-description-${escapeMarkup(feature.id)}" class="feature-description">${escapeMarkup(feature.description)}</p>
      </div>`).join('');

/** One markup template for both editors; theme-specific visuals live in themes/. */
export const SETTINGS_MARKUP = `
  <header class="ww-titlebar">
    <span class="ww-app-icon" aria-hidden="true">▶</span>
    <h2>Theme settings.exe</h2>
    <button type="button" class="close" aria-label="設定を閉じる">×</button>
  </header>
  <div class="ww-editor-menu">
    <button type="button" data-settings-focus="theme-enabled">テーマ(T)</button>
    <button type="button" data-settings-focus="effect-strength">効果(E)</button>
    <span>retro</span>
  </div>
  <div class="ww-editor-body">
    <fieldset class="ww-group">
      <legend>表示テーマ</legend>
      <p class="ww-theme-name">YouTube / retro</p>
      <div class="control-row">
        <label for="theme-enabled">Theme ON / OFF</label>
        <div class="toggle-group">
          <output id="theme-state" for="theme-enabled">OFF</output>
          <input id="theme-enabled" type="checkbox" role="switch" disabled />
        </div>
      </div>
    </fieldset>
    <fieldset class="ww-group strength-control">
      <legend>エフェクト</legend>
      <div class="control-row">
        <label for="effect-strength">Effect Strength</label>
        <output id="strength-value" for="effect-strength">60%</output>
      </div>
      <input id="effect-strength" type="range" min="0" max="100" step="1" value="60" disabled />
      <div class="range-hints" aria-hidden="true"><span>0%</span><span>100%</span></div>
    </fieldset>
    <fieldset class="ww-group palette-settings">
      <legend>自動配色 / UI palette</legend>
      <div class="palette-presets" role="group" aria-label="配色プリセット">${presetButtons}
      </div>
      ${paletteControls}
      <p id="palette-help" class="feature-description">UIだけの配色です。動画・画像は元の色を保ちます。配色がOFFでも値は保存されます。</p>
    </fieldset>
    <fieldset class="ww-group noise-control">
      <legend>表面の質感 / Noise</legend>
      <div class="control-row">
        <label for="noise-strength">Noise Strength</label>
        <output id="noise-strength-value" for="noise-strength">22%</output>
      </div>
      <input id="noise-strength" type="range" min="0" max="100" step="1" value="22" aria-describedby="noise-help" disabled />
      <p id="noise-help" class="feature-description">Faint surface grainがONのときだけ、背景にごく薄い粒子を加えます。</p>
    </fieldset>
    <fieldset class="ww-group feature-settings">
      <legend>表示オプション</legend>
      ${featureControls}
    </fieldset>
    <p id="save-status" class="status" role="status" aria-live="polite">設定を読み込んでいます…</p>
  </div>`;

