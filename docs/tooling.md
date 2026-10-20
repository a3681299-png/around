# 整形と静的検査

`npm run format` で整形し、`npm run format:check` で確認します。Prettierを使い、`printWidth`は120です。TypeScript、CSS、HTML、JSONを同じツールで扱い、npmの既存手順に組み込めるため選びました。

`src/vendor`の固定版、`assets`、テスト用メディア・HTML fixture、ビルド成果物は整形しません。固定ファイルのハッシュと、fixtureの検証条件を維持するためです。HTMLの空白判定は`strict`にしています。

Signal Timelineの性能比較テストは、整形済みのJavaScriptを基準に計測処理を挿入します。履歴側の処理や計測箇所が一致しない場合のエラー、評価回数と出力の比較は維持します。
