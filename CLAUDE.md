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
│   ├── App.tsx                    # メインAppコンポーネント (~2,400行)
│   ├── store.ts                   # Zustand状態管理
│   ├── types.ts                   # 型定義
│   ├── icons.tsx                  # アイコンコンポーネント
│   ├── styles.css                 # グローバルスタイル
│   ├── main.tsx                   # エントリーポイント
│   ├── constants/
│   │   └── dnd.ts                 # D&D関連定数
│   ├── hooks/
│   │   ├── useThumbnailQueue.ts   # サムネイルキュー処理
│   │   ├── useWindowCloseHandler.ts # ウィンドウ終了ハンドラ
│   │   └── useKeyboardShortcuts.ts  # キーボードショートカット
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
│   │       ├── recent.rs          # recent files
│   │       ├── open_file.rs       # open_file_with_default_app
│   │       ├── photoshop.rs       # Photoshop共通処理
│   │       ├── tiff.rs            # TIFF変換
│   │       ├── jpeg.rs            # JPEG変換
│   │       └── epub_integration.rs # EPUB_maker連携
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
| `hooks/` | カスタムフック（useThumbnailQueue, useWindowCloseHandler, useKeyboardShortcuts） |
| `constants/` | 定数定義（D&D用ID、並列処理数など） |

### バックエンド (Rust/Tauri)

| モジュール | 説明 |
|-----------|------|
| `types/` | 型定義（FileInfo, ExportPage, ProjectFile等） |
| `cache/` | キャッシュ管理（ディスクキャッシュ、メモリLRUキャッシュ） |
| `thumbnail/` | サムネイル生成（画像処理、PSD対応） |
| `commands/` | Tauriコマンド（folder, export, project, recent, photoshop, tiff, jpeg, epub_integration） |
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

### 2026-02-13: Photoshopボタン・選択解除機能

#### Photoshopで開くボタン（App.tsx, styles.css）
- ツールバーにPhotoshopアイコンボタンを追加
- 選択したPSDファイルをPhotoshopで開く機能
- 複数ファイル選択時は一括で開く
- プロジェクト内にPSDがない場合は無効化
- 選択中のファイルがすべてPSDでない場合も無効化

#### 選択解除機能（App.tsx）
- thumbnail-grid-continuousの余白クリックでページ選択を解除
- thumbnail-wrapper以外の領域をクリックした場合に`selectPage(null)`を実行

#### SpreadViewerからポップアップメニュー削除（SpreadViewer.tsx）
- 見開きビューアのページ情報バークリックでのPhotoshopポップアップを削除
- ツールバーのPhotoshopボタンに機能を統合

#### UIの無効化状態（App.tsx, styles.css）
- チャプターがない場合: サムネイルサイズセレクターを無効化（グレーアウト）
- ページがない場合: 保存ボタンを無効化

#### アイコン追加（icons.tsx）
- ExternalAppIcon: 外部アプリで開くアイコン（矢印付きウィンドウ）

### 2026-02-16: チャプタークリア・ページバー表示切替

#### サムネイルファイル名文字数制限（ThumbnailCard.tsx）
- グリッド表示「大」（180px）の場合、ファイル名を20文字まで表示（従来は15文字）
- 小（100px）: 10文字、中（140px）: 15文字、大（180px）: 20文字

#### すべてクリアボタン（App.tsx, store.ts, styles.css）
- sidebar-footerに「すべてクリア」ボタンを追加
- TrashIconとテキストを表示
- クリック時にTauriのaskダイアログで確認後、全チャプターを削除
- チャプターがない場合はdisabledでグレーアウト
- ホバー時に赤色背景（btn-deleteと同様のスタイル）
- store.tsに`clearChapters`アクションを追加（履歴保存対応でUndo可能）

#### ページバー表示切替機能（App.tsx, SpreadViewer.tsx, icons.tsx）
- 見開きモード時、閲覧モードボタンの右側にページバー表示切替ボタンを追加
- EyeIcon（目）: ページバー表示中
- EyeOffIcon（目斜線）: ページバー非表示中
- フローティングスクロールバー（spread-nav-bar）の表示/非表示を制御
- 設定はlocalStorage（`daidori_pagebar_visible`）に永続化

#### アイコン追加（icons.tsx）
- EyeIcon: 目アイコン（表示状態）
- EyeOffIcon: 目斜線アイコン（非表示状態）

### 2026-02-17: TIFF変換カラーモード自動判定・エクスポートUI改善

#### TIFF変換カラーモード自動判定（tiff_convert.jsx, types/tiff.rs）
- PSDをTIFFに変換する際、元のカラーモードを自動判定
- RGBのPSDはRGBのまま、グレースケールのPSDはグレースケールで出力
- カラーモード選択UIを削除し、自動判定に変更
- 変換結果にカラーモード情報を追加（rgb/grayscale）
- `getColorModeName()`ヘルパー関数を追加

#### エクスポート結果表示改善（App.tsx）
- TIFF変換完了時にカラーモード別の件数を表示
- 例: 「5ファイルをTIFFに変換しました（RGB: 2件、グレースケール: 3件）」

#### エクスポートボタン無効化条件（ExportModal.tsx）
- 「高画質JPGに変換」または「PhotoshopでTIFFに変換」のいずれかが選択されていない場合、エクスポートボタンを無効化（グレーアウト）

#### 破棄ダイアログUIスタイル（App.tsx, styles.css）
- 「変更を破棄しますか？」ダイアログの「破棄する」ボタンを赤背景・白文字に変更
- `.btn-danger`クラスに`color: white`を追加

### 2026-02-25: 見開きビューアUI改善

#### ヘッダーボタン削除（App.tsx, icons.tsx）
- 「リセット」ボタン（ResetIcon）をツールバーから削除
- ResetIconのインポートを削除

#### 見開きビューアのページ選択機能（SpreadViewer.tsx, styles.css）
- 見開きビューアで選択中のページに青い枠（3px、アクセントカラー）を表示
- `selectedPageId` propを追加して選択状態を受け取る
- 閲覧モード中はクリックによる選択を無効化
- ページのホバー効果を削除（クリックで選択する方式に変更）

#### フローティングスクロールバーのスリム化（SpreadViewer.tsx, styles.css）
- トラック幅を24px→12pxに縮小
- ハンドル高さを40px→30pxに縮小
- ハンドル幅を20px→10pxに縮小
- グリップ線の幅を10px→6pxに縮小
- バー位置を右端（right: 0）に変更

#### 見開きビューアのスクロールバー非表示（styles.css）
- spread-viewer-scrollのネイティブスクロールバーを非表示に変更
- Firefox: `scrollbar-width: none`
- Chrome/Safari: `::-webkit-scrollbar { display: none }`
- IE/Edge: `-ms-overflow-style: none`

### 2026-02-26: 複数ページドラッグ&ドロップ・UI簡素化

#### 複数ページドラッグ&ドロップ（App.tsx, store.ts, DragOverlays.tsx）
- Ctrl+クリック/Shift+クリックで複数ページを選択
- 選択したページのいずれかをドラッグすると全選択ページが一緒に移動
- store.tsに`movePages`アクション追加（複数ページ一括移動）
- `draggedPageIds` stateで複数ドラッグ状態を管理
- `handleDragStart`/`handleDragEnd`を複数ページ対応に更新

#### ドラッグ個数バッジ表示（DragOverlays.tsx, styles.css）
- 複数ページドラッグ時に「+N」バッジを表示
- `DragOverlayThumbnail`に`dragCount` propを追加（右上に配置）
- `DragOverlaySidebarItem`に`dragCount` propを追加
- `.drag-count-badge`: アクセントカラー背景、白文字
- `.sidebar-drag-count-badge`: コンパクトなバッジスタイル
- `thumbnail-drag-overlay`を`overflow: visible`に変更（バッジ表示のため）

#### view-mode-toggle削除（App.tsx）
- 「全体/選択中」切替トグルを削除
- 常に全ページ表示モードに固定
- `displayPages`を単純化（常に`allPages`を使用）
- `setViewMode`のimportを削除

### 2026-02-27: TIFF変換処理をCOMIC-Bridgeベースに刷新

#### JSXスクリプト刷新（tiff_convert.jsx）
- COMIC-Bridge TIPPY v2.92ベースの高度な処理パイプラインを導入
- **テキスト/背景分離**: テキストグループ（#text#, text, 写植, セリフ等）を自動検出
- **スマートオブジェクト化**: テキストと背景を個別にスマートオブジェクト化→ラスタライズ
- **ぼかし機能**: 背景のみにガウスぼかし適用（部分ぼかし対応）
- **クロップ機能**: 指定範囲でのトリミング対応
- **カラーモード変換**: RGB/グレースケール自動判定（元がRGBならRGB維持）
- **DPI設定**: モノクロ600dpi、カラー350dpiの自動設定
- **JPG同時出力**: TIFF+JPGの同時出力対応
- **プログレスウィンドウ**: 変換進捗をリアルタイム表示

#### Rust型定義拡張（types/tiff.rs）
- `TiffCropBounds`: クロップ範囲（left, top, right, bottom）
- `TiffPartialBlur`: 部分ぼかし設定（blurRadius, bounds）
- `TiffFileConfig`: 新フィールド追加
  - `apply_blur`: ぼかし適用フラグ
  - `blur_radius`: ぼかし半径
  - `partial_blur`: 部分ぼかし設定
  - `skip_crop`: クロップスキップフラグ
  - `crop_bounds`: クロップ範囲
  - `jpg_output_path`: JPG出力先パス
- `TiffGlobalSettings`: 新フィールド追加
  - `separate_text_and_background`: テキスト/背景分離フラグ
  - `reorganize_text`: テキスト整理フラグ
  - `target_dpi_mono`: モノクロ用DPI（デフォルト600）
  - `target_dpi_color`: カラー用DPI（デフォルト350）
  - `proceed_as_tiff`: TIFF出力フラグ
  - `output_jpg`: JPG出力フラグ
- `TiffConvertResponse`: `jpg_output_dir`フィールド追加

#### Rustコマンド更新（commands/tiff.rs）
- `run_photoshop_tiff_convert`に`jpg_output_dir`引数追加
- JPG出力ディレクトリの重複回避ロジック追加
- 設定JSONの出力パス書き換えロジック改善
- ハートビートベースのタイムアウト制御
  - 初期タイムアウト: 600秒（PS起動待ち）
  - 処理中: タイムアウトなし
  - 完了後: 120秒（結果ファイル待ち）

#### フロントエンド更新（App.tsx）
- invoke呼び出しに`jpgOutputDir`引数追加

#### 新機能の利用方法
設定JSONで以下のオプションを有効化可能:
```typescript
globalSettings: {
  separateTextAndBackground: true,  // テキスト/背景分離
  reorganizeText: true,              // テキスト整理
  flattenImage: true,                // レイヤー統合
  proceedAsTiff: true,               // TIFF出力
  outputJpg: false,                  // JPG同時出力
  targetDpiMono: 600,                // モノクロDPI
  targetDpiColor: 350,               // カラーDPI
}
files: [{
  applyBlur: true,                   // ぼかし適用
  blurRadius: 2.5,                   // ぼかし半径
  cropBounds: { left, top, right, bottom },  // クロップ範囲
}]
```

### 2026-03-09: コードリファクタリング

#### デッドコード削除（App.tsx, store.ts）
- App.tsxから未使用変数を削除: `_currentView`, `_setCurrentView`, `_isNearPreviewTop`, `setIsNearPreviewTop`, `isModifiedRef`
- store.tsから未使用関数`setViewMode`を削除
- App.tsx: 約2,539行 → 約2,389行（-150行）

#### カスタムフック抽出（hooks/）
- **useWindowCloseHandler.ts**: ウィンドウ終了時の未保存確認ダイアログ管理（55行）
  - `isModifiedRef`を使用してクロージャ問題を回避
- **useKeyboardShortcuts.ts**: キーボードショートカット管理（199行）
  - F1（閲覧モード）、Ctrl+N/O/Z/Y、Delete、矢印キーを一元管理
- useDarkMode.ts削除（App.tsxで直接実装済みのため未使用）

#### Photoshop処理の共通化（commands/photoshop.rs）
- tiff.rsとjpeg.rsの重複コードを共通モジュールに抽出（176行）
- `find_photoshop_path()`: Photoshopインストールパス検索
- `find_script_path()`: リソースディレクトリからスクリプトパス検索
- `create_unique_output_dir()`: 出力ディレクトリ作成（連番対応）
- `copy_script_with_bom()`: スクリプトをtempにコピー（UTF-8 BOM付き）
- `get_script_run_path()`: tempスクリプトのフルパス取得
- `write_settings_json()`: 設定JSONをファイルに書き込み
- tiff.rs: 335行 → 211行（-124行）
- jpeg.rs: 290行 → 165行（-125行）

#### エラーログ追加（コード品質改善）
- recent.rs: JSONパースエラー時にログ出力追加
- psd.rs: バイナリパースエラー時にデバッグログ追加

### 2026-04-16: スプラッシュウィンドウ・断ち切りエクスポート・UI改善

#### スプラッシュウィンドウ化（lib.rs, tauri.conf.json, public/splash.html）
- Reactコンポーネント方式のスプラッシュを独立したTauriウィンドウに変更
- `setup`フックでスプラッシュウィンドウをプログラム的に作成（500x400, 装飾なし, 常に最前面）
- メインウィンドウは`visible: false`で起動し、React準備完了後に`close_splash`コマンドで表示
- スプラッシュは2秒間表示後にメインウィンドウへ切り替え
- React側のスプラッシュCSS・state・JSXを削除

#### 断ち切り（ブリード）エクスポート機能（BleedEditorModal.tsx, App.tsx, tiff_convert.jsx, jpeg_convert.jsx）
- PSDファイルを含むチャプターのエクスポート時に断ち切り範囲設定エディタを表示
- Tachimiアプリ準拠のガイドライン方式クロップエディタ:
  - 上・左ルーラーからドラッグでガイド線を作成
  - ガイドをロックした後、画像上でドラッグして選択範囲を設定（ガイドにスナップ）
  - ガイドはドラッグで移動、ダブルクリックで削除
- 表紙（cover）と本文（chapter）で別々の断ち切り範囲を設定可能
- エクスポートフロー: ExportModal → BleedEditorModal（表紙） → BleedEditorModal（本文） → エクスポート実行
- 「スキップしてエクスポート」で断ち切りなしでも直接エクスポート可能
- tiff_convert.jsx / jpeg_convert.jsx にマージン方式crop処理を追加（`isMargin`フラグ対応）
- get_image_dimensions コマンドをPSDファイル対応に拡張
- Photoshop変換時に非PSDページ（白紙、JPEG等）も同じ出力先にエクスポート

#### エクスポートモーダル改善（ExportModal.tsx）
- リネームモードでもエクスポートボタンが有効に（変換チェック不要に）

#### ページ選択トグル（App.tsx, SpreadViewer.tsx）
- 選択中のページを再度クリックで選択解除（グリッド・サイドバー・見開き表示すべて対応）

#### ページジャンプ機能（SpreadViewer.tsx, styles.css）
- 見開き表示時にCtrl+Jでページジャンプダイアログを表示
- ページ番号入力で該当する見開きへジャンプ

#### アイコン追加（icons.tsx）
- LockIcon: 錠前アイコン（ガイドロック用）
- UnlockIcon: 解錠アイコン（ガイドロック解除用）

#### 新規コンポーネント
| コンポーネント | 説明 |
|--------------|------|
| `components/modals/BleedEditorModal.tsx` | 断ち切り範囲設定エディタ（ガイドライン方式） |

#### Tauriコマンド追加・変更
| コマンド | 説明 |
|---------|------|
| `close_splash` | スプラッシュウィンドウを閉じてメインウィンドウを表示 |
| `get_image_dimensions` | PSDファイルのサイズ取得に対応（psdクレート使用） |

#### Rust型変更
- `TiffFileConfig.crop_bounds`: `Option<TiffCropBounds>` → `Option<serde_json::Value>`（追加フィールド透過対応）
- `JpegFileConfig.crop_bounds`: 新規追加（`Option<serde_json::Value>`）

### 2026-04-16: UI統合・見開きビューア刷新・EPUB表示統合

#### app-mode-toggle廃止・preview-mode-toggle統合（App.tsx, store.ts, types.ts）
- `AppMode`型・`APP_MODE_LABELS`定数・`appMode` storeを完全削除
- `preview-mode-toggle`に「リスト | 見開き | EPUB」の3モードを統合
- 「単ページ」→「リスト」に文言変更、`SinglePageIcon`→`GridViewIcon`（2x2角丸四角アイコン）に変更
- EPUB切替時に`loadEpubFromDaidori()`を毎回実行し、chapters変更時も自動同期（useEffect）

#### EPUB表示のサイドバー・ツールバー統合（EpubMakerView.tsx, EpubMetadataPanel.tsx）
- EPUB表示時のサイドバーを台割モードと共通化（チャプターリストサイドバーを共有）
- EPUB独自のサイドバー（`epub-sidebar`）・ツールバー（`epub-toolbar`）・CSSエディタモーダルを削除
- `epub-metadata-scroll`ラッパーを削除（`sidebar-content`がスクロールを担当）
- EpubMakerViewをプレビューエリアのみのシンプルなコンポーネントに整理

#### 見開きビューアのステートベース化（SpreadViewer.tsx）
- スクロール方式からステートベース方式に全面書き換え（現在のスプレッドのみ表示）
- IntersectionObserver・スクロールイベント追跡・`isProgrammaticScroll`を削除
- `currentSpreadIndex`で現在のスプレッドを管理し、`navigateToSpread`でindexを更新

#### ページバー横配置・右始まり（SpreadViewer.tsx, EpubSpreadPreview.tsx, styles.css）
- `spread-nav-bar`を縦配置（右端）から横配置（下部）に変更
- ハンドルを右始まりに変更（日本式右綴じ対応、ratio反転）
- ドラッグ/クリック計算を`clientY`→`clientX`に変更

#### ページ情報バー上部移動（SpreadViewer.tsx, styles.css）
- `spread-info-bar`（ページラベル）を見開き画像の下から上に移動
- `spread-number-label`を`spread-info-bar`の中央に統合
- 右ページ情報を左端、左ページ情報を右端に配置（右綴じ対応）

#### キーボードナビゲーション統一（SpreadViewer.tsx, EpubSpreadPreview.tsx, useKeyboardShortcuts.ts）
- 方向キーを上下から左右に変更（←で進む、→で戻る）
- 見開き・EPUBモード時は左右キーを`useKeyboardShortcuts`からSpreadViewer/EpubSpreadPreviewに委譲
- 統一ショートカット: ←/→（前後移動）、Ctrl+←/→（先頭/末尾）、Home/End、Ctrl+J（ジャンプ）、Ctrl+0（ズームリセット）、ESC（閲覧モード終了）

#### ズーム機能（App.tsx, SpreadViewer.tsx, EpubSpreadPreview.tsx, icons.tsx）
- ツールバーにズームイン/アウトボタン追加（`ZoomInIcon`/`ZoomOutIcon`新規作成）
- リスト表示時はグレーアウト、見開き・EPUB時のみ操作可能
- Alt+ホイールでポインター位置に向かってズームイン/アウト（MojiQ準拠のアルゴリズム）
- `panOffset` stateでポインター位置固定のためのtranslateオフセットを管理
- Ctrl+0で100%・パンオフセットリセット
- EpubSpreadPreviewの内蔵ズームコントロール（`epub-zoom-control`）を削除し共通化

#### EPUB表示の閲覧モード・ページバー非表示（EpubSpreadPreview.tsx, EpubMakerView.tsx）
- EPUB表示にも閲覧モード（閉じるボタン・ナビヒント・ESC終了）を実装
- ページバー非表示ボタンを実装
- 閲覧モード時はサムネイルバー・ページラベル・ページ選択を非表示

#### EPUB表示のページジャンプ（EpubSpreadPreview.tsx）
- Ctrl+Jでページジャンプダイアログを表示（SpreadViewerと同一UI）
- キーイベントを`document`レベルで処理（ダイアログ表示中もCtrl+Jを確実にpreventDefault）

#### EPUB見開き・サムネイル右綴じ対応（styles.css）
- `epub-spread-pages`に`flex-direction: row-reverse`を追加
- `epub-thumbnail-scroll`に`flex-direction: row-reverse`を追加

#### ヘッダー・ツールバーレイアウト刷新（App.tsx, styles.css）
- `preview-mode-toggle`・`zoom-controls`・`thumbnail-size-selector`・`theme-toggle-btn`を`main-header-row`に移動
- `main-header-row`を`justify-content: space-between`→`gap: 8px`（左揃え）に変更
- 各グループ間に`header-divider`（縦区切り線）を配置
- レイアウト順: プロジェクト名 | 表示切替 | サムネイルサイズ | ズーム | テーマ切替

#### toolbar-content共通化（App.tsx）
- リスト・見開き・EPUB全モードで同一のtoolbar-contentを表示
- エクスポート・EPUB生成・閲覧モード・ページバーボタンを常時表示（リスト時は閲覧モード等をグレーアウト）
- `toolbar-right-actions`ラッパーを削除し全ボタンをフラットに配置

#### ボタンスタイル統一（styles.css）
- エクスポート・EPUB生成ボタンを閲覧モードボタンと同じ枠線アイコンスタイルに統一（32x32px、`border: 1px solid`、`border-radius: 25%`）
- EPUB生成ボタンからテキスト「EPUB」を削除しアイコンのみに
- Photoshopボタンのアイコンを画像から太字「Ps」テキストに変更、`Photoshop_icon.png`を削除

#### EPUB選択改善（EpubMakerView.tsx, App.tsx）
- 選択中のページを再クリックで選択解除
- PhotoshopボタンがEPUBモードの選択にも対応（`epubSelectedPageId`/`epubPages`を参照）

#### 不要CSS削除（styles.css）
- `app-mode-toggle`/`app-mode-btn`関連CSS削除
- `epub-maker-view`/`epub-sidebar`/`epub-metadata-panel`（コンテナ部分）/`epub-metadata-scroll`/`epub-main-area`/`epub-empty-state`/`epub-toolbar`/`epub-zoom-control`/`epub-spread-nav`関連CSS削除
- 対応するライトモードオーバーライドも削除

#### アイコン変更（icons.tsx）
- `SinglePageIcon`→`GridViewIcon`（2x2角丸四角）に変更
- `ZoomInIcon`（虫眼鏡+）・`ZoomOutIcon`（虫眼鏡-）を新規追加

### 2026-04-16: ハンバーガーメニュー・ドロップダウン刷新・綴じ方向・UIカラー統一

#### ハンバーガーメニュー追加（App.tsx, styles.css, icons.tsx）
- ヘッダーのアプリアイコン右、ツールバー折りたたみボタンの左にハンバーガーメニューボタンを追加
- 左からスライドインする280px幅のポップアップメニュー（MojiQ Pro準拠）
  - ヘッダー: 「メニュー」タイトル + 閉じるボタン
  - ボディ: 将来の拡張用（空）
  - フッター: サイドバー反転（FlipIcon）・ダーク/ライト切替（Sun/MoonIcon）・環境設定（SettingsIcon）の3ボタン
- オーバーレイクリック・Escキーでメニュー閉じ
- 閲覧モード時はメニュー非表示
- ヘッダーからテーマ切替ボタンを削除（メニューに移動）

#### サイドバー位置反転（App.tsx, styles.css）
- `isSidebarFlipped` state追加（localStorage永続化、キー: `daidori_sidebar_flipped`）
- `body.sidebar-flipped .preview-container`に`flex-direction: row-reverse`
- サイドバーのborder方向を反転

#### ドロップダウンをカスタムポップアップメニューに変更（App.tsx, styles.css, icons.tsx）
- ネイティブ`<select>`を廃止し、MojiQ Pro準拠の吹き出し型ポップアップメニューに置換
- 3つのドロップダウン: 表示（リスト/見開き/EPUB）、サイズ（小/中/大）、綴じ方向（右綴じ/左綴じ）
- 各メニュー: ヘッダー + アイコン付き項目 + 選択中チェックマーク
- トリガーボタンにアイコン + テキスト + シェブロン（展開時に180°回転）
- `openDropdown` stateで3メニューを排他制御、外側クリックで閉じ

#### 綴じ方向切替機能（App.tsx, SpreadViewer.tsx, EpubSpreadPreview.tsx, EpubMakerView.tsx, EpubThumbnailBar.tsx, styles.css）
- `bindingDirection` state追加（`'rtl' | 'ltr'`、デフォルト`'rtl'`、localStorage永続化）
- 右綴じ/左綴じでページペアリング・DOM順序・CSS flex-direction・キーボードナビゲーション・スクロールバー位置を切替
- 右綴じ: ←で進む(+1)、→で戻る(-1) / 左綴じ: →で進む(+1)、←で戻る(-1)
- `.spread-pair.ltr`・`.epub-spread-pages.ltr`・`.epub-thumbnail-scroll.ltr`で`flex-direction: row`

#### プロジェクトメニュー削除（App.tsx, styles.css）
- `project-menu-container`のJSX・state・ref・関数・useEffect・CSSをすべて削除
- 削除対象: `isEditingProjectName`, `editingProjectName`, `isProjectMenuOpen`, `recentFiles`, `projectMenuRef`, `projectNameInputRef`, `startEditingProjectName`, `confirmProjectNameEdit`, `cancelProjectNameEdit`, `handleOpenRecentFile`, `loadRecentFiles`

#### ダークモードカラーをMojiQ Pro準拠に変更（styles.css, types.ts）
- 紫系カラーパレットからニュートラルグレー系に全面変更
- 主要変更: `--color-bg-primary: #1e1e1e`, `--color-bg-secondary: #2c2c2c`, `--color-bg-tertiary: #3c3c3c`, `--color-bg-hover: #4c4c4c`
- テキスト: `--color-text-primary: #f6f6f6`, `--color-text-secondary: #aaaaaa`, `--color-text-muted: #777777`
- アクセント: `--color-accent: #0078d4`（Microsoft blue）
- ボーダー: `--color-border: #444444`, `--color-border-light: #555555`
- types.tsのハードコード色もCSS変数と統一（`PAGE_TYPE_COLORS`, `CHAPTER_TYPE_COLORS`）
- 表紙カラー: `#ff7a7a` → `#c62828`（濃い赤）
- Photoshopボタン「Ps」の色を`--color-text-secondary`に統一
- ライトモード: チャプターバッジ文字色を白に設定

#### UI改善（App.tsx, styles.css, ChapterItem.tsx, icons.tsx）
- リスト表示のページクリック判定を`.thumbnail-wrapper`→`.thumbnail-card`に修正（グラデーション部分のクリックが反応しない問題を修正）
- ツールバー折りたたみボタンの`margin-right`を削除（ハンバーガーボタンとの間隔に統一）
- 空状態メッセージに`NoPageIcon`（紙に斜線）を追加
- 空状態メッセージを「ページがありません。チャプターを追加してください」に変更
- サイドバー空状態メッセージを「チャプターをここで追加」に変更
- チャプター折りたたみアニメーション追加（`grid-template-rows`トランジション、0.25s ease）

#### アイコン追加（icons.tsx）
- `HamburgerIcon`: 3本線メニューアイコン
- `FlipIcon`: サイドバー反転アイコン（`isFlipped` prop対応）
- `SettingsIcon`: 歯車アイコン
- `BindingRightIcon`: 右綴じアイコン
- `BindingLeftIcon`: 左綴じアイコン
- `CheckIcon2`: チェックマークアイコン
- `NoPageIcon`: 紙に斜線アイコン（ページなし）
- `GridViewIcon`・`BookOpenIcon`を再利用（ドロップダウン表示用）

#### コンポーネント構造変更（ChapterItem.tsx）
- チャプターページリストの条件レンダリングを常時レンダリング + CSSクラスに変更
- `.chapter-pages-outer`（gridコンテナ）→`.chapter-pages`（overflow制御）→`.chapter-pages-inner`（padding）の3層構造

### 2026-04-17: デッドコード削除・リファクタリング

#### 未使用アイコン削除（icons.tsx: 777行→596行）
- 9個の未使用アイコンを削除: `SaveIcon`(後で復元), `BooksIcon`, `CheckIcon`, `HomeIcon`, `ChevronUpIcon`, `ChevronDownIcon`, `ChevronsUpIcon`, `ChevronsDownIcon`, `ExternalAppIcon`

#### 未使用CSS削除（styles.css: -約100行）
- 未使用クラス削除: `.app-layout`, `.app-title`, `.home-btn`系, `.btn-export`系, `.btn-export-floating`系, `.add-special-btn`系, `.chapter-pages-footer`, `.thumbnail-grid`
- 未使用CSS変数削除: `--color-text-accent`, `--color-chapter`, `--color-blank`, `--color-intermission`, `--header-height`, `--thumbnail-size`

#### 未使用インポート削除（main.tsx）
- `import _React from "react"` を削除

#### Rust clippy警告修正（9件→0件）
- `types/epub.rs`: 5つの手動Default impl → `#[derive(Default)]` + `#[default]`
- `commands/export.rs`: range loop → イテレータ
- `commands/tiff.rs`, `commands/jpeg.rs`: `% 60 == 0` → `.is_multiple_of(60)`
- `epub/templates.rs`: 同一分岐のif-else削除

#### App.tsx大関数リファクタリング（2776行→1871行）
- `hooks/useDragHandlers.ts`(361行): DnDハンドラ4関数 + DnD状態を抽出
- `hooks/useExport.ts`(553行): エクスポート処理全体 + 断ち切りエディタ状態を抽出
- `hooks/useTauriFileDrop.ts`(123行): Tauriファイルドロップリスナーを抽出

#### 新規フック
| フック | 説明 |
|-------|------|
| `hooks/useDragHandlers.ts` | DnD: sensors, customCollisionDetection, handleDragStart/Over/End, DropTarget型 |
| `hooks/useExport.ts` | エクスポート: handleExport, handlePreExport, bleedEditor状態管理 |
| `hooks/useTauriFileDrop.ts` | Tauriファイルドロップイベントリスナーのグローバル設定 |

### 2026-04-17: 致命的バグ修正

#### Critical修正
- **保存機能の実装**: `handleSaveProject`/`handleSaveProjectAs`関数追加、Ctrl+S/Ctrl+Shift+Sショートカット、ツールバー保存ボタン、未保存ダイアログに「保存」ボタン追加
- **コマンドインジェクション修正**: `open_file.rs`の`cmd /C start`を`tauri_plugin_opener`に置換
- **アトミック保存**: `project.rs`のfs::writeを一時ファイル→sync→リネームに変更
- **moveモードエクスポート安全化**: `export.rs`でエクスポート完了後にまとめて元ファイル削除

#### High修正
- **Undo/Redo後の選択状態クリア**: `store.ts`のundo/redoでselectedPageId等をnullに
- **複数フォルダからのファイルドロップ対応**: フォルダごとにget_folder_contentsを呼び出し
- **Photoshop変換のasync修正**: `std::thread::sleep`→`tokio::time::sleep().await`
- **Photoshop変換のタイムアウト追加**: `u64::MAX`→30分上限
- **Ctrl+O未保存時の動作修正**: pendingOpenPath必須条件を除去

#### CSS修正
- `.chapter-item`に`flex-shrink: 0`追加（フレックスレイアウトによるページ追加エリア圧縮を防止）

### 2026-04-17: バックエンド最適化

#### 画像サイズ取得の最適化（export.rs, epub.rs）
- PSD: `fs::read`+`Psd::from_bytes`（全ファイル読み込み）→ PSDヘッダ26バイトのみ読み取り
- 非PSD: `image::open`（全画像デコード）→ `image::image_dimensions`（ヘッダのみ）
- 白紙ページのサイズ取得: `HashMap`にサイズキャッシュを事前構築（重複デコード排除）

#### エクスポートのrayon並列化（export.rs）
- 逐次ループ → 3フェーズ構造: サイズキャッシュ構築→タスク収集→rayon並列実行
- `ExportTask` enum: CopyFile, ConvertToJpg, GenerateBlank, GenerateBlankJpg
- `tokio::task::spawn_blocking`でUIスレッドをブロックしない

#### PSDサムネイル生成のmmap化（psd.rs）
- `fs::read`（Vec<u8>に全コピー）→ `memmap2::Mmap`（OSがアクセス部分のみページイン）
- 埋め込みサムネイルがあればファイル先頭の数KBのみアクセス

#### 依存関係追加
- `memmap2 = "0.9"` (Cargo.toml)

### 2026-04-17: 保存機能削除

#### 保存ボタン・保存関連機能の完全削除（App.tsx）
- ツールバーの保存ボタン（`SaveIcon` + `handleSaveProject`）を削除
- `handleSaveProject` / `handleSaveProjectAs` / `buildProjectFile` 関数を削除
- 未保存変更確認ダイアログ（`showUnsavedDialog`）と `handleUnsavedDialogAction` を削除
- ウィンドウ終了時の未保存確認（`handleWindowClose`）を削除
- 関連state削除: `showUnsavedDialog`, `pendingAction`, `pendingOpenPath`
- `handleNewProject` を単純に `resetProject()` を呼ぶだけに簡略化
- 未使用import削除: `save` (`@tauri-apps/plugin-dialog`), `SaveIcon`, `SavedChapter`, `SavedPage`, `SavedFileReference`, `useWindowCloseHandler`, `isModified`, `currentProjectPath`

#### キーボードショートカット整理（hooks/useKeyboardShortcuts.ts）
- `Ctrl+S` / `Ctrl+Shift+S`（保存・名前を付けて保存）ショートカットを削除
- `Ctrl+O` から未保存確認の分岐を除去し、直接 `handleOpenProject()` を呼ぶ形に
- `UseKeyboardShortcutsOptions` から `isModified`, `setPendingAction`, `setShowUnsavedDialog`, `onSave`, `onSaveAs` を削除

#### useWindowCloseHandler 削除
- `src/hooks/useWindowCloseHandler.ts` をファイルごと削除
- `src/hooks/index.ts` からエクスポートを削除

#### 備考
- store側の `isModified` / `markAsSaved` / `currentProjectPath` / `lastSavedAt` はプロジェクト読み込み時の状態設定に引き続き使用（`handleOpenProject` 内で `markAsSaved(openPath)` を呼ぶ）
- 保存機能は完全に削除されたため、`save_project` Tauriコマンドは現状呼び出されないがバックエンド側には残存（将来復活時に備えて保持）

### 2026-04-17: PSDガイド対応・白紙チャプター・白紙形式連動

#### PSD内蔵ガイド線の読み取り・表示（commands/epub.rs, lib.rs, BleedEditorModal.tsx）
- 新規Tauriコマンド `read_psd_guides(path)` を追加（`commands/epub.rs`）
  - PSDイメージリソースセクションを走査し、リソースID 1032（Grid and guides information）をパース
  - `PsdGuide { type: "h"|"v", position: u32 }` の配列を返す
  - location は 1/32 px で格納されているため 32 で除算して実ピクセル座標に変換
  - direction: 0 = vertical line (`"v"`), 1 = horizontal line (`"h"`)
  - 非PSDファイル・ガイドなしPSD・パース失敗はすべて空Vecを返す（エラー扱いしない）
- BleedEditorModalが開かれた時、PSDファイルなら `read_psd_guides` を呼び出し、Photoshopで作成されたガイド線を自動表示

#### ロック時の選択範囲自動検出（BleedEditorModal.tsx）
- `toggleLock` を拡張：ガイドロック時に H方向2本以上 + V方向2本以上あれば、外側のガイドペアで囲まれた矩形を選択範囲として自動確定
- `autoDetected` state を追加。自動検出時は専用ヒント文「ガイドから自動検出しました — 画像上をドラッグして調整も可能です」を表示
- 手動ドラッグで選択範囲を上書きするとフラグがクリアされ、通常ヒントに切り替わる

#### 白紙チャプターの自動ページ化（store.ts）
- `addChapter` で `type === 'blank'` の場合のみ白紙ページ1枚を初期配置
- エクスポート時に既存の blank ハンドラが隣接ページサイズ（なければ A5 350dpi デフォルト）で白紙画像を生成

#### 白紙出力形式の変換モード連動（commands/export.rs, useExport.ts）
- `export_pages` コマンドに `blank_format: Option<String>` 引数を追加
  - 指定があれば白紙ページの出力拡張子として優先使用（JPG変換フラグ・隣接ページext より上位）
  - `.jpg`/`.jpeg` は既存の `GenerateBlankJpg` タスク（JpegEncoder）で生成
  - それ以外（`.tif` など）は `GenerateBlank` タスク（`image::save()` で拡張子から自動判別）で生成
  - `image` クレートの `tiff` feature が有効なので TIFF 白紙も生成可能
- useExport.ts でモード別に `blankFormat` を指定:
  - TIFF変換モード: `blankFormat: 'tif'`
  - PhotoshopでJPEG変換モード: `blankFormat: 'jpg'`
  - 通常エクスポート（コピー/JPG変換）: 未指定（従来動作を維持）

#### 新しい型定義
```rust
#[derive(Serialize)]
pub struct PsdGuide {
    #[serde(rename = "type")]
    pub guide_type: String, // "h" or "v"
    pub position: u32,       // 元画像ピクセル座標
}
```

#### Tauriコマンド追加・変更
| コマンド | 説明 |
|---------|------|
| `read_psd_guides` | PSDファイル内のガイド線情報を読み取る（リソースID 1032） |
| `export_pages` | `blank_format` 引数を追加（白紙ページの出力形式を明示的に指定可能） |

### 2026-04-20: 断ち切り話ごと対応・見開き/EPUBレイアウト刷新・白紙対応

#### 断ち切り設定「一括／話ごと」モード追加（ExportModal.tsx, useExport.ts, App.tsx）
- `BleedSettings` に `mode: 'bulk' | 'per-chapter'` と `perChapter?: Record<chapterId, BleedMargins>` を追加
- `ExportOptions.bleedMode` を新設し、ExportModal で「一括断ち切り／話ごと」のラジオを表示（Photoshop変換選択時かつPSDあり時のみ）
- `useExport` の状態をキュー駆動に刷新: `BleedQueueItem[]` + `currentIndex` で順次処理
  - bulk モード: 表紙 + 本文の2ステップ
  - per-chapter モード: 表紙 + 話チャプターごとのPSD
- `resolveMargins()` で chapterId ベースの断ち切り適用。話ごとでは非話チャプターは先頭話の値をフォールバック
- App.tsx: `BleedEditorModal` を2個ハードコードから1個のキュー駆動レンダリングへ変更（`key` でステップ遷移時リマウント）
- サムネイル未生成PSDは `ensureThumbnail()` ヘルパーで on-demand 生成
- 「ガイドをロック／ロック解除」→「ガイドを確定／確定解除」に文言変更

#### エクスポート結果ダイアログUI改善（styles.css）
- `.export-result-dialog .btn-epub` の上書き: テキスト付きボタン（「EPUBを生成」）のため `width/height: auto`、`border-radius: 8px` で他の `.btn-small` と同じ形状に統一

#### サムネイル未生成対策（App.tsx）
- `previewMode === 'spread' || 'epub'` のとき、全ファイルページの `thumbnailStatus === 'pending'` を検出して `queueThumbnail` を先行投入
- チャプター並び替え後に未閲覧ページの画像が表示されない問題を解消

#### 表紙チャプターの1ファイル制限（store.ts）
- `addPagesToChapter` / `addPagesToChapterAt`: cover chapter では残り枠（1 - 既存ページ数）に制限
- `movePage` / `movePages`: 他チャプターから cover へ純増移動する場合、合計2ページ以上になる操作をブロック

#### 見開きビューアのレイアウト刷新（SpreadViewer.tsx, styles.css）
- 表紙チャプター（`chapter.type === 'cover'`）のページは単独スプレッドとして処理
  - RTL: `left` スロット（視覚的に左側）、LTR: `right` スロットに配置
  - 対向側は `spread-page-hidden` クラスで完全透明＋不可視サイザーでサイズだけ保持
- `renderPage(item, side, sibling)` の `sibling` 引数導入: 空スロットや白紙特殊ページで相手画像を不可視サイザーとして埋め込み、同サイズに揃える
- 終端の単ページ（odd count）は `spread-page-blank` を白背景→点線枠の透明空ページに変更
- ファイル無しの特殊ページ（白紙）は `spread-special-wrapper` で兄弟サイザーを埋め込み同サイズ表示、白紙は背景色を `white` に固定
- `spread-info-bar` の RTL ラベル順を修正: `row-reverse` により視覚左=`currentSpread.left`、視覚右=`currentSpread.right` となるためDOM順も合わせて入れ替え
- `getPageLabelName()` ヘルパーで白紙ページは「白紙」と表示

#### EPUBビューのレイアウト刷新（EpubSpreadPreview.tsx, EpubMakerView.tsx, EpubThumbnailBar.tsx, store.ts, types.ts, styles.css）
- `EpubPageInfo` に `isBlank?: boolean` と `originalChapterType?: ChapterType` を追加
- `loadEpubFromDaidori`: 白紙ページをプレビュー用に含める（`isBlank: true`, `sourcePath: ''`）。EPUB生成側（`handleEpubGenerate`）は独自の配列構築のため出力には含まれない
- `renderEpubPage(page, side, sibling)` ヘルパー導入で SpreadViewer と同じ構造に統一
  - 空スロット: `epub-spread-page-hidden`（表紙対向）/ `epub-spread-page-blank`（点線空枠）
  - 白紙ページ: `epub-spread-page-blankcontent`（白背景＋破線枠＋「白紙」ラベル）
  - 通常画像: `originalChapterType` ベースのバッジ表示（話／表紙／白紙／幕間／奥付）
- 表紙単独スプレッドは RTL で `slot1`（視覚的左側）に配置し、対向に非表示スロットを描画
- サムネイルバー:
  - `isBlank` ページの画像表示を「白紙」点線枠 div に差し替え（空 `sourcePath` 読み込み失敗を防止）
  - `Math.floor(index/2)` ベースから、表紙単独を考慮した `pageToSpread` マップに変更
- EpubMakerView `handleSelectPage`: 同じマッピングで右ページクリック時のスプレッド誤ジャンプを修正

#### 白紙チャプター専用ボタン（ChapterItem.tsx）
- 白紙チャプター（`chapter.type === 'blank'`）では「ページを追加」を非表示にし、代わりに「白紙を追加」ボタンを表示。クリックで `onAddSpecialPage('blank')` を呼び白紙ページを末尾追加

#### 型定義追加
- `EpubPageInfo.isBlank?: boolean`
- `EpubPageInfo.originalChapterType?: ChapterType`
- `BleedSettings.mode: 'bulk' | 'per-chapter'`
- `BleedSettings.perChapter?: Record<string, BleedMargins>`
- `BleedMode = 'bulk' | 'per-chapter'`

### 2026-04-20: チャプター差し替え・ページ挿入簡素化・ファイル検証アラート

#### チャプターページ差し替えボタン（ChapterItem.tsx, App.tsx, store.ts, icons.tsx）
- `cover` / `chapter` / `intermission` チャプターのヘッダー削除ボタン左に循環矢印アイコンの差し替えボタンを追加
- クリック時: 既存ページがあれば `ask()` ダイアログで確認 → フォルダ選択 → `get_folder_contents` で画像ファイル一括取得 → チャプター内ページを全置換
- 新規store アクション `replacePagesInChapter(chapterId, files)` を追加（`saveHistory()` で Undo 対応、cover は 1 ファイルに制限）
- `ReplaceIcon`（循環矢印 SVG）を `icons.tsx` に新規追加
- `@tauri-apps/plugin-dialog` から `ask` を import

#### page-add-btn メニュー簡素化（SortablePageItem.tsx, ChapterItem.tsx, App.tsx）
- ページ横の「+」ボタンのメニューを「表紙／白紙／幕間／奥付」4項目から「白紙／ファイル」2項目に削減
- 「ファイル」選択時: ファイル選択ダイアログ（`multiple: false`）で1ファイル選択 → 該当位置の次に挿入
- 新規ハンドラ `handleInsertFile(chapterId, afterPageId)` を App.tsx に追加（`addPagesToChapterAt` を再利用）
- `SortablePageItem` / `ChapterItem` に `onInsertFile` prop を追加

#### ファイル検証機能（commands/project.rs, types/project.rs, lib.rs, store.ts, types.ts, App.tsx）
- 作業中プロジェクトのページ参照ファイルを定期検証し、移動・リネーム・日時変更を検出
- 新規Rustコマンド `validate_pages(pages)` を追加（`commands/project.rs`）
  - 入力: `Vec<PageCheckInput { page_id, file_path, modified_time, file_size }>`
  - 出力: `Vec<PageCheckResult { page_id, status }>`（`ok` / `missing` / `modified`）
  - ファイル存在確認 + メタデータの modified_time 比較による軽量検証
- `Page.fileValidationStatus?: FileValidationStatus` (`'ok' | 'missing' | 'modified'`) をフロントエンド型に追加
- 新規store アクション `updatePagesValidation(results)` で一括反映（履歴には含めない）
- 検証トリガー: マウント時 + window `focus` イベント（他アプリでファイル編集後に戻ってきたタイミングで自動再検証）

#### 赤アラートバッジ表示（SortablePageItem.tsx, ThumbnailCard.tsx, SpreadViewer.tsx, EpubSpreadPreview.tsx, EpubThumbnailBar.tsx, styles.css）
- `fileValidationStatus !== 'ok'` のページに赤い `AlertTriangleIcon` を表示
- サイドバー: ページ名の横にインラインで表示
- サムネイルグリッド: サムネイル右上に赤丸バッジ
- 見開きビューア: 画像右上に28pxの赤丸バッジ（閲覧モード中は非表示）
- EPUB見開き: 同上
- EPUBサムネイルバー: 小型（16px）の赤丸バッジ
- tooltip で理由を区別: `missing`=「ファイルが見つかりません」 / `modified`=「ファイルが変更されています」

#### 黄色差し替えボタン（各コンポーネント + styles.css）
- 赤アラートの横に黄色（`#facc15`）の差し替えボタンを併置
- アイコンはチャプター差し替えと同じ `ReplaceIcon`（循環矢印）で統一
- クリックでファイル選択ダイアログ → `setPageFile` を呼び出しページの参照を置換
- 既存の `handleSelectFile(pageId)` を全箇所で再利用
- `setPageFile` を更新し、新ファイル設定時に `fileValidationStatus: 'ok'` を即座にセット（アラートが即消え）
- `ThumbnailCard` / `SpreadViewer` / `EpubSpreadPreview` / `EpubThumbnailBar` / `EpubMakerView` に `onReplaceFile` prop を追加

#### EpubPageInfo への検証状態伝播（types.ts, store.ts）
- `EpubPageInfo.fileValidationStatus?: FileValidationStatus` を追加
- `loadEpubFromDaidori` で台割側の `page.fileValidationStatus` を epubPage にコピー
- chapters 変更時の自動 EPUB 再構築により、検証状態が常に最新

#### Tauriコマンド追加
| コマンド | 説明 |
|---------|------|
| `validate_pages` | ページのファイル参照を軽量検証（移動/リネーム/日時変更を検出） |

#### 新規/変更アイコン
- `ReplaceIcon`: 循環矢印（チャプター差し替え・ページ差し替え共通）
- `AlertTriangleIcon`: 既存利用（ファイル検証アラート用）

#### 新規CSSクラス（styles.css）
- `.page-file-alert` / `.page-file-replace-btn`: サイドバー用
- `.thumbnail-alert-group` / `.thumbnail-file-alert` / `.thumbnail-file-replace-btn`: サムネイルグリッド用
- `.spread-alert-group` / `.spread-file-alert` / `.spread-file-replace-btn`: 見開き・EPUB見開き用
- `.epub-thumb-alert-group` / `.epub-thumb-file-alert` / `.epub-thumb-file-replace-btn`: EPUBサムネイルバー用
- `.spread-page-content` / `.epub-spread-page` / `.epub-thumbnail-image` に `position: relative` を追加

#### 型定義追加
- `FileValidationStatus = 'ok' | 'missing' | 'modified'`
- `Page.fileValidationStatus?: FileValidationStatus`
- `EpubPageInfo.fileValidationStatus?: FileValidationStatus`
- Rust: `PageCheckInput`, `PageCheckResult`

### 2026-04-20: COMIC-Bridge互換 メタデータ差異検知・情報サイドバー・紙サイズ判定

#### カラーモード/サイズ/DPI差異検知（commands/project.rs, types/project.rs, types.ts, store.ts, App.tsx, utils/validationMessage.ts）
- `validate_pages` Rustコマンドを大幅拡張: 既存の存在/日時チェックに加えて画像メタを抽出
  - PSD: ヘッダ24-25バイト目から色モード(0=Bitmap, 1=Grayscale, 2=Indexed, 3=RGB, 4=CMYK, 7=Multichannel, 8=Duotone, 9=Lab)、リソースID 1005から水平DPI(16.16固定小数の上位16ビット)、ヘッダから幅高さ
  - 非PSD: `image::ImageReader` で `dimensions()` と `color_type()` を取得（フルデコード回避）。ColorType を Grayscale/RGB に正規化
  - rayon `par_iter()` で並列化（pre-existing rayon依存を活用）
- `PageCheckResult` に `width: Option<u32>`, `height: Option<u32>`, `color_mode: Option<String>`, `dpi: Option<u32>` を追加
- `FileValidationStatus` に `'meta_error' | 'size_mismatch' | 'color_mismatch' | 'dpi_mismatch'` を追加
- `Page` / `EpubPageInfo` に `imageWidth` / `imageHeight` / `imageColorMode` / `imageDpi` を追加
- `ImageColorMode` 型と `ValidationContext` / `ValidationGroupContext` 型を新設
- `store.ts` の `updatePagesValidation` を再設計:
  - シグネチャ拡張: `{ pageId, status, width?, height?, colorMode?, dpi? }[]` を受け取る
  - 私的ヘルパー `applyMismatchStatuses(chapters)` を追加: cover チャプターと それ以外で別グループに分けて最頻値を計算
  - 各項目（color/size/dpi）独立に最頻値判定。値が `None` のページは判定対象外（DPIなしの非PSDは無視）
  - 単一値しかないグループ・全件同一値のグループは検出しない（false positive 回避）
  - 優先順位: `missing > modified > meta_error > size_mismatch > color_mismatch > dpi_mismatch > ok`
  - `validationContext` state に最頻値情報を保持（tooltip 表示用）
- `loadEpubFromDaidori` で台割側の `imageWidth/imageHeight/imageColorMode/imageDpi` を `EpubPageInfo` に引き継ぎ
- `App.tsx` の検証 useEffect を拡張:
  - invoke 戻り値型を新仕様に
  - `useStore.subscribe` で `chapters` の `filePath/modifiedTime` 変化を fingerprint 比較で検出 → debounce 300ms で自動再検証

#### tooltip メッセージ統一ヘルパー（utils/validationMessage.ts 新規）
- `getValidationMessage(page, context, chapterType)` を新設
- `Page` と `EpubPageInfo` 両方を受け入れる最小インターフェース `ValidatablePage` で受け取る
- mismatch 系では「このページ: X / 多数派: Y」を併記。カラーモードは日本語ラベル化
- 5つのUIコンポーネント（SortablePageItem, ThumbnailCard, SpreadViewer, EpubSpreadPreview, EpubThumbnailBar）の tooltip を本ヘルパー経由に置換
- `ChapterItem` から `chapterType` を `SortablePageItem` に伝播

#### サイズドロップダウン廃止（App.tsx）
- ヘッダーのサムネイルサイズドロップダウン（小/中/大切替UI）を完全削除
- `setThumbnailSize` のimport、`sizeDropdownRef`、`openDropdown` の `'size'` リテラル、`refs` 内の `size` エントリを削除
- デフォルトは中（`thumbnailSize: 'medium'`）。store 側の初期値・読込時のフォールバックは現状維持

#### 右側 情報サイドバー追加（App.tsx, styles.css）
- `preview-container` 内 preview-area の右に `<aside className="sidebar sidebar-right">` を追加
- 左サイドバーと同じ `--sidebar-width` 共有・同じ `sidebar-toggle-btn` で展開/格納
- `isInfoSidebarCollapsed` state（localStorage `daidori_info_sidebar_collapsed` で永続化、デフォルト展開）
- 表示内容: サムネイル(aspect-ratio 3/4) + ファイル名 + メタ表（サイズ/カラーモード/解像度/形式/ファイルサイズ/チャプター）
- 未選択時は「ページを選択するとここに情報が表示されます」プレースホルダ
- `selectedPageInfo` を `useMemo` で `allPages` から導出
- サイドバー反転（`body.sidebar-flipped`）にも追従するよう border 左右を切替
- トグルボタンは右サイドバーでは `flex-start`（左端）に配置 → 左サイドバーと鏡像配置
- `.sidebar-content` に `transition: opacity` を追加し、左右両方で展開/格納時にコンテンツが滑らかにフェード
- 矢印は `«`/`»` を反転で表現（折りたたみ時 `«`、展開時 `»`）

#### グリッド右側余白の縮小（styles.css）
- `.preview-area` padding-right: `var(--spacing-xl)` (24px) → `var(--spacing-sm)` (8px)
- `.preview-area` margin-right: `var(--spacing-md)` (12px) → `var(--spacing-xs)` (4px)
- `.thumbnail-grid-continuous` padding-right: `var(--spacing-lg)` (16px) → `var(--spacing-xs)` (4px)
- 右側合計約32px節約 → 中サイズサムネイル(140px)+gap(8px)が1列追加で収まる

#### 紙サイズ判定とサイズ行併記（utils/paperSize.ts 新規, App.tsx, styles.css）
- 新規ユーティリティ `src/utils/paperSize.ts`:
  - `pixelsToMm(pxW, pxH, dpi)`: ピクセル→mm 変換
  - `findPaperSize(wMm, hMm, tolerance=6)`: 短辺/長辺で正規化して規格と一致判定（±6mm = 塗り足し3mm相当を吸収）
  - `describePhysicalSize(pxW, pxH, dpi?)`: 「B4（257×364mm）相当 ／ 実寸 W×H mm」形式の文字列を返す。DPIなしなら null
  - 規格テーブル: A3, A4, A5, A6, B3, B4, B5, B6, 新書判(112×174), 四六判(127×188)
- 情報サイドバーのサイズ行に `.info-meta-sub` 副表示を追加（`describePhysicalSize` の結果を表示）
  - PSD（DPI取得可）: 規格名+実寸を併記
  - 非PSD（DPIなし）: ピクセルのみ表示にフォールバック
  - 規格外サイズ: 実寸のみ表示
- `.info-meta-sub` を 11px（`--font-size-xs`）・`--color-text-muted` で控えめに表示

#### Tauriコマンド変更
| コマンド | 変更内容 |
|---------|---------|
| `validate_pages` | 戻り値に `width`/`height`/`color_mode`/`dpi` を追加。rayon並列化 |

#### 新規ファイル
| ファイル | 説明 |
|---------|------|
| `src/utils/validationMessage.ts` | 検証ステータス→tooltip文言生成ヘルパー（PageとEpubPageInfo両対応） |
| `src/utils/paperSize.ts` | ピクセル+DPI→規格紙サイズ判定（A/B系列+新書判+四六判） |

#### 新規CSSクラス（styles.css）
- `.sidebar-right` / `.sidebar-right .sidebar-header` / `.sidebar-right.collapsed .sidebar-header`
- `.info-panel` / `.info-thumbnail` / `.info-thumbnail-empty` / `.info-filename` / `.info-meta` / `.info-meta-sub` / `.info-panel-empty`
- `.sidebar-content` に `transition: opacity` を追加

#### 型定義追加
- `FileValidationStatus`: `'meta_error' | 'size_mismatch' | 'color_mismatch' | 'dpi_mismatch'` を追加
- `ImageColorMode = 'RGB' | 'Grayscale' | 'CMYK' | 'Bitmap' | 'Indexed' | 'Multichannel' | 'Duotone' | 'Lab'`
- `Page.imageWidth/imageHeight/imageColorMode/imageDpi`
- `EpubPageInfo.imageWidth/imageHeight/imageColorMode/imageDpi`
- `ValidationGroupContext` / `ValidationContext`
- Rust: `PageCheckResult` に `width/height/color_mode/dpi` を追加

### 2026-04-20: カラーモードサマリーバー・UI改善・ダイアログアイコン

#### カラーモードサマリーバー（App.tsx, ThumbnailCard.tsx, EpubMakerView.tsx, styles.css）
- preview-area 上端に貼り付く形でカラーモードサマリーを追加（グリッド・見開き・EPUB 3モード共通表示）
- 検出対象: モノクロ（Bitmap）/ グレー（Grayscale）/ RGB / CMYK の4種（件数0のバッジは非表示）
- 各バッジはスウォッチ色・ラベル・件数を表示
- **ホバー時の挙動**:
  - 該当カラーモード以外のサムネイルカードが `opacity: 0.25` でdim表示（グリッドのみ）
  - バッジ直下に該当ファイル名一覧のツールチップを表示（縦スクロール・最大320px）
- **タイマーベースの遅延消去**: `hoverCloseTimerRef` で180ms遅延後に消去、バッジ・ツールチップのどちらに再入しても `cancelHoverClose` でキャンセル
- **トグル折りたたみ機能**:
  - `toolbar-collapse-btn` と同じ28×28アイコンボタン（SVG chevron、折りたたみ時180°回転）
  - localStorage `daidori_color_summary_expanded` に永続化
- **preview-area への貼り付け**:
  - 負マージン（top/left/right）で preview-area の padding を相殺
  - `position: sticky; top: calc(var(--spacing-xl) * -1)` でスクロール中も上端に固定
  - `border-bottom` のみで preview-area との境界を表示

#### 検証ロジック調整（store.ts）
- `applyMismatchStatuses` の優先順位は `size_mismatch > color_mismatch > dpi_mismatch` のまま維持
- カラーモード差異はサマリーバー + dim で視覚的に明示する方式に変更

#### ThumbnailCardホバー時ガクガク修正（ThumbnailCard.tsx, styles.css）
- 旧: `.thumbnail-card:hover { transform: translateY(-4px) scale(1.02) }` によりカード下端でホバー解除が連続発火
- 新: `transform-origin: center bottom` + `transform: scale(1.04)` に変更（下端固定で上方向に膨張）
- `isDimmed` prop追加（親から `hoveredColorMode` に応じて指定）、`.dimmed` クラスで opacity制御

#### 見開きビューア画像サイズ調整（styles.css）
- `.spread-pair .spread-thumbnail` の `max-height: 70vh → 66vh`
- カラーモードサマリーバー追加分のスペースを考慮しつつ、ページバーとの間隔が開きすぎないよう微調整

#### 右情報サイドバー: EPUB対応（App.tsx）
- `selectedPageInfo` を `previewMode === 'epub'` 分岐で拡張
- EPUB時は `epubSelectedPageId` → `epubPages` → `originalPageId` 経由で台割 `Page` を解決
- 依存配列に `previewMode` / `epubPages` / `epubSelectedPageId` を追加

#### ダイアログタイトルアイコン（ExportModal.tsx, EpubMetadataModal.tsx, styles.css）
- エクスポートモーダル: `ExportIcon` をタイトル左に追加
- EPUB生成モーダル: `BookIcon` をタイトル左に追加
- `.modal-header h2` を `display: inline-flex; align-items: center; gap` に変更

#### EpubMakerViewの拡張（EpubMakerView.tsx）
- `topBar?: ReactNode` prop追加: preview-area先頭にレンダリング
- カラーモードサマリーバーをApp.tsxから渡して3モード共通表示を実現

#### 新規CSSクラス（styles.css）
- `.color-mode-summary-container` / `.color-mode-summary` / `.color-mode-badge` / `.color-mode-swatch` / `.color-mode-label` / `.color-mode-count`
- `.color-mode-badge-tooltip` / `.color-mode-badge-tooltip-item`
- `.thumbnail-card.dimmed`

#### 型定義追加
- `ThumbnailCard`: `isDimmed?: boolean` prop
- `EpubMakerViewProps`: `topBar?: ReactNode` prop
- `ExportOptions.bleedMode: BleedMode`

### 2026-04-21: EPUB閲覧モード拡張・リンク更新・情報サイドバー最適化・新規チャプター作成ドロップ削除

#### F1閲覧モードの対象拡大（hooks/useKeyboardShortcuts.ts）
- F1 トグルが `previewMode === 'spread'` だけでなく `previewMode === 'epub'` でも動作するよう条件拡張

#### EPUB画像表示サイズ拡大（styles.css）
- 通常時: `.epub-spread-page img` と各種 sizer の `max-height: 60vh → 80vh`、`max-width: 40vw → 46vw`
- ガター高さも `60vh → 80vh` に合わせて拡大
- 閲覧モード時の EPUB ルール（`body.viewer-mode .epub-spread-page img` 他）を新規追加し `max-height: 95vh / max-width: 48vw` で全画面化
- EPUB の `.spread-nav-bar` は共通クラスのため既存 viewer-mode ルールで自動非表示

#### 閲覧モード時のレイアウト調整（styles.css）
- `body.viewer-mode .preview-area` に `padding: 0 / margin: 0 / border: none / border-radius: 0 / justify-content: center / align-items: center` を追加し、画像を画面中央に配置
- `body.viewer-mode .color-mode-summary-container { display: none }` を追加し閲覧モード時はカラーモードサマリーを非表示

#### リンク更新機能（InDesign風）
- [handleRefreshFile(pageId)](src/App.tsx) を新設: ページの `filePath` を再読込して `get_folder_contents` → `setPageFile` で更新（サムネイル再生成・メタデータ更新・`fileValidationStatus: 'ok'` 復帰）
- `SidebarNewChapterDropZone` の使用箇所3つ（EpubMakerView / SpreadViewer / ThumbnailCard）の `onReplaceFile` を `handleSelectFile` → `handleRefreshFile` に切替
- [SortablePageItem.tsx](src/components/sidebar/SortablePageItem.tsx) に `onRefreshFile` prop を追加。[ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx) 経由でバケツリレーし、App.tsx から `handleRefreshFile` を注入
- 黄色の差し替えボタンは `fileValidationStatus === 'modified'` のときのみ表示（従来の `!== 'ok'` → `=== 'modified'`）。対象: SortablePageItem / ThumbnailCard / SpreadViewer / EpubSpreadPreview / EpubThumbnailBar の全5箇所
- tooltip 文言: 「ファイルを選択して差し替え」→「リンクを更新」

#### EPUB表紙サイズの統一（components/epub/EpubSpreadPreview.tsx, styles.css）
- 表紙単独スプレッドで本文ページと同じ `max-height: 80vh / max-width: 46vw`（閲覧モード時 `95vh / 48vw`）を適用
- 表紙スロットと非表示サイザー両方が同じ制約になるため、flex レイアウトがコンテナ幅を均等分割 → 見開き2ページ時の片ページと同じ幅に揃う

#### 情報サイドバー展開・格納アニメーションの最適化（styles.css）
- `.sidebar-content` に `width: var(--sidebar-width) / min-width: var(--sidebar-width) / box-sizing: border-box / overflow-x: hidden / scrollbar-gutter: stable` を追加
- サイドバー折り畳み時も内部コンテンツは 320px 固定幅のまま。`.sidebar { overflow: hidden }` が余剰部分をクリップするだけで、画像リサイズ・aspect-ratio 再計算・メタデータ再レイアウトが走らない
- 画像選択時の右サイドバー挙動が左サイドバーと同じ軽さに揃う

#### ファイル選択+差し替えボタンの発動ボタン種別変更
- `modified` のみ黄色ボタン表示（missing / meta_error / 各種 mismatch ではアラートアイコンのみ）
- クリックは picker ではなく `handleRefreshFile` によるリンク更新

#### ページドラッグで新規チャプター作成する機能を削除
- [App.tsx](src/App.tsx): サイドバー先頭・末尾の `<SidebarNewChapterDropZone>` を撤去、import も削除
- [useDragHandlers.ts](src/hooks/useDragHandlers.ts): `handleDragOver` / `handleDragEnd` の `new-chapter-start` / `new-chapter-end` 判定と処理を削除、`DropTarget` 型からも除去。`addChapter` / `selectChapter` 引数も不要になり削除
- [ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx): ローカル `DropTarget` 型から該当 variant を削除
- [DropZones.tsx](src/components/dnd/DropZones.tsx): `NewChapterDropZone`・`SidebarNewChapterDropZone` コンポーネントを削除
- [components/dnd/index.ts](src/components/dnd/index.ts): 対応するエクスポート削除
- [constants/dnd.ts](src/constants/dnd.ts): `NEW_CHAPTER_DROP_ZONE_ID` / `NEW_CHAPTER_DROP_ZONE_START_ID` / `SIDEBAR_NEW_CHAPTER_DROP_ZONE_ID` / `SIDEBAR_NEW_CHAPTER_DROP_ZONE_START_ID` 定数を削除
- 外部ファイルドロップ時の start/end 新規チャプター作成ゾーン（file drop フロー）は別機能として残存

#### UI微調整（App.tsx）
- カラーモードサマリートグルの tooltip を「カラーモードサマリーを折りたたむ/展開」→「カラーモードを非表示/表示」に変更

#### 新規関数
| 関数 | 説明 |
|------|------|
| `handleRefreshFile(pageId)` | 同じファイルパスを再読込してメタデータ・サムネイルを更新（InDesign の「リンクを更新」相当） |

#### 型定義変更
- `DropTarget.type` から `'new-chapter-start' | 'new-chapter-end'` を削除
- `UseDragHandlersParams` から `addChapter` / `selectChapter` を削除
- `SortablePageItem` props に `onRefreshFile: (pageId: string) => void` を追加
- `ChapterItem` props に `onRefreshFile: (pageId: string) => void` を追加

### 2026-04-26: dev.bat自動セットアップ・ADチャプター・UI/UX整理 (v1.0.5)

#### dev.bat の自動 npm install（dev.bat）
- `node_modules\.bin\tauri.cmd` の存在チェックを追加し、未インストール時は自動で `npm install` を実行してから `npm run tauri dev` を起動
- `npm install` 失敗時は exit code 1 で終了

#### ADチャプタータイプ追加（types.ts, store.ts, App.tsx, ChapterItem.tsx）
- `ChapterType` に `'ad'` を追加し、`CHAPTER_TYPE_LABELS.ad = 'AD'`、`CHAPTER_TYPE_COLORS.ad = '#f59e0b'`（オレンジ）を登録
- `getDefaultChapterName` の `case 'ad'` でデフォルト名を「AD」に
- chapter-actions-bar に「+AD」ボタンを追加（奥付ボタンの右）
- ChapterItem の差し替え対応条件に `'ad'` を追加し、フォルダ差し替えボタンを表示（`'cover' | 'chapter' | 'intermission' | 'ad'`）

#### chapter-actions-bar 3列グリッド化（styles.css）
- `display: flex; flex-wrap: wrap` → `display: grid; grid-template-columns: repeat(3, 1fr)` に変更し、6ボタン（表紙/白紙/話/幕間/奥付/AD）を 3列×2行に
- `.chapter-actions-bar > .btn-secondary` で `width: 100%; min-width: 0` 指定
- `margin-bottom` を削除して上下余白を `padding: var(--spacing-sm) 0` のみで対称化

#### 情報サイドバー空状態のアイコン追加（icons.tsx, App.tsx, styles.css）
- `InfoIcon`（円の中に「i」）を新規追加
- `info-panel-empty` のメッセージ上に48pxのInfoIconを表示
- `flex-direction: column; gap: var(--spacing-md)` で縦並びに、アイコンは `opacity: 0.5`

#### 複数選択時 selection-bar をフロート化（App.tsx, styles.css）
- toolbar-content 内にあった `selection-bar` を preview-area 内（colorModeSummaryBar 直後）に移動
- 新規 `.selection-bar-floating` クラス: `position: sticky; top: var(--spacing-md); align-self: flex-end; z-index: 10`
- `background: var(--color-bg-secondary) + box-shadow + backdrop-filter: blur(8px)` でコンテンツとの視認性確保
- `margin-bottom: -spacing-md` で下方向の余白を相殺

#### 削除確認ダイアログの拡張（App.tsx）
- `deleteConfirmDialog.type` に `'pages'` を追加
- selection-bar の削除ボタンを即時削除→確認ダイアログ起動に変更
- 「ページ削除」「選択中の N ページを削除しますか？」を表示し、確定時に `removeSelectedPages()` を実行

#### キーボードショートカット削除（hooks/useKeyboardShortcuts.ts, App.tsx）
- **Ctrl+Z（取り消し）と Ctrl+Y / Ctrl+Shift+Z（やり直し）** を削除
  - useKeyboardShortcuts の引数・依存配列から `undo` / `redo` を除去
  - App.tsx の useStore 取り出しと hook 呼び出しからも除去
  - 削除確認ダイアログの「この操作は取り消せます（Ctrl+Z）」案内文も削除（store側の `undo` / `redo` 関数本体は残置）
- **Ctrl+O（プロジェクトを開く）** を削除
  - useKeyboardShortcuts の引数・依存配列から `handleOpenProject` を除去
  - 呼び出し元が無くなった `handleOpenProject` 関数本体・関連 dead code（`missingFiles` state・欠落ファイルダイアログ・`loadFromProjectFile`・未使用 import: `DaidoriProjectFile` / `FileValidationResult` / `PageType` / `ThumbnailSize` / `AlertTriangleIcon` / `markAsSaved` / `loadProjectState`）も削除

#### 見開き・EPUB の複数選択対応（store.ts, SpreadViewer.tsx, EpubSpreadPreview.tsx, EpubThumbnailBar.tsx, EpubMakerView.tsx, App.tsx）
- store に `epubSelectedPageIds: string[]` と `toggleEpubPageSelection` / `selectEpubPageRange` / `clearEpubPageSelection` を追加
  - `setEpubSelectedPageId(id)` は `epubSelectedPageIds` も同期（`id ? [id] : []`）
  - `loadEpubFromDaidori` / `resetEpubState` で `epubSelectedPageIds: []` を初期化
- SpreadViewer / EpubSpreadPreview / EpubThumbnailBar に `selectedPageIds?: string[]` prop を追加し、選択判定を `selectedPageId === id || selectedPageIds.includes(id)` に拡張
- `onPageSelect` / `onSelectPage` のシグネチャに `MouseEvent` を追加し、`Ctrl/Cmd+クリック` → toggle、`Shift+クリック` → range、通常クリック → 単一選択（再クリックで解除）に
- App.tsx の SpreadViewer onPageSelect ハンドラと EpubMakerView の handleSelectPage で修飾キーを処理
- Photoshopボタン: EPUBモード分岐を `epubSelectedPageIds` 対応に更新（複数PSDの一括起動可・tooltip に件数表示）

#### ラベル変更
- 「Ad」表記を「AD」に統一（types.ts: CHAPTER_TYPE_LABELS / store.ts: getDefaultChapterName / App.tsx: chapter-actions-bar ボタン）

#### 新規アイコン
| アイコン | 説明 |
|---------|------|
| `InfoIcon` | 円の中に「i」（情報） |

#### 新規CSSクラス（styles.css）
- `.selection-bar-floating`: 複数選択バーの右上スティッキー表示
- `.info-panel-empty svg`: 空状態アイコン用の opacity 制御

#### 型定義変更
- `ChapterType` に `'ad'` 追加
- `CHAPTER_TYPE_LABELS` / `CHAPTER_TYPE_COLORS` に `ad` エントリ追加
- store interface に `epubSelectedPageIds: string[]`、`toggleEpubPageSelection` / `selectEpubPageRange` / `clearEpubPageSelection` を追加
- `SpreadViewer` / `EpubSpreadPreview` / `EpubThumbnailBar` props に `selectedPageIds?: string[]`
- `onPageSelect` / `onSelectPage` のシグネチャに `MouseEvent` を追加
- `deleteConfirmDialog.type` に `'pages'` を追加

### 2026-04-27: CSP修正（PSDサムネイル表示バグ）・DevTools有効化・ドラッグオーバーレイ簡素化

#### 本番ビルドでPSDサムネイルが表示されないバグ修正（src-tauri/tauri.conf.json）
- 症状: インストール済みアプリ（リリースビルド）でPSDファイルを読み込ませると、サムネイルがすべて壊れた画像アイコン+altテキストになる
- 原因: CSPが Tauri 2 の `http://asset.localhost`（Windows）を許可していなかった。旧CSPは `https://asset.localhost` のみ許可、`connect-src` も未指定で `default-src 'self'` フォールバックにより IPC `http://ipc.localhost` までブロックされていた
- DevToolsコンソールに `Loading the image '<URL>' violates the following Content Security Policy directive: "img-src 'self' asset: <URL> data: blob:"` および `Connecting to 'http://ipc.localhost/...' violates the following CSP directive: "default-src 'self'"` が記録されていた
- 修正後CSP:
  ```
  default-src 'self' ipc: http://ipc.localhost;
  connect-src 'self' ipc: http://ipc.localhost;
  img-src 'self' asset: http://asset.localhost https://asset.localhost data: blob:;
  style-src 'self' 'unsafe-inline'
  ```
- 副次的に IPC のpostMessageフォールバック（`IPC custom protocol failed, Tauri will now use the postMessage interface instead`）も解消

#### 本番ビルドでDevTools有効化（src-tauri/Cargo.toml）
- リリースビルドのデバッグ用に `tauri` クレートに `devtools` フィーチャーを追加
- `tauri = { version = "2", features = ["protocol-asset", "devtools"] }`
- これによりインストール済みアプリでも F12 / Ctrl+Shift+I / 右クリック「検証」でDevToolsが開くようになる

#### ドラッグオーバーレイのシンプル化（src/styles.css）
- カーソル位置とドラッグカードの位置関係を直感的にするため、視覚エフェクトを大幅削減してCSS translateで右側固定に
- `.thumbnail-drag-overlay` / `.sidebar-drag-overlay` / `.chapter-drag-overlay` 3クラス共通の変更:
  - **削除**: `rotate()` / `scale()` / `animation`（thumbnailDragAppear, dragOverlayAppear, chapterDragAppear, shimmerSlide, badgeGlow）/ `backdrop-filter` / 複雑なグラデーション・複数レイヤーのアクセントglow
  - **追加**: `transform: translate(100%, 0)` — カードの自身の幅まるごと右にシフト
- 結果: ドラッグ中のカードはカード幅分以上カーソルの右に表示される（カーソル位置にカードの左辺が来るのを上限に、カード全体が必ず右側）
- `.chapter-drag-overlay::before`（光が流れるアニメーション疑似要素）と `.chapter-drag-overlay .chapter-type-badge` の `badgeGlow` アニメーションも削除
- 背景は `var(--color-bg-secondary)` 単色、影は `var(--shadow-lg)` のみ、枠線 `1px solid var(--color-accent)` で統一
