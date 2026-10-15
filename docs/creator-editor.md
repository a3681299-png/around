# 動画カードと画像素材のビジュアル編集

`codex/creator-editor-spike` 用の実験機能。通常の拡張機能の完成作業は `codex/extension-completion` で進める。worktreeごとに `dist` を生成し、実験用Chromeプロファイルに読み込む。

## 操作

1. 実験worktreeで `npm run build` を実行し、その `dist` をChromeへ読み込む。
2. YouTubeを再読み込みし、PopupでテーマをON、強さを1%以上にする。
3. Popupの「デザインを編集（実験）」を押す。
4. YouTubeの動画カードをクリックして選択する。編集中のカードクリックは動画を開かず、選択操作になる。
5. プロパティパネルで背景色、枠線の色と太さ、角丸を変更する。チェックを外した項目はテーマの値に戻る。
6. 「保存」で各タブへ反映する。「変更を破棄」で最新の保存値に戻る。×またはEscで終了すると、未保存の変更を破棄する。

クリックしたカードは編集対象の種類を選ぶための見本であり、同じ種類の通常動画カード全体へ適用する。1枚だけに固有のデザインは保存しない。パネルがカードに重なる場合は「パネルを左へ／右へ」で移動できる。

通常モードには選択用のイベント監視、パネル、選択表示を残さない。動画クリックは従来どおり動作する。テーマOFF／強さ0%では編集を終了し、デザインCSS、surface、選択属性、テーマの変数、追加機能を撤去する。保存値は維持し、再びONにすると復元する。

## 画像素材の操作

「画像を追加」でPNG・WebPを選択するか、編集モードのYouTube画面へファイルをドロップする。複数ファイルをまとめて追加でき、素材ごとに独立した画像レイヤーを作る。

画像をクリックして選択し、ドラッグで移動、四隅のハンドルで縦横比を保ったサイズ変更、上の丸いハンドルで回転する。プロパティパネルから位置、幅、高さ、角度、不透明度、重なり順、表示のON／OFFも変更できる。レイヤー一覧から非表示の画像も選択できる。Deleteまたは「画像を削除」で選択画像を削除する。文字や数値を入力している間のDeleteは画像を削除しない。

初期の配置基準は画面。中心位置は画面幅・高さに対する割合、サイズはCSSのpxで保存する。スクロールで位置をずらさず、ウィンドウサイズが変わると割合に従って追従する。「動画プレイヤー」を基準にすると、そのsurfaceの矩形へ追従する。SPA遷移などで基準のUIがない場合は画像を非表示にする。

保存、破棄、終了時の扱いはカードと共通。通常モードの画像はクリックを透過し、選択枠とハンドルを隠す。OFF／0%ではレイヤーDOM、object URL、スクロール・サイズ監視も撤去する。

## 責務

- `sites/youtube-cards.ts`: 通常動画の対象識別。ホーム、検索結果、おすすめの旧／新コンポーネントを扱う。Shorts、チャンネル、プレイリスト、案内、識別できる広告枠は除外する。
- `sites/youtube.ts`: `data-ww-surface~="video-card"` を付与する。SPA、リンクの遅延追加・再利用、削除に追従し、入れ子のカードを重複して編集対象にしない。
- `design/types.ts` / `schema.ts`: バージョン付きのデータ形式と検証。任意CSS、セレクタ、JavaScript、外部URLを受け付けない。
- `design/renderer.ts`: 登録済みsurfaceと検証済み値からCSSを生成する。背景は既存グラデーションを置き換え、枠線は寸法を変えない内側の影で描く。角丸はカードの外枠に適用し、画像の寸法や操作部分のクリップは変更しない。
- `design/image-renderer.ts` / `geometry.ts`: 画像レイヤーの描画、マウス操作、配置計算、UIアンカー追従。カードのCSSとは独立する。
- `assets/validation.ts` / `client.ts`: PNG・WebPの検証と拡張内通信。画像はHTMLやスクリプトとして扱わない。
- `assets/repository.ts` / `background/index.ts`: 拡張オリジンのIndexedDB、素材参照の検証、編集中の素材保持、不要素材の回収。処理を直列化し、他タブのdraftが参照する素材も保護する。
- `editor/controller.ts`: 選択、タブ内のdraft、保存、破棄、他タブ更新との調整。サイト固有のセレクタやイベント名を持たない。
- `editor/panel.ts` / `panel.css`: Shadow DOM内のプロパティUI。サイトのCSSとテーマCSSから分離する。
- `storage/designs.ts`: デザイン専用の読込、保存、変更通知。既存設定のキーや自動保存処理は変更しない。
- `themes/controller.ts`: 基底テーマとデザインの適用・撤去をまとめる。retro固有の変数は `themes/retro/variables.ts` で生成する。

適用順は基底テーマ、保存済みデザイン、編集中draft。CSSの強さは全体ON／OFFと0%の境界に従うが、入力した色やpx値は強さによって補間しない。

## 保存形式

保存キーはサイト別の `webWorldThemes.design.youtube`。初期検証は1サイト1文書とし、テーマ一覧や素材ライブラリはまだ作らない。

```json
{
  "schemaVersion": 2,
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
  ],
  "decorations": [
    {
      "kind": "image",
      "id": "image-example",
      "assetId": "asset-0000000000000000000000000000000000000000000000000000000000000000",
      "name": "flower.png",
      "placement": {
        "anchor": { "kind": "viewport" },
        "x": 0.45,
        "y": 0.45,
        "widthPx": 260,
        "heightPx": 195,
        "rotationDeg": 0
      },
      "opacity": 1,
      "zIndex": 0,
      "visible": true
    }
  ]
}
```

色は6桁HEX、枠線は0〜12px、角丸は0〜48pxの整数。未指定の項目は基底の見た目を維持する。未知のバージョンや未対応の対象を読み込んだ場合は編集を止め、保存データを上書きしない。

上のasset IDは形式の例。実際には画像のSHA-256から生成し、JSONには画像データや一時的なblob URLを入れない。旧v1は読み込み時にv2へ移行し、既存カード設定と基底テーマを保持する。保存操作まで元データを書き換えない。

`baseThemeId` は任意の組み込みテーマIDを表す。`null` は組み込みテーマを使わず、ネイティブのYouTubeにデザインだけを適用する。今回のUIはretroから開始するが、文書とRendererはretroに依存せず、`null` の描画・編集・保存も自動テストする。

装飾は `decorations` の `kind` で分け、配置基準は `anchor` の `kind` で分ける。将来のブレークポイント、モーション、別種の装飾も、カードCSSや素材保存処理へ混ぜずに拡張する。タイムライン、複数テーマ管理、テーマの入出力・配布UIは今回の範囲外。将来の配布物は、文書とasset IDに対応する画像ファイルを一緒に扱う必要がある。

## 画像保存と制限

静止PNG・WebPのみ対応する。MIME名だけでなく署名、チャンク長、画像寸法を確認し、Service Workerでも実際にデコードして検証する。SVGや任意のHTML／JavaScript、アニメーションPNG・WebPは受け付けない。

- 1枚4MB、4096×4096pxまで。
- 一度の追加は8枚・合計12MBまで。
- 配置は32レイヤーまで。素材DBは合計48MB・128素材まで。
- 同じ画像は内容のハッシュで重複保存を避ける。

画像BlobはYouTubeのIndexedDBではなく拡張のIndexedDBに保存する。Chrome Storageには軽いJSONのみ保存する。画像を先に保存し、参照先がすべて存在することを検証してからJSONを保存する。保存に失敗した場合は以前の文書を維持する。

保存前の画像は編集セッションが保持する。破棄、終了、画像削除後は、保存文書と他タブの編集セッションから参照されていない素材を回収する。古いタブやページの保持情報も整理する。未知の文書バージョンがある場合は、その素材を誤って消さないよう回収を止める。

## 保存と複数タブ

未保存のプレビューは編集しているタブだけに適用する。保存済みの変更は `storage.onChanged` で各タブに反映する。別タブの保存が届いたとき、編集中のdraftは保持し、上書きになることを表示する。「変更を破棄」は最新の保存値へ戻る。

同時保存は最後の書込が優先される。文書単位の保存で、排他ロックや共同編集のマージは実装しない。保存に失敗した場合はdraftを保持し、再試行できる。

## 権限と検証

Manifestの権限は従来の `storage` のみ。素材をYouTubeの保存領域から分離するためService Workerを追加する。`tabs`、`activeTab`、`unlimitedStorage`、動的コード注入、新しい通信先は追加しない。[拡張のIndexedDBと保存領域](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies#storage)

`tests/design.spec.ts` は文書、CSS生成、保存、初期読込と変更通知の競合を検証する。`tests/creator-editor.spec.ts` は実拡張機能、独立したChromiumプロファイル、実Chrome StorageとローカルのYouTube相当HTMLを使う。実YouTubeの最新DOMやログイン状態の確認とは分ける。

`tests/image-data.spec.ts` は形式、移行、境界値、移動・サイズ変更・回転の計算を検証する。`tests/image-editor.spec.ts` は実IndexedDBでの素材保存、透過、実マウス操作、複数素材、タブ同期、破棄、回収、ブラウザー再起動後の復元を検証する。

専用worktreeではテスト用ブラウザーを `PLAYWRIGHT_BROWSERS_PATH`、短いプロファイル保存先を `WW_TEST_PROFILE_ROOT` で指定できる。通常のChromeプロファイルを指定しない。
