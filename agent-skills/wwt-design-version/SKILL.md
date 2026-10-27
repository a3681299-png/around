---
name: wwt-design-version
description: WWTの作品データ（DesignDocument）に項目を足す・版を上げるときの手順。schemaVersionの更新、移行チェーン（src/design/migrations.ts）への1段の追加、履歴由来のfixtureと期待値の取得、検証と上限の追加に使う。
---

# DesignDocument の版上げ

原則は AGENTS.md の「DesignDocument の過去の全版との互換性を保つ」と「安全検証を弱めない」。作品データは信頼しない外部入力として扱う。

## 版を上げるかの判断

- 既存の項目の意味を変えずに、**省略できる新しい項目**を足すときも、版を1つ上げる。古い版の作品にその項目が入っていたら拒否するため
- 既存の項目の意味や既定値を変えるのは、原則しない。必要なら設計書（`docs/spatial-design.md` の「作品データと移行」）に理由を書いてから

## 手順

### 1. 変更前のコミットを記録する

作業を始める前の HEAD（例：`29b8d5b`）を控える。期待値はすべて、このコミットのコードで取る。

### 2. 型・検証・上限

- `src/design/types.ts` に型を足す。保存するのは、検証済みの数値・素材ID・決まった名前（状態名・部品ID など）だけ
- `src/design/schema.ts` の検証に足す。知らないキーは拒否する。文字列は形を決めて検証する（素材IDは `asset-` ＋ SHA-256 など）
- **作品データから JS・任意の CSS 文字列・シェーダー・DOM セレクターを受け取らない**。CSS やセレクターはエンジンとアダプターが組み立てる。URL は拡張が作った object URL だけ
- 上限（件数・画像の大きさ・数値の範囲）を決め、境界値（上限ちょうど・1つ超え）をテストする
- 素材を参照する項目を足したら、`src/design/references.ts` の `designAssetIds()` に含める。素材の保持・掃除・バックアップ・Studio の復旧がここを使う

### 3. 移行チェーンに1段足す

`src/design/migrations.ts`：

- `migrateV<N>ToV<N+1>` を1つ追加し、`DESIGN_MIGRATIONS` の末尾に足す。純粋な関数にする（入力を書き換えない・ストレージに触らない）
- その段で、旧版の形（`stage()` に渡すキーの一覧）を厳密に検査する。新しい項目が旧版に入っていたら、その段で拒否する
- ある部分（例：`rules`）が全段を素通りする場合は、最後の1段の検査で v1〜v(N) をまとめて覆える。その理由をコメントに書く（`migrateV12ToV13` が例）
- `migrateDesign()` の上限の版番号と、`schema.ts`・`types.ts` の現在の版番号を、すべて更新する（`grep -rn "schemaVersion" src` で漏れを探す）
- 移行の結果は、まだ検証されていない入力。最終的な検証は `parseDesign` だけが行う

### 4. 履歴由来の fixture を足す

`tests/fixtures/designs/README.md` を読んでから行う。

- 新しく足すのは `history-v<N>.json`：直前の版 N を導入したコミットのテストが、最初に `parseDesign` へ渡して受理された入力
- 取得は `scripts/capture-design-chain-fixtures.mjs` の `cases` に `[N, '<導入コミット>', '<テストファイル>', '<テスト名>']` を足して実行する。今の形式から項目を削って過去の形式を**推測しない**
- 由来（コミット・ファイル・テスト名）を `chain-provenance.json` に記録し、README に1段落足す

### 5. 期待値を変更前のコードで取る

- `chain-expected.json`：全 fixture を、手順1の変更前のコミットのパーサーで読んだ結果。新しい fixture の分を足す。テストの実行時には再生成しない
- `css-expected.json`：全 fixture を、変更前のコミットの `compileDesign` で組み立てた CSS
- 変更後のコードで、次をテストで確かめる（`tests/design-migrations.spec.ts`・`tests/skin-data.spec.ts` が例）
  - 全 fixture の移行後の結果が、版番号以外で期待値と完全に一致する
  - 全 fixture の CSS が、期待値とバイト単位で一致する（既存の作品の見た目が変わらない）

### 6. テスト

- 新しい項目の往復（保存 → 読込で同じ）
- 古い版に新しい項目を入れた作品が拒否される
- 悪意のある値（CSS の断片を混ぜた文字列・知らない状態名・範囲外の数値・`data:`/`http:`/`javascript:` の URL）が拒否される
- 上限の境界値
- 新しい spec ファイルを作ったら、unit なら `playwright.config.ts` の `unitSpecs` に名前を足す

### 7. 記録

- その段階の docs に「作品データ（DesignDocument v<N>）」の節を作り、項目の表・上限・移行の方針・期待値を取ったコミットを書く
- `docs/spatial-design.md` の「段階ごとの版」の表を更新する
- 利用者が実際に保存した過去の JSON での確認は、まだしていない。それを完了報告の「未確認の点」に書き続ける
