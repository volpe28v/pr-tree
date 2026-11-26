# pr-tree

GitHub Pull Request をツリー表示する macOS 向けデスクトップアプリ（Electron）。

## Desktop App (Electron)

macOS 向けの常駐型デスクトップアプリ。小さいウィンドウで PR ツリーをリアルタイム表示します。

### セットアップ

```bash
cd pr-tree-app
npm install
```

### 起動

```bash
cd pr-tree-app
npm start
```

### 初期設定

初回起動時に設定パネルが表示されます。

1. **Token** - 空欄のままなら `gh` CLI の認証（`gh auth login` 済みであること）を使用
   - `gh` を使わない場合は GitHub Personal Access Token（`repo` スコープ）を入力
   - https://github.com/settings/tokens から発行
2. **Repositories** - `owner/repo` 形式でリポジトリを追加（複数登録可）
3. **Account** - 自分の GitHub ユーザー名を入力（My PRs / Review Requested の分類に使用）
4. **Interval (sec)** - ポーリング間隔（秒）。デフォルト 60 秒
5. **Save** を押して保存

### 操作方法

| ボタン | 機能 |
|--------|------|
| ☰ | カード表示（My PRs / Review Requested をセクション分け） |
| 🌳 | ツリー表示（ブランチの親子関係をツリー構造で表示） |
| ✅ | 承認済み PR の非表示トグル（Review Requested セクションのみ適用） |
| ↻ | 手動更新 |
| ⚙ | 設定パネルの開閉 |

### 表示内容

- **CI ステータス**: 🟢 成功 / 🔴 失敗 / 🟡 実行中 / ⚪ 未実行
- **承認状態**: ✅ 承認者名（2名以上の場合は `+N` 表示）
- **コンフリクト**: 💥 マージ不可
- **ツリーバッジ**: 🌳 クリックでスタック PR のツリー詳細を画面下部に表示

PR カードをクリックすると、ブラウザで該当 PR を開きます。

### ビルド・パッケージ

```bash
cd pr-tree-app

# 開発時の起動（DevTools 付き）
npm run dev

# macOS アプリとしてパッケージング（ビルド → .app 生成 → /Applications にコピー）
npm run package
```

`npm run package` を実行すると `/Applications/PRTree.app` が生成され、Launchpad や Spotlight から起動できます。
