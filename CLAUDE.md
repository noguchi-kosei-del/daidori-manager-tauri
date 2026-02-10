# 台割マネージャー (Daidori Manager)

漫画・同人誌の台割（ページ構成）を管理し、入稿データを生成するデスクトップアプリケーション

## プロジェクト概要

- **アプリ名**: 台割マネージャー
- **バージョン**: 1.0.0
- **識別子**: com.daidori.manager
- **目的**: 漫画制作における台割管理・入稿データの自動生成

## 技術スタック

### フロントエンド
- **React 18** + **TypeScript 5.3**
- **Vite 5** (ビルドツール)
- **Zustand 4.5** (状態管理)
- **@dnd-kit** (ドラッグ&ドロップ)

### バックエンド (Tauri)
- **Tauri 2** (デスクトップアプリフレームワーク)
- **Rust** (バックエンド処理)
- 画像処理: `image`, `psd` クレート
- 並列処理: `rayon`, `tokio`

### Tauriプラグイン
- `tauri-plugin-dialog` - ファイル/フォルダダイアログ
- `tauri-plugin-fs` - ファイルシステムアクセス
- `tauri-plugin-opener` - 外部アプリ連携

## 主要機能

### 1. チャプター管理
- チャプター（話数）の追加・削除・並べ替え
- チャプターの種類:
  - `chapter`: 通常の話（第1話、第2話...）
  - `cover`: 表紙
  - `blank`: 白紙
  - `intermission`: 幕間
  - `colophon`: 奥付

### 2. ページ管理
- フォルダからの画像ファイル一括読み込み
- ドラッグ&ドロップによるページ追加・並べ替え
- 対応フォーマット: **JPG, PNG, PSD, TIFF**
- 特殊ページの挿入（白紙、表紙、奥付など）
- 複数選択による一括操作（Ctrl+クリック、Shift+クリック）

### 3. サムネイル表示
- 高品質サムネイル生成（480px、PNG形式）
- PSDファイルのコンポジット画像からサムネイル生成
- ディスクキャッシュ + メモリLRUキャッシュ
- 並列処理による高速生成（最大4並列）

### 4. プレビュー機能
- 見開きプレビュー（日本式: 右から左へ）
- ページ単体プレビュー
- サムネイルサイズ切替（小/中/大）
- チャプター別/全体表示の切替

### 5. エクスポート機能
- 連番ファイル名での出力
- チャプター別サブフォルダ出力
- JPG変換オプション（品質設定可）
- 白紙ページの自動生成（前後ページのサイズを参照）
- コピー/移動モード選択

### 6. プロジェクト管理
- `.daidori` 形式での保存/読込
- 最近使ったファイル履歴（最大10件）
- ファイル参照の検証（移動/変更検出）
- Undo/Redo機能（最大50履歴）
- 未保存変更の警告

### 7. UI機能
- ダークモード/ライトモード切替
- サイドバー折りたたみ
- プロジェクト名のインライン編集
- ウィンドウ終了時の保存確認

## データ構造

### チャプター (Chapter)
```typescript
interface Chapter {
  id: string;           // UUID
  name: string;         // チャプター名
  type: ChapterType;    // 種類
  pages: Page[];        // ページ配列
  collapsed: boolean;   // 折りたたみ状態
  folderPath?: string;  // 元フォルダパス
}
```

### ページ (Page)
```typescript
interface Page {
  id: string;
  pageType: PageType;          // 'file' | 'cover' | 'blank' | 'intermission' | 'colophon'
  filePath?: string;           // ファイルパス
  fileName?: string;           // ファイル名
  fileType?: FileType;         // 'jpg' | 'png' | 'psd' | 'tif'
  fileSize?: number;           // ファイルサイズ
  modifiedTime?: number;       // 更新日時(Unix ms)
  thumbnailStatus?: ThumbnailStatus;
  thumbnailPath?: string;      // base64データURL
  label?: string;              // 特殊ページのラベル
}
```

## プロジェクトファイル形式 (.daidori)

JSONベースのファイル形式:
```typescript
interface DaidoriProjectFile {
  version: '1.0';
  name: string;            // プロジェクト名
  createdAt: string;       // 作成日時 (ISO 8601)
  modifiedAt: string;      // 更新日時 (ISO 8601)
  basePath: string;        // 基準パス（相対パス解決用）
  chapters: SavedChapter[];
  uiState?: SavedUiState;  // UI状態の保存
}
```

## Tauriコマンド (invoke)

| コマンド | 説明 |
|---------|------|
| `get_folder_contents` | フォルダ内の画像ファイル一覧を取得 |
| `generate_thumbnail` | サムネイル生成（キャッシュ対応） |
| `export_pages` | ページをエクスポート |
| `save_project` | プロジェクト保存 |
| `load_project` | プロジェクト読込 |
| `validate_project_files` | ファイル参照の検証 |
| `get_recent_files` | 最近使ったファイル取得 |
| `add_recent_file` | 最近使ったファイルに追加 |
| `open_file_with_default_app` | ファイルを既定のアプリケーションで開く |

## 開発・ビルド

### 開発環境の起動
```bash
npm run tauri dev
# または
dev.bat
```

### プロダクションビルド
```bash
npm run tauri build
```

### ビルド出力
- Windows: MSI, NSIS インストーラー

## ディレクトリ構成

```
daidori-manager-tauri/
├── src/                           # Reactフロントエンド
│   ├── App.tsx                    # メインAppコンポーネント (~2,100行)
│   ├── store.ts                   # Zustand状態管理
│   ├── types.ts                   # 型定義
│   ├── icons.tsx                  # アイコンコンポーネント
│   ├── styles.css                 # グローバルスタイル
│   ├── main.tsx                   # エントリーポイント
│   ├── constants/
│   │   └── dnd.ts                 # D&D関連定数
│   ├── hooks/
│   │   └── useThumbnailQueue.ts   # サムネイルキュー処理
│   └── components/
│       ├── preview/
│       │   ├── SpreadViewer.tsx   # 見開きビューア
│       │   ├── ThumbnailCard.tsx  # サムネイルカード
│       │   └── index.ts
│       ├── sidebar/
│       │   ├── SortablePageItem.tsx  # ソート可能ページ
│       │   ├── ChapterItem.tsx    # チャプター項目
│       │   └── index.ts
│       ├── dnd/
│       │   ├── DragOverlays.tsx   # ドラッグオーバーレイ
│       │   ├── DropZones.tsx      # ドロップゾーン
│       │   └── index.ts
│       └── modals/
│           ├── ExportModal.tsx    # エクスポートモーダル
│           └── index.ts
├── src-tauri/                     # Tauriバックエンド
│   ├── src/
│   │   ├── lib.rs                 # エントリーポイント (~50行)
│   │   ├── main.rs                # Tauriメイン
│   │   ├── constants.rs           # 定数定義
│   │   ├── state.rs               # AppState
│   │   ├── image_utils.rs         # 画像ユーティリティ
│   │   ├── types/
│   │   │   ├── mod.rs
│   │   │   ├── file.rs            # FileInfo
│   │   │   ├── export.rs          # ExportPage
│   │   │   └── project.rs         # プロジェクト関連型
│   │   ├── cache/
│   │   │   ├── mod.rs
│   │   │   ├── disk.rs            # ThumbnailCache (ディスク)
│   │   │   └── memory.rs          # ThumbnailMemoryCache (LRU)
│   │   ├── thumbnail/
│   │   │   ├── mod.rs             # generate_thumbnailコマンド
│   │   │   ├── image.rs           # 画像サムネイル生成
│   │   │   └── psd.rs             # PSD処理
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── folder.rs          # get_folder_contents
│   │       ├── export.rs          # export_pages
│   │       ├── project.rs         # save/load/validate
│   │       └── recent.rs          # recent files
│   ├── Cargo.toml                 # Rust依存関係
│   └── tauri.conf.json            # Tauri設定
├── package.json                   # npm依存関係
└── vite.config.ts                 # Vite設定
```

## 設計方針

1. **オフラインファースト**: ネットワーク接続不要で動作
2. **高速なサムネイル**: ディスク/メモリキャッシュ、並列処理
3. **直感的なUI**: ドラッグ&ドロップ中心の操作
4. **データ安全性**: Undo/Redo、未保存警告、ファイル参照検証
5. **柔軟なエクスポート**: 連番/サブフォルダ/JPG変換対応

## セキュリティ設定 (CSP)

```
default-src 'self';
img-src 'self' asset: https://asset.localhost data: blob:;
style-src 'self' 'unsafe-inline'
```

## キャッシュディレクトリ

- サムネイル: `%LOCALAPPDATA%/daidori-manager/thumbnails/`
- 設定: `%APPDATA%/daidori-manager/`

## モジュール構成

### フロントエンド (React/TypeScript)

| モジュール | 説明 |
|-----------|------|
| `components/preview/` | プレビュー表示コンポーネント（SpreadViewer, ThumbnailCard） |
| `components/sidebar/` | サイドバーコンポーネント（ChapterItem, SortablePageItem） |
| `components/dnd/` | ドラッグ&ドロップ関連（DragOverlays, DropZones） |
| `components/modals/` | モーダルダイアログ（ExportModal） |
| `hooks/` | カスタムフック（useThumbnailQueue） |
| `constants/` | 定数定義（D&D用ID、並列処理数など） |

### バックエンド (Rust/Tauri)

| モジュール | 説明 |
|-----------|------|
| `types/` | 型定義（FileInfo, ExportPage, ProjectFile等） |
| `cache/` | キャッシュ管理（ディスクキャッシュ、メモリLRUキャッシュ） |
| `thumbnail/` | サムネイル生成（画像処理、PSD対応） |
| `commands/` | Tauriコマンド（folder, export, project, recent） |
| `image_utils.rs` | 画像ユーティリティ（サイズ検証、ファイルタイプ判定） |
| `state.rs` | アプリケーション状態管理 |
| `constants.rs` | 定数定義（キャッシュサイズ、対応拡張子等） |

## 変更履歴

### 2026-02-06: UI改善

#### サイドバー
- チャプター追加ボタン（chapter-actions-bar）をsidebar-footerに移動
- ボタン配列を変更: 表紙 → 白紙 → 話 → 幕間 → 奥付
- ページ追加ボタンにPlusCircleIconと「ページを追加」テキストを追加
- chapter-actions-barとfooter-statsの間に区切り線を追加
- project-menu-triggerとexport-btnの間の余白を調整

#### チャプターヘッダー
- ホバー時のグラデーションを::before疑似要素で実装（z-index: -1でボタン枠線の下に配置）
- overflow: hiddenとborder-radiusを追加

#### プレビューエリア
- ダークモード: 背景色を少し明るく調整（#1a1a24 → #12121a）
- ライトモード: 背景色を少しグレーに調整（#e8eaed → #dde0e4）
- 透明画像対応: thumbnail-wrapperの背景色を白（#ffffff）に変更

#### アイコン
- PlusCircleIcon（○に+）を追加（icons.tsx）

### 2026-02-06: ドラッグ操作・ライトモード改善

#### preview-area
- 空状態の判定条件を修正: `displayPages.length === 0` → `chapters.length === 0`
- チャプターを追加したがページがない場合でもchapter-page-wrapperが表示されるように修正
- メッセージを「ページがありません」→「チャプターがありません」に変更

#### project-name-display
- 文字色のグラデーションを削除し、単色（var(--color-text-primary)）に変更

#### ドラッグ操作のUI簡素化
- ページ移動時のドロップインジケーターバー（移動先メッセージ）を削除
- 外部ファイルドラッグ時のみインジケーターバーを表示
- ページドラッグ時の「新規チャプター作成ゾーン」（先頭・末尾）を削除

#### ライトモード対応
- sidebar-drag-overlay: 背景を白系（rgba(255, 255, 255, 0.95)）に変更
- chapter-drag-overlay: 背景を白系グラデーションに変更、テキストシャドウを削除

### 2026-02-07: 見開き表示にフローティングナビゲーションバーを追加

#### SpreadViewer
- 見開き表示時に右側にフローティングスクロールバーを追加
- ハンドルをドラッグしてページ間を移動可能
- トラッククリックでその位置にジャンプ
- 現在のページ番号をバブル表示（例: 2-3p）
- バブルの色をハンドルと同じアクセントカラーに統一

#### アイコン追加（icons.tsx）
- ChevronUpIcon（上矢印）
- ChevronDownIcon（下矢印）
- ChevronsUpIcon（二重上矢印）
- ChevronsDownIcon（二重下矢印）

#### サイドバー
- チャプターが空の場合「チャプターを追加してください」メッセージを表示
- sidebar-empty-stateを縦横中央に配置

#### preview-area
- empty-state（チャプターがありません）を削除

### 2026-02-07: UI調整

#### ThumbnailCard
- thumbnail-numberのフォントサイズをグリッドサイズに応じて変更
  - 小（100px）: 16px
  - 中（140px）: 22px
  - 大（180px）: 28px

#### ヘッダー
- ホームボタンを「リセット」ボタンに変更
- アイコンをHomeIconからResetIcon（円形矢印）に変更

#### アイコン追加（icons.tsx）
- ResetIcon（円形矢印）を追加

### 2026-02-08: アプリアイコン設定

#### アイコン生成
- `logo/daidori_icon.png`から`tauri icon`コマンドで各種アイコンを自動生成
- 生成先: `src-tauri/icons/`
  - Windows: icon.ico
  - macOS: icon.icns
  - PNG各種サイズ（32x32, 64x64, 128x128, 256x256）
  - Windows Store用ロゴ（Square各種サイズ）
  - iOS/Android用アイコン

#### ウィンドウアイコン（lib.rs）
- `setup`フックでウィンドウアイコンを動的に設定
- `image`クレートでPNGをデコードし、`tauri::image::Image::new_owned`でアイコン作成
- 開発モードでもタイトルバーにアイコンが表示されるように対応

### 2026-02-08: 空状態UI改善

#### サイドバー空状態（sidebar-empty-state）
- 「チャプターを追加してください」メッセージの上にPlusCircleIcon（48px）を追加
- flex-direction: columnで縦並びに配置
- アイコンのopacityを0.5に設定

#### グリッド表示空状態
- チャプターがない場合に「ページがありません」メッセージを中央に表示
- spread-viewer-emptyクラスを再利用
- preview-areaにdisplay: flex; flex-direction: columnを追加
- thumbnail-grid-containerにflex: 1; height: 100%を追加

### 2026-02-09: 見開きビューア機能強化・UI改善

#### グリッド切替ボタン変更（App.tsx, icons.tsx）
- 「⊞ グリッド」ボタンのテキストを「単ページ」に変更
- SinglePageIconコンポーネントを新規追加（ドキュメント風アイコン）

#### PSDファイルをPhotoshopで開く機能（SpreadViewer.tsx, open_file.rs）
- spread-info-barのページラベルクリックでポップアップメニュー表示
- 「Photoshopで開く」選択でPSDファイルを外部アプリケーションで開く
- Rustコマンド`open_file_with_default_app`を新規追加
  - Windows: `cmd /C start`
  - macOS: `open`
  - Linux: `xdg-open`

#### 見開き表示のページ位置修正（SpreadViewer.tsx）
- 日本漫画の右綴じ（右から左へ読む）に対応
- spread-info-barの左右ページラベル位置を入れ替え
- 右側に若いページ番号（例: 2p）、左側に大きいページ番号（例: 3p）を表示

#### キーボードナビゲーション（SpreadViewer.tsx）
- 方向キーによるページ移動機能を追加
  - ↓（ArrowDown）: 次のスプレッドへ移動
  - ↑（ArrowUp）: 前のスプレッドへ移動
  - Ctrl+↓: 最後のスプレッドへジャンプ
  - Ctrl+↑: 最初のスプレッドへジャンプ
- ターゲットベースのスクロール同期を実装
  - `isProgrammaticScroll`と`targetSpreadIndex`による状態管理
  - フローティングバーのガクガク動作を解消

#### 削除ボタンホバースタイル（styles.css）
- chapter-itemの削除ボタンにホバー時の赤色背景を追加
- `.btn-icon.btn-delete:hover:not(:disabled)`: 白文字＋エラー色背景

#### Tauriコマンド追加
| コマンド | 説明 |
|---------|------|
| `open_file_with_default_app` | ファイルを既定のアプリケーションで開く |

### 2026-02-10: カスタムウィンドウ装飾・閲覧モード実装

#### カスタムウィンドウ装飾（tauri.conf.json, App.tsx, styles.css）
- ネイティブタイトルバーを削除（`decorations: false`）
- カスタムウィンドウコントロールボタン（最小化、最大化、閉じる）を右上角に固定配置
- ウィンドウドラッグ領域を`data-tauri-drag-region`で設定
- Tauriウィンドウ権限を追加（`core:window:allow-minimize`, `core:window:allow-toggle-maximize`）

#### アプリアイコン表示（App.tsx, styles.css）
- ヘッダー左端にアプリアイコン（24x24px）を追加
- `public/logo/daidori_icon.png`を使用

#### 閲覧モード実装（App.tsx, SpreadViewer.tsx, styles.css, icons.tsx）
- 見開き表示時にモニターアイコンボタンで閲覧モード開始
- F1キーでも閲覧モード開始可能
- UIがフェードアウトし、見開きページを全画面表示
- 右上に×ボタン配置（3秒後に自動非表示、マウス移動で再表示）
- ESCキーまたは×ボタンで閲覧モード終了
- ナビゲーションヒント「escまたは×ボタンで閲覧モード解除」を3秒間表示
- ページがない場合は閲覧モードボタンをグレーアウト

#### ヘッダーレイアウト調整（styles.css）
- main-header-rowにpadding-right: 150pxを追加（ウィンドウコントロール用）
- toolbar-collapse-btnにmargin-right追加
- ボタン角丸調整: viewer-mode-btn（border-radius: 25%）、btn-small（border-radius: 8px）

#### アイコン追加（icons.tsx）
- MonitorIcon: モニター形状（閲覧モード用）
- CloseIcon: ×マーク（閲覧モード終了用）

### 2026-02-11: スプラッシュスクリーン・保存ボタン・UI改善

#### スプラッシュスクリーン（App.tsx, styles.css）
- アプリ起動時に2秒間スプラッシュスクリーンを表示
- Reactコンポーネント方式で実装（showSplash state）
- ロゴ表示: daidori_icon.png（上）+ daidori_logo.png（下）
- #33a4deの枠線、白背景、スケールインアニメーション

#### 保存ボタンをツールバーに移動（App.tsx, styles.css, icons.tsx）
- プロジェクトメニューから「保存」「名前を付けて保存」を削除
- ツールバー右側（エクスポートボタンの左）に保存アイコンボタンを追加
- クリックでドロップダウンメニュー表示（上書き保存、名前を付けて保存）
- SaveIcon（フロッピーディスク型）を新規追加

#### プロジェクトメニュー幅調整（styles.css）
- project-menu-containerの幅を半分に変更（flex: 0.5）
- margin-right: autoで左寄せ

#### チャプター削除確認ダイアログ（App.tsx）
- チャプター内にページがある場合、削除前に確認ダイアログを表示
- 「チャプター内にページがあります。削除してよろしいですか？」
- handleDeleteChapter関数をuseCallbackでメモ化

#### アイコン追加（icons.tsx）
- SaveIcon: フロッピーディスク型（保存ボタン用）
