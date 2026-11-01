/** One markup template for the popup and the panel the in-video icon opens. It wears the WWT Studio
 * design system (settings.css). 緊急OFF and 操作チェック are added by safety-controls.ts. */
export const SETTINGS_MARKUP = `
  <header class="ww-titlebar">
    <h2>設定</h2>
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
      <p id="creator-mode-help" class="feature-description">ONのとき、拡張アイコンと動画の中のアイコンから直接エディターを開きます。設定はエディター内から開けます。</p>
    </section>
    <fieldset class="ww-group">
      <legend>作品</legend>
      <div class="control-row">
        <label for="show-artwork">作品を表示する</label>
        <div class="toggle-group">
          <output id="show-artwork-state" for="show-artwork">ON</output>
          <input id="show-artwork" type="checkbox" role="switch" aria-describedby="show-artwork-help" disabled />
        </div>
      </div>
      <p id="show-artwork-help" class="feature-description">OFFのとき、ページには作品を描きません。保存した作品は消えません。</p>
    </fieldset>
    <p><a class="backup-open" href="#" target="_blank" rel="noopener">作品と設定のバックアップ</a></p>
    <p id="save-status" class="status" role="status" aria-live="polite">設定を読み込んでいます…</p>
  </div>`;
