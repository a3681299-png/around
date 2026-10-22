# mainマージ前の実サイト確認

確認日: 2026-10-22。対象ソース: `23f5143958e9466181c65117fcaef58047b86856`。
今回、製品コードの修正は行っていない。READMEには依頼Gで用意したマージ時の案内を反映した。

## 実サイトテスト

`tests/*live*.spec.ts` の10ファイル・12件を、実際のYouTubeと通信する隔離プロファイルで実行した。
12件成功、失敗・スキップ・再実行なし。全体の実時間は389.262秒（6分29秒）。
開始は2026-10-22 05:40:19 UTC、終了は05:46:48 UTC。
ブラウザーはPlaywright Chromium 153.0.8010.12、拡張は通常構成の `.work/g-verified` を使用した。

| ファイル                      | 件数 | 各テストの時間 | 確認内容                                                            |
| ----------------------------- | ---: | -------------- | ------------------------------------------------------------------- |
| editor-ux-live.spec.ts        |    1 | 15.3秒         | マウス操作、グループ、マスク、保存と復元                            |
| live-youtube.spec.ts          |    2 | 47.6 / 57.3秒  | 実サイトのライト・ダーク表示                                        |
| media2-live.spec.ts           |    1 | 22.0秒         | 保存済みグループ、マスク、アンカー、シグナル、表示モード、SPA       |
| model-live.spec.ts            |    1 | 31.7秒         | 3D、ポーズとテイク、保存・再読み込み、ネイティブ操作                |
| side-panel-live.spec.ts       |    1 | 30.0秒         | 公式パネル、制作、ネイティブ操作、ウィンドウ幅変更                  |
| signal-motion-live.spec.ts    |    1 | 30.6秒         | GIF追従、録画・再生、再読み込み、リサイズ                           |
| signal-timeline-live.spec.ts  |    1 | 31.8秒         | GIFスクロール連動、テイク、投影、再生と再読み込み                   |
| studio-live.spec.ts           |    1 | 35.1秒         | 独立Studio、双方向編集、復旧                                        |
| studio-workspace-live.spec.ts |    2 | 14.8 / 30.4秒  | レイアウト実験とインページStudio                                    |
| vrm-live.spec.ts              |    1 | 39.4秒         | 私用VRMの取り込み、MToon、視線、表情、保存・再読み込み、全画面、SPA |

実行したコマンド（環境変数はすべて1、VRMだけローカルファイルの絶対パス）:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path '../../.work/browsers').Path
$env:WW_TEST_EXTENSION_PATH = '.work/g-verified'
$liveFlags = @(
  'WW_LIVE_EDITOR_UX', 'WW_LIVE_YOUTUBE', 'WW_LIVE_3D', 'WW_LIVE_MEDIA',
  'WW_LIVE_SIDE_PANEL', 'WW_LIVE_SIGNAL_MOTION', 'WW_LIVE_SIGNAL_TIMELINE',
  'WW_LIVE_STUDIO', 'WW_LAYOUT_PILOT', 'WW_LIVE_STUDIO_WORKSPACE', 'WW_LIVE_VRM'
)
foreach ($flag in $liveFlags) { Set-Item -LiteralPath "Env:$flag" -Value '1' }
# WW_VRM_FILE は利用許諾のあるローカルVRMへ設定する。原本をリポジトリへ入れない。
$liveSpecs = @(Get-ChildItem tests -Filter '*live*.spec.ts' | ForEach-Object { 'tests/' + $_.Name })
npm run test:e2e -- @liveSpecs --output=.work/premerge-live-01
```

VRMは57,185,776 bytesの指定された原本を使用した。原本・そのスクリーンショット・ブラウザープロファイルはコミットしていない。
サイドパネルの動画再生とフェードは実際に検証できた。ウィンドウ幅1366 / 1920 / 1000も確認した。
`WW_NATIVE_RESIZE` の手動パネル境界ドラッグ分岐は実行していない。これは人が境界をドラッグして完了ファイルを置く補助確認で、上の12テストの成功件数には影響しない。

保存済みの普段の作品については、依頼者から「普段のChromeで確認済み」と回答を受けた。

## 連続再生60秒の計測

普段のBraveの既存プロファイルを使い、[公開動画](https://www.youtube.com/watch?v=LC1a-DwUhls)を操作せず連続再生した。
測定窓は2026-10-22 06:10:19.906 UTCから60,245ms、動画の進みは60.244秒（6.121232 → 66.365199秒）。
終了時は再生中、readyState=4、広告・再生エラーなし。ビューポートは1536×735。

実際の `FeatureController.refresh()` の入口で呼び出し回数を数え、直前のThemeController通知の種類へ割り当てた。
設定反映と不明な呼び出しは別枠でも数え、どちらも0だった。

| 変化の種類 | Adapterからの通知 | features.refresh |
| ---------- | ----------------: | ---------------: |
| content    |                 1 |                0 |
| structure  |                22 |               22 |
| navigation |                 1 |                1 |
| mode       |                 0 |                0 |
| fullscreen |                 0 |                0 |
| 合計       |                24 |               23 |

`navigation` はYouTubeの `yt-page-data-updated` なども同じ種類になる。利用者が1回ページ遷移したという意味ではない。
この1回は、初回表示後の遅延更新も含めた測定で、定常状態だけの平均や他の動画への一般化はしていない。

使用中の実験版 `.work/f-verified` に一時的なカウンターだけを入れ、指定フラグメントの計測タブだけで有効にした。
Adapter・ThemeController・FeatureControllerの3ファイルはF検証時点から対象ソースまで差分がないことを確認した。
測定終了後に結果をDOMへ表示したため、その表示による変更は計数していない。
カウンターは製品ソース・通常版distへ入れていない。
計測後は元のバンドルへバイト単位で復元し、SHA-256が
`c4867d63ff8d39e5fb94f0cf8a1883d5319a93e6342ca7eed99f44ba89699166` に戻ったことを確認した。
依頼者が実験版の再読み込みも完了した。

## structureの原因と絞り込み

structureは22回/分。MutationRecord自体の件数とは異なり、同じフレームの変更はまとめられる。
原因調査では要素名・ID・クラスと追加/削除の区別だけを記録し、テキスト、リンク先、アカウント情報は収集しなかった。
記録は異なるパターン256種類までで、上限に到達した。以下はその範囲の代表例で、全変更の網羅や各refreshとの一対一の対応ではない。

| 変更要素                                        | 記録された変更                                 |
| ----------------------------------------------- | ---------------------------------------------- |
| yt-attributed-string                            | span.ytAttributedStringHostの追加12 / 削除12   |
| ytd-engagement-panel-section-list-renderer      | 説明などのパネルへheader/content/footerを追加8 |
| yt-icon#logo-icon 内のspan                      | アイコン用divを追加4                           |
| body                                            | divの追加4 / 削除4                             |
| #flexible-item-buttons 内のyt-button-view-model | ボタンの追加4                                  |
| ytd-video-owner-renderer 内のa                  | href属性の更新4                                |
| #secondary-inner                                | 関連動画とdonation-shelfの追加/削除、それぞれ3 |

採取範囲では、自分たちのUIを示す `web-world-themes-` の消失は記録されなかった。
現在のAdapterは、所有領域の外の要素追加・削除や監視対象の属性変更を広くstructureへ分類するため、こうしたネイティブUI更新もrefreshを呼ぶ。

「自分たちのUIが消えた場合だけ」に限定する案は今回は採用しなかった。
`mountYouTubeChrome.refresh()` は後から追加されるmasthead・player・playlistも探し、`mountYouTubeDetails.refresh()` も遅れて現れる配置先を探す。
まだ一度も取り付けていないUIには消失通知がないため、その条件だけでは初回取り付けを見落とす。
絞り込むなら、所有UIの消失に加えて必要なネイティブホストの出現・交換を識別する必要がある。
次の候補は、テキスト描画内部や無関係なボタンの差し替えをcontentへ寄せ、遅延ホスト出現・所有UI再取り付け・SPA・全画面を回帰検証すること。
今回は調査結果として記録し、拡張の挙動は変更していない。

## 計測環境での再生エラー

12件の実サイトテストは初回ですべて成功した。その後の60秒計測では、隔離した未ログインのChromiumとBraveで約30〜38秒後にYouTubeの再生エラーが出た。
同じ動画を再実行しても解消せず、拡張なしのブラウザーでも再現した。別の公開動画でも再現し、その際はgooglevideoの動画取得にHTTP 403を6件確認した。
したがって、拡張だけに起因する失敗としては再現していない。未ログインの隔離環境でのYouTube配信側の拒否が関与していると考えられるが、原因の条件までは特定していない。

依頼者は普段のブラウザーで1分以上再生できると回答し、その環境で上記の60秒計測を完了した。
中断した計測値は60秒の結果として使っていない。通信の差し替え、認証の回避、Cookieのコピー、タイムアウト延長は行っていない。

## マージと検証の範囲

この記録とREADME以外の製品変更はない。対象ソースのCIは[unit / e2eとも成功](https://github.com/a3681299-png/web-world-themes/actions/runs/39723579648)している。
記録追加後のローカル検証も、lint・型チェック・専用出力先へのビルドが成功した。
unitは310件成功（Playwright 9.0秒、コマンド全体10.780秒）、`tests/page-change.spec.ts` の描画回帰は4件成功（15.7秒）。
後者は小さなテキスト変更、表面とstyleの再取り付け、所有UIの復元、設定・作品・遷移・ダーク/ライト・全画面の新旧表示一致を含む。
最新コミットのunit / e2e CI成功を確認してからmainへfast-forwardする。最終CIのURLは完了報告へ併記する。
通常版distは今回更新しない。先に記録した全12ファイルのSHA-256をマージ後にも比較する。
常用先の切り替えとバックアップの手順は [extension-consolidation.md](extension-consolidation.md) を参照する。
