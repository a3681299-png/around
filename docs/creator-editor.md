# 動画カードのビジュアル編集の検証

`codex/creator-editor-spike` 用の実験機能。通常の拡張機能の完成作業は `codex/extension-completion` で進める。worktreeごとに `dist` を生成し、実験用Chromeプロファイルに読み込む。

## 操作

1. 実験worktreeで `npm run build` を実行し、その `dist` をChromeへ読み込む。
2. YouTubeを再読み込みし、PopupでテーマをON、強さを1%以上にする。
3. Popupの「カードをデザイン（実験）」を押す。
4. YouTubeの動画カードをクリックして選択する。編集中のカードクリックは動画を開かず、選択操作になる。
5. プロパティパネルで背景色、枠線の色と太さ、角丸を変更する。チェックを外した項目はテーマの値に戻る。
6. 「保存」で各タブへ反映する。「変更を破棄」で最新の保存値に戻る。×またはEscで終了すると、未保存の変更を破棄する。

クリックしたカードは編集対象の種類を選ぶための見本であり、同じ種類の通常動画カード全体へ適用する。1枚だけに固有のデザインは保存しない。パネルがカードに重なる場合は「パネルを左へ／右へ」で移動できる。

通常モードには選択用のイベント監視、パネル、選択表示を残さない。動画クリックは従来どおり動作する。テーマOFF／強さ0%では編集を終了し、デザインCSS、surface、選択属性、テーマの変数、追加機能を撤去する。保存値は維持し、再びONにすると復元する。

## 責務

- `sites/youtube-cards.ts`: 通常動画の対象識別。ホーム、検索結果、おすすめの旧／新コンポーネントを扱う。Shorts、チャンネル、プレイリスト、案内、識別できる広告枠は除外する。
- `sites/youtube.ts`: `data-ww-surface~="video-card"` を付与する。SPA、リンクの遅延追加・再利用、削除に追従し、入れ子のカードを重複して編集対象にしない。
- `design/types.ts` / `schema.ts`: バージョン付きのデータ形式と検証。任意CSS、セレクタ、JavaScript、外部URLを受け付けない。
- `design/renderer.ts`: 登録済みsurfaceと検証済み値からCSSを生成する。背景は既存グラデーションを置き換え、枠線は寸法を変えない内側の影で描く。角丸はカードの外枠に適用し、画像の寸法や操作部分のクリップは変更しない。
- `editor/controller.ts`: 選択、タブ内のdraft、保存、破棄、他タブ更新との調整。サイト固有のセレクタやイベント名を持たない。
- `editor/panel.ts` / `panel.css`: Shadow DOM内のプロパティUI。サイトのCSSとテーマCSSから分離する。
- `storage/designs.ts`: デザイン専用の読込、保存、変更通知。既存設定のキーや自動保存処理は変更しない。
- `themes/controller.ts`: 基底テーマとデザインの適用・撤去をまとめる。retro固有の変数は `themes/retro/variables.ts` で生成する。

適用順は基底テーマ、保存済みデザイン、編集中draft。CSSの強さは全体ON／OFFと0%の境界に従うが、入力した色やpx値は強さによって補間しない。

## 保存形式

保存キーはサイト別の `webWorldThemes.design.youtube`。初期検証は1サイト1文書とし、テーマ一覧や素材ライブラリはまだ作らない。

```json
{
  "schemaVersion": 1,
  "id": "youtube-custom",
  "siteId": "youtube",
  "baseThemeId": "retro",
  "rules": [
    {
      "kind": "surface-style",
      "target": "video-card",
      "style": {
        "backgroundColor": "#ebdfff",
        "border": { "color": "#443366", "widthPx": 5 },
        "borderRadiusPx": 14
      }
    }
  ]
}
```

色は6桁HEX、枠線は0〜12px、角丸は0〜48pxの整数。未指定の項目は基底の見た目を維持する。未知のバージョンや未対応の対象を読み込んだ場合は編集を止め、保存データを上書きしない。

`baseThemeId` は任意の組み込みテーマIDを表す。`null` は組み込みテーマを使わず、ネイティブのYouTubeにデザインだけを適用する。今回のUIはretroから開始するが、文書とRendererはretroに依存せず、`null` の描画・編集・保存も自動テストする。

画像素材、自由配置、アニメーションは、将来別の `kind` として追加する。素材参照と配置データは文書で表現し、それぞれのRendererへ渡す。画像の保存方法、タイムライン、複数テーマ管理、JSONの入出力UIは今回の範囲外。

## 保存と複数タブ

未保存のプレビューは編集しているタブだけに適用する。保存済みの変更は `storage.onChanged` で各タブに反映する。別タブの保存が届いたとき、編集中のdraftは保持し、上書きになることを表示する。「変更を破棄」は最新の保存値へ戻る。

同時保存は最後の書込が優先される。文書単位の保存で、排他ロックや共同編集のマージは実装しない。保存に失敗した場合はdraftを保持し、再試行できる。

## 権限と検証

Manifestの権限は従来の `storage` のみ。PopupはアクティブタブのIDを取得して既存content scriptへメッセージを送る。タブURLの読取、動的コード注入、バックグラウンドService Worker、新しい通信先は追加しない。[Chrome Tabs APIの権限説明](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions)

`tests/design.spec.ts` は文書、CSS生成、保存、初期読込と変更通知の競合を検証する。`tests/creator-editor.spec.ts` は実拡張機能、独立したChromiumプロファイル、実Chrome StorageとローカルのYouTube相当HTMLを使う。実YouTubeの最新DOMやログイン状態の確認とは分ける。

専用worktreeではテスト用ブラウザーを `PLAYWRIGHT_BROWSERS_PATH`、短いプロファイル保存先を `WW_TEST_PROFILE_ROOT` で指定できる。通常のChromeプロファイルを指定しない。
