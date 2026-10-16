# 2Dアニメーション素材の編集

`codex/creator-editor-spike` の実験機能。実験worktreeの `dist` をChromeへ読み込み、拡張とYouTubeを再読み込みして使う。通常版の `dist` は更新しない。

## 制作の流れ

1. テーマをON、強さを1%以上にして「デザインを編集（実験）」を開く。
2. 「アニメーションを追加」でGIF、アニメーションWebP、Lottie JSONを選択する。画面へドロップしても追加できる。
3. 画像と同じように、クリックして選択し、ドラッグで移動、四隅で拡縮、上のハンドルで回転する。
4. プロパティの「アニメーションを再生」と「ループ再生」で動作を変える。Lottieは0.25〜3倍の速度を指定できる。
5. 「保存」で文書と再生設定を保存する。ページやChromeを再起動しても素材と配置を復元する。

名前、表示、不透明度、重なり順、画面／プレイヤー基準、ロック、複製、削除、複数選択、一括移動、スナップ、整列、Undo／Redoは静止画像と共通。再生設定の変更も履歴に含める。保存前の変更は「変更を破棄」で戻せる。

一時停止は現在のフレームを維持する。ページ再読み込みでは先頭フレームから復元し、保存した再生設定に従う。再生位置そのものは保存しない。ループOFFでは最終フレームで停止する。もう一度先頭から再生するには、再生のチェックを外してから入れる。GIF／WebPに埋め込まれたループ回数より、エディターの設定を優先する。

通常モードは装飾をクリック透過にし、選択枠とハンドルを隠す。OFF／0%では描画DOM、フレーム予約、デコーダー、VideoFrame、object URL、Lottieインスタンス、再生用のイベント監視を撤去する。保存済みのデータは残す。

## 対応範囲と上限

| 対象 | 対応と上限 |
| --- | --- |
| 静止画像 | 従来どおりPNG・WebP、4MiB、4096×4096px |
| GIF／アニメーションWebP | 4MiB、1024×1024px、240フレーム、30秒まで |
| ラスターの総画素 | 1素材あたり幅×高さ×フレーム数が8×1024²以内。配置中の異なる素材の合計は16×1024²以内 |
| Lottie JSON | UTF-8、1MiB、Lottie v4／v5、1024×1024px、入力1〜60fps、30秒・1800フレームまで |
| Lottieの複雑さ | 検証時のレイヤー展開と未使用プリコンポジション確認を合わせて128レイヤー、512シェイプ、50,000データノード、深さ32まで |
| プリコンポジション | 16素材、参照の深さ8まで。循環参照は禁止 |
| 配置数 | 静止画を含め32レイヤー。そのうちアニメーションは8レイヤーまで |
| 一度の追加 | 8ファイル、合計12MiBまで |
| 素材DB | 従来どおり48MiB・128素材まで。Undo／Redoが保持する素材も含む |
| 描画 | 共通のフレーム処理で最大30fps。入力の時間を基準にフレームを選び、不要な中間フレームを省く |

GIF／WebPのフレーム間隔は、0msなら100ms、20ms未満なら20msへ補正する。透過とフレームの合成はChromeのImageDecoderで処理する。デコードした全フレームをアプリ側に保存せず、同じ素材は1つのデコーダーと直近1フレームを共有する。配置中の素材予算は追加前と保存前に検証する。

PNGアニメーション、動画、SVGファイル、`.lottie` ZIPは今回の対象外。データの寸法・フレーム数・複雑さを超える素材は、制作ソフト側で縮小・短縮・簡略化して書き出す。

## LottieとAfter Effectsの制限

公式のLottie Web Light 5.13.0を同梱し、SVGで描画する。Light版は式とエフェクトを含まず、HTML／Canvas rendererも使わない。[Lottie Light](https://github.com/airbnb/lottie-web/wiki/Lottie-Light)

今回は2Dシェイプ、平面、null、プリコンポジションに限定する。パス、楕円、矩形、塗り、線、グラデーション、グループ、トランスフォーム、トリムパス、角丸、64点以内の星形を受け付ける。以下を含むファイルは黙って省略せず、読み込み時に拒否する。

- Expressions、AEエフェクト、3D、音声、テキスト／フォント。文字はシェイプへ変換して書き出す。
- 外部画像、埋め込み画像、外部フォント、分割JSON、外部URL。素材は自己完結したベクトルデータにする。
- リピーター、マージパス、上記以外のシェイプ修飾子。必要ならシェイプへ展開するか、GIF／WebPへ書き出す。
- 循環する親・プリコンポジション参照、不正なID、範囲外の数値、過度なデータ量。

AEの全機能を再現するものではない。BodymovinのReportsと公式の機能表で書き出し内容を確認する。[Lottieの機能表](https://github.com/airbnb/lottie-web/wiki/Features)

## CSPと入力の扱い

Manifest V3の既存CSP `script-src 'self'; object-src 'none'` を維持する。`unsafe-eval`、外部スクリプト、sandboxページ、offscreen権限は追加しない。[ChromeのCSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)

Lottieは固定版のコードをビルドへ含め、JSONは`JSON.parse`でデータとして検証する。式、危険なオブジェクトキー、URL、CSSのurl／var、外部素材、未対応のレイヤーと修飾子を拒否する。Playerへ渡すのは検証済みの`animationData`だけで、パスから読み込まない。上流のページ自動検索は無効にし、nativeページの`.lottie`や`data-animation-path`を読まない。Web Workerによる動的コード生成も無効にする。

固定版の出典とSHA-256は `src/vendor/lottie-source.json`、再生成手順は `scripts/vendor_lottie.py`、ライセンスは `assets/licenses/lottie-web-MIT.txt`。ビルドとテストで固定版の一致、式評価コードがないこと、自動検索を無効にしたことを確認する。通常版の依存関係は変更していない。

GIF／WebPはファイル名やMIMEだけに頼らず、署名、チャンク／ブロック境界、寸法、フレーム数、時間、総画素を検証する。読み込み側で全フレームをデコードして確認し、Workerでも形式と上限を再検証して先頭フレームをデコードする。ImageDecoderはWindowとDedicatedWorker向けで、MV3 Service Workerでは利用できないため、この分担にしている。[WebCodecs ImageDecoder](https://www.w3.org/TR/webcodecs/#imagedecoder-interface)

## 保存と責務

DesignDocument v4は静止画像の `kind: "image"` を維持し、アニメーションに次の情報を追加する。

```json
{
  "kind": "animation",
  "id": "image-example",
  "assetId": "asset-0000000000000000000000000000000000000000000000000000000000000000",
  "format": "lottie",
  "name": "petal.json",
  "placement": {
    "anchor": { "kind": "viewport" },
    "x": 0.45, "y": 0.45, "widthPx": 260, "heightPx": 195, "rotationDeg": 0
  },
  "opacity": 1, "zIndex": 0, "visible": true, "locked": false,
  "playback": { "playing": true, "loop": true, "speed": 1 }
}
```

素材本体は従来の拡張オリジンIndexedDBへ保存する。JSON、GIF、WebPのバイト列からSHA-256のasset IDを作り、設定JSONへは埋め込まない。素材の形式とレイヤーの形式が一致することも検証する。v1〜v3文書はカード、画像、ロック、asset IDを維持して読み込み、明示保存時だけv4へ書き換える。DBの作り直しは不要。

- `assets/inspect.ts` / `animated-raster.ts` / `lottie.ts` / `decode.ts`: 入力と形式別の上限を検証する。
- `assets/design-assets.ts` / `background/index.ts`: 素材参照、種類、合計予算を確認して保存する。
- `media/controller.ts`: 素材共有、レイヤーごとの再生状態、共通フレーム処理、停止と撤去を管理する。
- `media/raster.ts` / `lottie.ts`: 形式ごとのフレーム描画だけを担当する。
- `design/image-renderer.ts`: 素材の種類を問わず、配置・選択枠・変形・スナップを扱う。
- `editor/controller.ts` / `panel.ts`: draft、履歴、保存・破棄、再生プロパティを扱う。

読み込みの最終確認中に別タブの保存値が変わった場合は、古い文書へ追加せずに中止し、最新の保存値を保つ。再生中のフレーム変化は文書の変更に数えず、dirty表示やUndo履歴を増やさない。

## 非表示と動きを減らす設定

タブが非表示、レイヤーが非表示／画面外、プレイヤー基準が存在しない場合は進行と描画を止める。`prefers-reduced-motion: reduce`にも従う。停止中は共通のフレーム予約を解除し、復帰時は停止していた位置から再開する。バックグラウンドの時間を足して早送りしない。先頭表示に必要な1フレームは停止状態でも描く。

## 検証の範囲

`tests/motion-data.spec.ts` は形式、上限、文書移行、不正なLottieと参照予算、固定Playerを検証する。`tests/motion-editor.spec.ts` は実Canvas／SVGのフレーム変化、操作、保存、再起動、複数タブ、停止・復帰、OFF時のデコーダー解放を検証する。非表示状態は拡張のisolated worldでシミュレートし、reduced-motionはブラウザーのメディア設定で切り替える。

8レイヤーの負荷計測は小さな64×48pxの検証素材で行い、ChromiumのScriptDuration、TaskDuration、JSHeapUsedSizeと描画回数を記録する。GPU・デコーダーなどのネイティブメモリやYouTube動画の負荷を含む総メモリ値ではない。複雑な実作品で同じ負荷になるとは扱わない。実サイトの最新DOM・ログイン状態・他拡張との併用は、自動テストの結果と分けて記録する。
