# 整形と静的検査

`npm run format` で整形し、`npm run format:check` で確認します。Prettierを使い、`printWidth`は120です。TypeScript、CSS、HTML、JSONを同じツールで扱い、npmの既存手順に組み込めるため選びました。

`src/vendor`の固定版、`assets`、テスト用メディア・HTML fixture、ビルド成果物は整形しません。固定ファイルのハッシュと、fixtureの検証条件を維持するためです。HTMLの空白判定は`strict`にしています。

Signal Timelineの性能比較テストは、整形済みのJavaScriptを基準に計測処理を挿入します。履歴側の処理や計測箇所が一致しない場合のエラー、評価回数と出力の比較は維持します。

`npm run lint`は、Prettierの確認、既存の`scripts/lint.mjs`、型情報付きESLintを順番に実行します。YouTubeセレクターの境界と色トークンの検査はそのまま残しています。TypeScriptの検査対象は`src`、`tests`、`playwright.config.ts`です。有効なESLint規則は次の3つです。

- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/no-misused-promises`
- `@typescript-eslint/switch-exhaustiveness-check`

意図的に待たないPromiseは`void`で明示します。規則の無効化やファイル単位の例外は設けていません。

型チェックの`tsc`は既存のTypeScript 7.0.2を維持します。typescript-eslintが必要とする6系のAPIは、公式の[併用手順](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60)に沿ってnpm aliasで提供します。`@typescript/native`が7系の`tsc`を、`typescript`が6系のAPIを提供します。ESLint 10に合わせ、Node.jsは22.13以降の22系、または24以上を使います。

整形コミットは`.git-blame-ignore-revs`に登録しています。たとえば`git blame --ignore-revs-file .git-blame-ignore-revs -- src/editor/panel.ts`で除外できます。
