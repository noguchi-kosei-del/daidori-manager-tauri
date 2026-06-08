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
- 対応フォーマット: **JPG, PNG, PSD, TIFF, PDF**（PDFは取り込み時に全ページを350dpiでJPEG化）
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
- `.daiw` 形式での保存/読込
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

## プロジェクトファイル形式 (.daiw)

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

### 2026-06-08: v1.7.0 工程タブ型UIへの刷新

UIを「工程タブ型」に再設計。上部タブで **台割 / 断ち切り / 出力** の3工程に分け、左の台割ツリー（チャプター/ページ編集）は全工程で常駐、中央＋右パネルがタブで切り替わる。

#### 状態管理
- `store.ts` に `activeTab: 'compose' | 'bleed' | 'output'` と `setActiveTab` を追加（`resetProject` でも 'compose' にリセット）。
- 新規 `src/bleedStore.ts`（Zustand）: 断ち切り設定をセッション内で保持し、断ち切りタブ⇄出力タブ⇄PDF生成で共有。**`.daiw` には永続化しない**。`getBleedSettings()` が出力時の `BleedSettings` を構築。新規/プロジェクト読込時に `reset()`。

#### 台割タブ（旧 リスト/見開き）
- `previewMode` を `'grid' | 'spread'` に縮小（`'epub'` を削除）。リスト/見開きは台割タブ内の見方トグルに降格。
- 左サイドバー（台割ツリー）は `previewMode !== 'epub'` 条件を撤廃し全工程で常駐。
- 色/サイズ/dpi 不一致サマリ（`colorModeSummaryBar`）は台割タブ中央に常設（クリックで該当ページへジャンプ）。

#### 断ち切りタブ（新規 `src/components/bleed/BleedTab.tsx`）
- 出力直前の強制リニアキュー（旧 `useExport` の `handlePreExport`/`startTachimiBleed`/`currentIndex`）を廃止。
- 一括/本文ごとの対象を一覧表示し、任意の対象で `BleedEditorModal` を開いて編集→`bleedStore` に保存。`BleedEditorModal` に `applyLabel`/`skipLabel`/`initialRegion`（既存設定の復元）を追加。

#### 出力タブ（新規 `src/components/output/OutputTab.tsx`）
- 旧3入口（ツールバーの JPEG/TIF生成・PDF生成、表示モードのEPUB）を1タブに統合。行き先カードで **JPG／TIFF / EPUB / PDF** を選択。
- JPG／TIFFは `ExportModal` を `embedded` で埋め込み（断ち切り設定ラジオは非表示＝断ち切りタブ管轄）。EPUBは `EpubMakerView`＋`EpubMetadataModal embedded`。PDFは `bleedStore` の断ち切りを適用して `generate_tachimi_chapter_pdfs`。
- 出力時の断ち切りは `bleedStore.getBleedSettings()` を `handleExport`/PDF生成へ注入（`resolveBleedRegion`/`buildProcessOptions`/`resolveTiffCropBounds` は不変で流用）。Rust呼び出しのpayloadは無改修。

#### ExportModal の出力形式を3択ラジオ化
- 「JPEGに変換」「TIFFに変換」の独立チェックボックスを廃し、**そのままコピー（変換なし）/ JPEGに変換 / TIFFに変換** の排他ラジオに。「変換なしコピー＆リネーム」（全TIFF集約フラット化を含む）が明示的な選択肢に。旧「リネームして保存」チェックは廃止し常時リネーム前提（生成は出力先指定で有効）。

#### UI配置の整理（コントロールの文脈化）
- ヘッダーを1段に。グローバルヘッダーは「アイコン／メニュー／工程タブ／ウィンドウ操作」のみ。2段目ツールバー・折りたたみボタンを廃止。
- ビュー固有操作はビューア内へ移設。新規 `src/components/preview/ViewerOverlay.tsx`（綴じ方向・ズーム・閲覧モード）を見開き(SpreadViewer)とEPUBプレビュー(EpubMakerView)に重ね、`.viewer-canvas:hover` で出現。ページバー表示切替もビューア下部にホバー出現。
- リスト/見開きトグルはヘッダーから台割中央へ（`compose-center` で sticky な整えるバーと重ならないよう非スクロール行に配置）。出力タブも `output-center` で行き先バーを非スクロール行化。
- Photoshopで開くボタンはツールバーから情報パネル上部へ（選択が全PSDのとき表示）。
- ハンバーガーの空動作だった「設定」ボタンを削除。
- 断ち切りタブ右サマリに折りたたみトグルを追加し他工程と統一。見開きビューで選択ページの該当スプレッドへ自動移動。EPUBプレビューでも整えるバーを表示。F1閲覧モードは `allowViewer`（台割見開き or 出力）で判定。

#### バージョン
- `package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` を `1.7.0` に更新。

#### 検証
- `npm run build` 成功 / `cargo check` 成功（Rust無改修・Cargo.lock追従）。

#### 追補（同v1.7.0: 出力UI/ダイアログ/断ち切りの精緻化）
- 出力タブ JPG/TIFF: 出力形式を**中サイズカード**（原本/JPG/TIFF、色付きバッジ）で先に選ぶ構成に。コピー/移動は「そのままコピー」選択時のみ表示（変換系では原本コピーが成立しないため `useEffect` で `exportMode='copy'` に固定）。各選択肢にアイコン＋選択チェック＋ホバー演出。出力先フォルダは生成ボタン直前に移動。見出しにアイコン（フォルダ/コピー/書き出し/ペン）。`form-group input{width:100%}` がラジオに効いて点が中央化する不具合を `input[type=radio/checkbox]{width:auto}` で打ち消し。2カラムの区切り線（`.form-section` の border-top）を埋め込み時は撤去。
- 出力タブ PDF: 全ページをチャプター順に並べた**サムネイル一覧プレビュー**＋下部に区切った青い生成バー（EPUBのCTAと同形・中央文言・右に大ボタン）。
- 上部バー統合: JPG/TIFF・PDFの「チャプター/ページ・断ち切り」サマリを色サマリ（グレー/B4）と同じ帯の右側へ。
- EPUB: 作成ウィザード(`EpubWizard`)の中央プレビュー全体表示（画像が実領域高さに収まるよう高さチェーン修正）、上部バーにビューア操作を重ね、閲覧モードでの付帯UI/余白を解除。タイトル初期値に既定名「新規プロジェクト」を入れずプレースホルダ表示。CTA文言を中央配置。
- ダイアログ刷新: `modal-content`/ヘッダー/進捗のグラデ地を廃しフラット化。状態アイコンを円バッジで統一（成功=緑/警告=琥珀/危険=赤/処理中=中央スピナー）。EPUB生成・PDF取り込み・チャプターPDF生成を同一の進捗ダイアログに統一し、**チャプターPDFの進捗を完了ダイアログから分離**（独立表示）。完了/確認ダイアログの端への密着を共通余白(28px)で解消。
- 断ち切りタブ: 範囲設定を全画面モーダルから**中央＋右パネルがその場で切り替わるインライン表示**に（`BleedEditorModal` に `embedded`）。`createPortal` で `document.body` 直下に描画し、transform 祖先による `position:fixed` の閉じ込め（上端見切れ）を解消。「断ち切りなし」を明示設定したら**設定済み**として扱う（null=未設定と区別）。黒ベタ等でトンボが見えない時のために、同一対象の別ページへ送れる**ページ送り**を右パネルに追加（2ページ以上で表示、選択範囲は保持）。
- 工程タブ（台割/断ち切り/出力）にアイコンを追加。

### 2026-06-04: v1.5.9 UI/EPUB/プロジェクト保存まわりの改善

#### バージョン
- `package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` を `1.5.9` に更新。

#### プロジェクトファイル
- プロジェクト保存・読込の拡張子を `.daiw` に統一。
- ヘッダーの新規ボタンを削除し、開く/保存ボタンをサイドバー下部の `chapter-actions-bar` 下に配置。
- プロジェクト読込後の完了ダイアログを表示しないように変更。
- ハンバーガーメニュー内の `hamburger-project-section` を削除。

#### サイドバー/UI
- `chapter-actions-bar` とプロジェクト操作ボタンの間に区切り線を追加し、余白を調整。
- `project-sidebar-actions` 下部の余計な区切り線を削除。
- アプリ全体で入力欄以外のテキスト選択を抑止し、ドラッグ操作時にUIテキストが選択されないように変更。
- 表示切替をトグルスイッチから従来のドロップダウン形式へ戻した。

#### EPUB表示/生成
- EPUB表示下部のページリストを削除。
- 見開き表示とEPUB表示で、通常のマウスホイールによるページ移動に対応。Alt+ホイールのズーム操作は維持。
- EPUB生成情報を左揃えにし、文字サイズを少し大きく調整。チャプター数/総ページ数/形式の値は青字に変更。
- EPUB生成モーダルのキャンセルボタンを削除。
- 必須項目が入力されるまでEPUB生成ボタンを無効化するように変更。

#### エクスポート/Photoshop
- JPEG/TIF生成ボタンをEPUB生成と同じ青枠/青文字スタイルへ変更。
- Photoshop検出に `Adobe Photoshop 2026` を追加し、`C:\Program Files\Adobe` / `C:\Program Files (x86)\Adobe` 配下の `Adobe Photoshop*` 自動探索にも対応。
- エクスポート画面を開くたびにPhotoshop検出を再実行するように変更。

#### リンク変更検知
- 同名ファイル差し替え時にも検出できるよう、ファイル参照検証で更新日時に加えてファイルサイズも比較。
- 黄色背景・黒字 `!` バッジの試験実装は意図した挙動に合わなかったため削除し、既存の通常アラート表示へ戻した。

#### 検証
- `npm run build` 成功。
- `cargo check` 成功。

### 2026-05-25: `.daiw`プロジェクト保存復帰・保存UI整理・リンク変更検知強化

#### プロジェクト保存/読込（App.tsx）
- InDesignの`.indd`相当のプロジェクトファイルとして、台割状態を`.daiw`ファイルに保存/読込できるようにした。
- `save_project` / `load_project` TauriコマンドをReact側から利用し、チャプター、ページ、特殊ページ、ファイル参照、選択状態、サムネイルサイズ、折りたたみ状態を保存/復元する。
- 保存時はプロジェクトファイルの親フォルダを`basePath`として持ち、画像ファイル参照は絶対パスと相対パスの両方を保存する。
- 読込時は保存済みファイル参照からページを復元し、サムネイルは`pending`に戻して再生成できる状態にする。
- 未保存変更のスナップショット比較を追加し、終了時に「保存して終了」「保存せず終了」を選べるようにした。
- `Ctrl+S`で保存、`Ctrl+Shift+S`で名前を付けて保存、`Ctrl+O`でプロジェクトを開くショートカットを追加した。
- プロジェクト読込成功時の「プロジェクトを開きました」完了ダイアログは表示しない仕様に変更した。

#### 拡張子変更
- プロジェクトファイル拡張子を`.daidori`から`.daiw`へ変更した。
- 保存ダイアログのデフォルト拡張子、自動付与、開くダイアログのフィルタを`.daiw`に統一した。
- ドキュメント上のプロジェクトファイル形式表記も`.daiw`へ更新した。

#### 保存UI配置（App.tsx, styles.css）
- ヘッダーのプロジェクト操作ボタンから「新規」を削除し、最終的に「開く」「保存」もサイドバー下部へ移動した。
- `chapter-actions-bar`直下に`project-sidebar-actions`を追加し、「開く」「保存」を二列で配置した。
- `chapter-actions-bar`と`project-sidebar-actions`の間に区切り線を追加し、チャプター追加ボタン群の上部余白を約半分に調整した。
- `project-sidebar-actions`下部の余計な区切り線を削除し、合計ページ数エリアとの間隔を詰めた。
- ハンバーガーメニュー内の`hamburger-project-section`（新規/開く/上書き保存/名前を付けて保存/パス表示）は削除した。

#### ツールバーアクションUI
- `JPEG/TIF生成`ボタンを`EPUB生成`と同じ青枠・青文字のアウトラインスタイル（`preview-fab-secondary`）に変更した。

#### リンク変更検知（src-tauri/src/commands/project.rs）
- `validate_pages`のファイル参照検証で、更新日時だけでなくファイルサイズも比較するようにした。
- 変更前後のファイル名が同じ場合でも、実体差し替えなどでファイルサイズが変わっていれば`modified`扱いにし、カードにアラートと手動リンク更新ボタンを表示できるようにした。

#### 検証
- `npm run build` 成功。
- `cargo check` 成功。

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

### 2026-05-09: EPUB生成パイプライン整備・CMYK警告・総扉/目次チャプター・ドロッププレースホルダー (v1.0.7)

#### EPUB生成バグ修正: PSD/TIFFが含まれるとEPUBが開けない（src-tauri/src/epub/builder.rs）
- 症状: ソースがPSD/TIFFの場合、コピー先ファイル名が `.psd`/`.tif` となり OPF/XHTML がそれを参照するが、ZIP梱包の拡張子フィルタ `["jpg","jpeg","png"]` が PSD/TIFF を除外してしまうため、マニフェストが存在しないファイルを参照する不正なEPUBが生成されていた
- 修正:
  - `EpubBuilder::new()` で PSD/TIFF ソースのページ `filename` 拡張子を `.jpg` に正規化（OPF/XHTML 参照と実ファイル名を一致させる）
  - `copy_images()` で PSD は `psd::Psd::from_bytes` → JPEG エンコード、TIFF は `image::open` → JPEG エンコードに置換
  - `convert_psd_to_jpeg` / `convert_via_image_crate_to_jpeg` / `write_jpeg`（JpegEncoder, 品質90, RGB変換）を新規追加
  - JPG/PNG ソースは従来通り `fs::copy` でパススルー

#### EPUB生成のフリーズ対策（src-tauri/src/epub/builder.rs, src-tauri/src/commands/epub.rs）
- PSD合成（`psd_file.rgba()`）がCPU重く、順次処理ではUIが応答停止に見えていた問題を解消
- `copy_images()` を rayon `par_iter().enumerate().try_for_each` に置き換えて全コアで並列変換
- Tauri進捗イベント `epub-progress` を送信:
  - `EpubProgressPayload { phase: &str, current: usize, total: usize }` を `tauri::Emitter::emit` で発火
  - `EpubBuilder::with_app_handle(AppHandle)` セッターを追加、`AtomicUsize` で完了ページ数を集計してフェーズ別に送信
  - 送信タイミング: `images` 開始時(0/total) → 各ページ完了時(N/total) → `packaging` 開始(0/1) → 完了(1/1)

#### EPUB生成中のプログレスバーダイアログ（src/components/modals/EpubMetadataModal.tsx, src/styles.css）
- メタデータモーダルの上に z-index 1100 のオーバーレイで進捗ダイアログを重ねる
- フェーズ別表示:
  - 準備中: アニメーション付き不確定バー（`@keyframes epubProgressIndeterminate`）
  - 画像変換中: `current / total ページ` と `N%` 表示の確定バー
  - EPUB梱包中: 95% 固定バー
- 生成中はメタデータモーダルの×ボタンと枠外クリック閉じが無効化
- 新規CSS: `.epub-progress-overlay` / `.epub-progress-dialog` / `.epub-progress-title` / `.epub-progress-phase` / `.epub-progress-bar-track` / `.epub-progress-bar-fill`（含 `indeterminate`）/ `.epub-progress-meta`
- `listen('epub-progress')` でイベントを購読し progress state を更新

#### 白紙ページのEPUB反映・多数派サイズ生成（src-tauri/src/types/epub.rs, src-tauri/src/commands/epub.rs, src-tauri/src/epub/builder.rs, src/types.ts, src/App.tsx）
- 従来は白紙ページがEPUB生成時にスキップされていた問題を修正
- `EpubPage` に `is_blank: bool` フィールド追加（フロントの `EpubPage.isBlank?: boolean`）
- `validate_pages`:
  - 白紙のみで構成された場合 `白紙ページのみではEPUBを生成できません` でエラー（フロントでも事前にチェックして早期return）
  - 白紙ページのソース存在チェックをスキップ
- `EpubBuilder::new()`:
  - `majority_size_of_non_blank()` で非白紙ページの (width,height) を集計し最頻値を算出
  - 白紙ページの `width/height` を多数派サイズで上書き、ファイル名を `.jpg` に正規化
- `copy_images()` で `is_blank` ページは `generate_blank_jpeg()` で白JPEGを生成（並列パイプライン内で他ページと同時処理）
- フロント `handleEpubGenerate`:
  - 白紙判定 `page.pageType === 'blank' || (chapter.type === 'blank' && !page.filePath)`
  - 白紙チャプターのページも epubPages に含める（`isBlank: true`, `sourcePath: ''`, filename は `.jpg` 固定）
  - 白紙は isCover/isColophon 判定対象外
  - `nonBlankCount === 0` で警告ダイアログ表示し早期return

#### CMYK判定の精度向上（src-tauri/src/commands/project.rs）
- 症状: CMYK TIFFが「RGB」と誤判定されていた。`image` クレートのTIFFデコーダーが内部でCMYK→RGBに変換してから `color_type()` を返すため
- 修正:
  - `read_tiff_photometric()` 関数を新規追加: TIFFのIFDから `PhotometricInterpretation` タグ(262)を直接読み取る
  - 値`5` (Separated) のとき `color_mode` を `"CMYK"` に上書き
  - リトル/ビッグエンディアン両対応、classic TIFF (magic=42) 専用（BigTIFFは無視）
- PSDは既存の `read_psd_header` で ColorMode ID `4` から CMYK 判定済み

#### CMYKバッジを赤色警告スタイルに（src/App.tsx, src/styles.css）
- カラーモードサマリーバーで CMYK バッジを赤色で強調表示
- スウォッチ色を ティール `#0abfb4` → 赤 `#dc2626` に変更
- `.color-mode-badge-warning` クラスを CMYK 時のみ付与:
  - ダーク: 半透明赤背景 `rgba(220,38,38,0.12)`、赤枠 `#dc2626`、赤テキスト `#fca5a5`、ラベル `font-weight: 600`、カウント部分は赤背景白文字
  - ライト: `#b91c1c` 系の濃い赤
  - ホバー/アクティブ時はより濃い赤に変化
- ツールチップに「CMYK画像はEPUBで正しく表示されない可能性があります」を表示

#### CMYKファイルのエクスポート/EPUB生成ガード（src/App.tsx）
- CMYKファイルが台割上に存在するときエクスポート/EPUB生成をブロック
- `blockIfCmyk(action)` ヘルパーを追加: `colorModeCounts.CMYK > 0` のとき既存のエクスポート結果ダイアログ（`isError: true`）を再利用して警告
  - タイトル: 「CMYKファイルが含まれています」
  - メッセージ: 件数とアクション別の説明 + 「RGB/グレースケールに変換してから再度お試しください」
  - details: 該当ファイル名一覧（先頭20件、超過分は「…他N件」と省略）
- 適用箇所: ツールバーのエクスポートボタン、EPUB生成ボタン、エクスポート完了ダイアログ内のEPUB生成ボタン

#### 総扉・目次チャプタータイプ追加（src/types.ts, src/store.ts, src/App.tsx, src/components/sidebar/ChapterItem.tsx）
- `ChapterType` に `'title'`(総扉) と `'toc'`(目次) を追加
- `CHAPTER_TYPE_LABELS`: `title: '総扉'`, `toc: '目次'`
- `CHAPTER_TYPE_COLORS`: `title: '#ec4899'`(ピンク), `toc: '#06b6d4'`(シアン)
- `getDefaultChapterName`: `title` → `'総扉'`, `toc` → `'目次'`
- `chapter-actions-bar` のボタン並び順: 表紙 → 総扉 → 白紙 → 目次 → 話 → 幕間 → 奥付 → AD（3列グリッドで2行+1配置）
- ChapterItem のフォルダ差し替えボタン表示条件に `'title' | 'toc'` を追加

#### リスト表示のドロッププレースホルダー強化（src/components/dnd/DropZones.tsx, src/hooks/useDragHandlers.ts, src/App.tsx, src/styles.css）
- リスト表示でページをドラッグ中、挿入予定位置に空白プレースホルダーカードを絶対配置で表示
- 新規コンポーネント `DropPlaceholder({ id, width, height, variant, side })`: `useDroppable` で `'ph:before:<pageId>'` / `'ph:after:<pageId>'` をドロップ可能ID化
- `useDragHandlers.handleDragOver` でプレースホルダー上ホバー時に `setDropTarget({ type: 'page-before' | 'page-after' })` で位置をロック
- リスト表示は横並びwrapのため、位置判定をX軸基準に変更（サイドバー縦並びはY軸のまま）
- 新規CSS: `.chapter-page-placeholder`（base + side-before/side-after/locked/file-drop バリアント）、`@keyframes placeholderPulse` / `placeholderPulseFile`

### 2026-05-10: UX大改修・EPUB生成プレビュー統合・ダイアログアニメーション (v1.1.0)

#### サイドバーチャプターのファイル/フォルダドロップ対応（src/App.tsx, src/components/sidebar/ChapterItem.tsx, src/styles.css）
- サイドバーの `.chapter-item` に `data-chapter-id` を付与し、`isFileDropTarget` prop でハイライト
- `__getDropInfoFromPosition` でサイドバー `.chapter-item[data-chapter-id]` を検出して `mode: 'append-chapter'` 設定
- 旧 `.chapter-separator` セレクタ（未使用）を `.chapter-underline-header[data-chapter-id]` に修正
- `__dropHandler` をフォルダ対応化: 個別画像ファイルとフォルダ候補に分類し、フォルダパスは `get_folder_contents` を直接呼んで中身を全件追加
- 新規CSS `.chapter-item.file-drop-target`: アクセントカラー枠線+ハイライト

#### preview-area 右下フローティングアクションボタン（後にツールバー右側へ移動）（src/App.tsx, src/styles.css）
- Comic-Bridge の PDF 化ボタンを参考にエクスポート/EPUB 生成ボタンを preview-area 右下に配置
- 後の指摘で `toolbar-content` 右側に移動し、`.toolbar-spacer { flex: 1 }` で左右ボタングループを離す
- `.preview-fab` ピル形状（`border-radius: 999px`）+ プライマリ青グラデーション/セカンダリアクセント枠線
- `.preview-fab-toolbar` バリアント: 高さ 36px / 最小幅 132px / 影なし

#### 「話」→「本文」リネーム（src/types.ts, src/store.ts, src/App.tsx, src/components/modals/ExportModal.tsx）
- `CHAPTER_TYPE_LABELS.chapter`: `'話'` → `'本文'`
- デフォルトチャプター名: `第${n}話` → `本文${n}`
- サイドバー追加ボタン `+話` → `+本文`
- 断ち切り設定ラジオ `話ごと` → `本文ごと`、説明文 `各話チャプター` → `各本文チャプター`

#### 複数フォルダ → 本文チャプター分割ダイアログ（src/store.ts, src/components/modals/SplitFoldersDialog.tsx, src/App.tsx）
- 新規 store アクション `insertChaptersFromFolders(insertAt, type, folders)`: 複数フォルダを各々別チャプターとして指定位置に一括挿入。type 引数で生成タイプを選択（cover は1ファイル制限維持）
- 新規モーダル `SplitFoldersDialog`: フォルダごとのチェックボックス + チャプター名編集UI、3列グリッド、ピル型ボタン、ESCキャンセル対応
- 起動条件: `mode === 'append-chapter'` + 2 個以上のフォルダドロップ + 白紙以外のチャプタータイプ
- ドロップ先チャプターを「先頭行（ドロップ先）」として含め、選択時は `addPagesToChapter` で内容追加 + `renameChapter` でリネーム、残りは `insertChaptersFromFolders` で直後に挿入
- フォルダ選択ピッカー（`handleAddFolder`）も `multiple: true; directory: true` に変更し、複数選択で同じ分割ダイアログを起動
- 全チャプタータイプ対応（chapter/cover/intermission/colophon/ad/title/toc）。タイプごとにダイアログタイトル・デフォルト名を切替

#### EPUB出版社のトグル化（src/components/modals/EpubMetadataModal.tsx, src/styles.css）
- 出版社入力をピル型トグル `[CLLENN | その他]` に変更。CLLENN 選択時は `publisher='CLLENN'` + `publisherFileAs='シレン'` を自動設定
- その他選択時は自由入力欄を表示（直前が CLLENN なら値をクリア）
- デフォルトは CLLENN

#### EPUB生成ダイアログに見開きプレビュー統合（src/components/modals/EpubMetadataModal.tsx, src/styles.css）
- モーダル幅を 600px → 1300px（max-width 95vw）に拡大
- 左ペイン（flex: 1）: `EpubSpreadPreview` 再利用（綴じ方向 RTL/LTR をフォーム選択と連動）。`isOpen` 切替で `loadEpubFromDaidori()` を実行し最新台割を反映
- 右ペイン（560px固定）: 既存メタデータフォーム
- `@media (max-width: 1100px)` で縦並びにフォールバック
- `EpubThumbnailBar` は表示せず、見開きビューア内蔵のフローティングナビゲーションバーで操作

#### モーダルのキャンセル時フェードアウトアニメーション（src/hooks/useModalAnimation.ts, src/styles.css, 各モーダル）
- 新規フック `useModalAnimation(isOpen, exitDuration=300)`: `isOpen` 偽転換時に `isClosing=true` を立て、300ms 後に `shouldRender=false` でアンマウント
- 新規キーフレーム `fadeOut` / `slideDown`（既存 `fadeIn` / `slideUp` の逆）+ `.modal-overlay.closing` / `.modal-content.closing` で適用
- 適用先: ExportModal / EpubMetadataModal / BleedEditorModal / SplitFoldersDialog / 削除確認ダイアログ / ウィンドウ終了確認ダイアログ / エクスポート結果ダイアログ
- SplitFoldersDialog は `isOpen` prop を新設、App.tsx 側で `splitFoldersDialog.open` フラグと `closeSplitFoldersDialog()` ヘルパで「フェードアウト → 300ms 後にデータをnull」のフローを実装

#### ダイアログUI共通刷新（src/styles.css, 各モーダル）
- `.modal-footer` をグローバル化: `background: transparent` + `border-top: none` + パディング拡大、ボタンを `border-radius: 999px` ピル形状 + `padding: 10px var(--spacing-xl)` + `min-width: 120px` + `font-weight: semibold` に統一
- ホバーで `brightness(1.08)` + 影強調 + `translateY(-1px)`、押下で `scale(0.97)`
- 全ダイアログから `btn-icon modal-close`（×ボタン）を削除（オーバーレイクリック・ESC・フッターボタンで閉じ）
- アプリ終了警告ダイアログのタイトル色を warning（黄）→ error（赤）に変更
- `label.section-heading` / `h3.section-heading` クラス: 18px/700 で見出し強調。エクスポートでは「出力先フォルダ・出力方法・リネーム設定」、EPUB生成では「出力設定・書籍情報・著者情報・識別子」の見出しに付与

#### 文言調整（src/components/modals/ExportModal.tsx）
- 「高画質JPGに変換して出力」→「高画質JPGに変換して出力（対応ファイル：PSD）」
- 「PhotoshopでTIFFに変換（PSD・JPEG）」→「PhotoshopでTIFFに変換（対応ファイル：PSD・JPEG）」
- 「PhotoshopでJPEGに変換（PSD）」→「PhotoshopでJPEGに変換（対応ファイル：PSD）」
- 「プレフィックス（任意）」→「ファイル名（任意）」
- 「プレビュー」→「ファイル名プレビュー」
- 「リネームモード」ラベル削除（一括設定/チャプターごとに設定 ラジオはそのまま残置）

#### ウィンドウ終了確認ダイアログ（src/App.tsx）
- `getCurrentWindow().onCloseRequested()` で X ボタン・Alt+F4・Cmd+Q をインターセプト
- `chapters.some(c => c.pages.some(p => p.pageType === 'file'))` でファイル読み込み中を検出
- ファイルがある場合は `event.preventDefault()` + 警告ダイアログ表示、確定で `getCurrentWindow().destroy()`（onCloseRequested を発火させずに即時終了）

#### サイドバーチャプター並べ替えバグ修正（src/hooks/useDragHandlers.ts, src/components/sidebar/ChapterItem.tsx, src/styles.css）
- 下→上ドラッグ時に上手く移動しない問題を修正: `verticalListSortingStrategy` のシフトで `over.rect` のセンターが変動して判定が反転する問題
- rect ベース判定 → 配列インデックス方向ベース判定に変更: `activeIndex > overIndex ? 'chapter-before' : 'chapter-after'`
- 「先頭に移動」「末尾に移動」ラベル付き SidebarChapterReorderDropZone を撤去
- 旧 `chapter-header-insertion-line`（細線）を廃止し、ChapterItem を `<>` でラップして `.chapter-drop-placeholder`（点線枠 56px / 2px dashed accent / accent-subtle 背景）を直前/直後に描画

#### リスト表示ドラッグ仕様変更（src/App.tsx, src/hooks/useDragHandlers.ts）
- `rectSortingStrategy` を `noShiftStrategy: SortingStrategy = () => null` に置換し、ドラッグ中に他のカードが動かないように
- `DropTarget` 型に `locked?: boolean` フィールド追加
- `ph:` プレースホルダー上ホバー時のみ `locked: true`、カードに近いだけの状態は `locked: undefined`
- handleDragEnd でページ並べ替えを `dropTarget.locked` で gate: 点線（locked=false）状態でリリースされた場合は元の位置に戻る
- サイドバー / チャプター並べ替えは従来通り即ロック確定

#### EPUB生成・エクスポートボタン位置・形状調整（src/styles.css）
- ボタン形状をダイアログボタンと同じ `border-radius: 999px` ピル形状に統一
- 影削除: disabled / hover / 通常状態の box-shadow をすべて除去
- ツールバー右側配置（`toolbar-spacer` 経由）

#### chapter-actions-bar 4列化（src/styles.css）
- `grid-template-columns: repeat(3, 1fr)` → `repeat(4, 1fr)`: 8ボタン（表紙・総扉・白紙・目次・本文・幕間・奥付・AD）が 4列×2行 で配置

#### 新規ファイル
| ファイル | 説明 |
|---------|------|
| `src/components/modals/SplitFoldersDialog.tsx` | 複数フォルダ→チャプター分割ダイアログ |
| `src/hooks/useModalAnimation.ts` | モーダルのフェードイン/フェードアウトアニメーション制御フック |

#### 新規CSSクラス
- `.chapter-item.file-drop-target` / `.chapter-drop-placeholder`
- `.preview-fab` / `.preview-fab-primary` / `.preview-fab-secondary` / `.preview-fab-toolbar` / `.preview-fab-label` / `.toolbar-spacer`
- `.publisher-toggle` / `.publisher-toggle-btn` / `.publisher-custom-input`
- `.epub-modal-split` / `.epub-preview-pane`
- `.split-folders-modal` / `.split-folders-list` / `.split-folders-row` / `.split-folders-folder` / `.split-folders-name-input` / `.split-folders-summary` / `.split-folders-annotation`
- `label.section-heading` / `h3.section-heading`
- `.modal-overlay.closing` / `.modal-content.closing`
- `@keyframes fadeOut` / `@keyframes slideDown`

---

## v1.2.0: EPUB自動JPEG化・チャプター操作強化・エクスポートUI簡素化

### A. EPUBメタデータからISBN/説明を撤去

A1. **`EpubMetadata` から `isbn` / `description` を削除** ([src/types.ts](src/types.ts), [src-tauri/src/types/epub.rs](src-tauri/src/types/epub.rs)): TS interface + Rust struct 両方からフィールドを削除。`EpubMetadata::new()` の初期化からも除外。

A2. **UI入力欄を撤去** ([src/components/modals/EpubMetadataModal.tsx](src/components/modals/EpubMetadataModal.tsx), [src/components/epub/EpubMetadataPanel.tsx](src/components/epub/EpubMetadataPanel.tsx)): モーダル・パネル両方の ISBN / 説明入力欄を削除。useState、メタデータ構築、UI 表示全てから除外。

A3. **`unique_id` を UUID 専用に** ([src-tauri/src/epub/templates.rs](src-tauri/src/epub/templates.rs)): 旧 `metadata.isbn` フォールバック分岐を撤去し、常に `urn:uuid:{book_uuid}` を返す形式に簡素化。

### B. 複数フォルダ取り込みの自然順ソート + 「N話」命名

B1. **`SplitFoldersDialog` 描画ブロックで折を並べ替え** ([src/App.tsx](src/App.tsx)): `setSplitFoldersDialog` 時点ではなく、ダイアログ表示用の中間レイヤで `Intl.Collator('ja', { numeric: true })` による自然順ソートを実施。`第1話 < 第2話 < 第10話` を正しく並べる。

B2. **デフォルト命名を「N話」形式に**: フォルダ名から最初の連続数字を抽出（半角・全角どちらも対応）して `${num}話` を生成。番号なしのフォルダはソート後の通し番号で `${i + 1}話` にフォールバック。

B3. **`onConfirm` の firstRowEnabled 判定もソート後配列を参照**: `splitFoldersDialog.folders[0]` → `sortedFolders[0]` に切り替えてドロップ先吸収ロジックを保持。

### C. チャプター名のリネーム機能（ボタン＋ダブルクリック両対応）

C1. **明示的なリネームボタン追加** ([src/components/sidebar/ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx)): 鉛筆アイコン（`PencilIcon`）の「リネーム」項目をチャプター操作メニュー（後述「…」メニュー）内に配置。

C2. **ダブルクリック経路の修正**: 旧仕様では `useSortable` の pointerdown リスナーが span のクリックを横取りしてダブルクリックが届かなかった。span に `onPointerDown={e => e.stopPropagation()}` と `onClick={e => e.stopPropagation()}` を追加してドラッグ検出を抑止。tooltip 「ダブルクリックでリネーム」も追加。

C3. **`PencilIcon` 追加** ([src/icons.tsx](src/icons.tsx)): lucide スタイルの鉛筆 SVG を新規定義。

### D. チャプターのファイルごと複製機能

D1. **`duplicateChapter` アクション** ([src/store.ts](src/store.ts)): チャプター + 全ページを deep copy し、チャプター ID + 各ページ ID を新規 UUID に置換、名前末尾に「 (コピー)」を付与、ソースチャプターの**直後**に挿入。`saveHistory()` 経由で Undo 対応。サムネイルキャッシュ (`thumbnailCacheKey` / `thumbnailCachePath`) は同一ファイル参照なので共有（再生成不要）。戻り値で新チャプター ID を返す。

D2. **UI 配線** ([src/App.tsx](src/App.tsx), [src/components/sidebar/ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx)): `handleDuplicateChapter` で複製後に新チャプターを選択。「…」メニュー内に `CopyIcon`（2枚の矩形が重なった lucide SVG）の「チャプターを複製」項目として配置。

D3. **`CopyIcon` 追加** ([src/icons.tsx](src/icons.tsx)): lucide スタイルの複製 SVG を新規定義。

### E. チャプター操作を「…」メニューに集約

E1. **`MoreIcon` 追加** ([src/icons.tsx](src/icons.tsx)): 横三点（lucide）SVG を新規定義。

E2. **4つのインライン操作ボタンを撤去** ([src/components/sidebar/ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx)): 旧チャプターヘッダ右端の「リネーム / 差し替え / 複製 / 削除」4 個並びを「…」トリガーボタン 1 個に集約。
- **ホバーで開閉**: `onMouseEnter` で即時オープン、`onMouseLeave` で 200ms 遅延クローズ。メニュー側にも同様の入退場ハンドラを設定し、トリガーとメニュー間の移動でメニュー継続表示
- **クリックでも開閉**: タッチ/キーボード操作の保険
- **`createPortal` で `document.body` に描画**: 親 `overflow: hidden` の影響を受けない
- **位置計算**: 画面下端付近では上開き、それ以外は下開き
- **backdrop は使用しない**: 当初は `.menu-backdrop-fixed` を使ったが全画面オーバーレイがトリガーボタンの mouseLeave を即発火させてフラッシュループになる現象を修正。`document.mousedown` listener で外側クリック検知し、Esc でも閉じる
- **メニューとトリガー間のギャップを 0 に**: `top: rect.bottom + 4` → `rect.bottom` でホバー継続性を確保

E3. **CSS** ([src/styles.css](src/styles.css)):
- `.chapter-actions-trigger` を常時 `opacity: 0.6`、hover / selected / 展開中で `1.0` に
- `.chapter-actions-menu` を新設（既存の `.chapter-add-menu` と同じガラス調 + `menuAppearDown` アニメーション）
- 削除項目は `.menu-item-danger` で `var(--danger)` の赤色強調 + hover 時に半透明赤背景

E4. **チャプター名のレイアウト崩れ対策** ([src/styles.css](src/styles.css)): 4ボタン時代に発生していた「チャプター名が縦書きに改行される」「省略されすぎる」問題を `.chapter-name { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }` + `.chapter-actions { flex-shrink: 0 }` で整備。「…」メニュー化後は単一ボタンなので名前領域が広く取れる。

### F. Ctrl+A の暴発抑止

F1. **入力欄外で Ctrl+A をブロック** ([src/hooks/useKeyboardShortcuts.ts](src/hooks/useKeyboardShortcuts.ts)): 入力欄ガードの直後に `if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { preventDefault + stopPropagation }` を追加。ブラウザ既定の「ページ全選択」が走ってメッセージ要素にフォーカスが移る事故を防止。input/textarea 内では既存の早期 return により通常の全選択が機能する。

### G. 基本フォントを Noto Sans JP（MojiQ 互換）に統一

G1. **Google Fonts 読込追加** ([index.html](index.html)): `preconnect` + `Noto Sans JP` (wght 300/400/500/700) を head に追加。

G2. **CSS フォントスタック更新** ([src/styles.css](src/styles.css), [src/App.css](src/App.css)):
- `--font-family`: `'Segoe UI', 'Yu Gothic UI', 'Meiryo', sans-serif` → `"Noto Sans JP", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif`（MojiQ ver_2.26 `css/base.css` と一致）
- `App.css :root` の Tauri 既定 `Inter` スタックも同一に置換

### H. JPEG/TIF生成のエクスポートフロー再設計

このバージョンの中心的な変更。

H1. **ヘッダーボタン文言の遷移**: 「エクスポート」→「JPEG/TIFF生成」→「生成」→「エクスポート」→ **「JPEG/TIF生成」**（試行錯誤の末確定。ダイアログ内のボタンは **「生成」** に変更）。

H2. **モーダルのチェックボックスを 3 → 2 に統合** ([src/components/modals/ExportModal.tsx](src/components/modals/ExportModal.tsx)):

| 旧 | 新 |
|---|---|
| ☐ 高画質JPGに変換して出力 (`convertToJpg`) | ☐ **JPEGに変換** (PSDがあれば自動でPhotoshop) |
| ☐ PhotoshopでJPEGに変換 (`convertToJpgPhotoshop`) | （削除・JPEGに統合） |
| ☐ PhotoshopでTIFFに変換 (`convertToTiff`) | ☐ **TIFFに変換** (Photoshopが必要) |

- `ExportOptions` 型から `convertToJpgPhotoshop` フィールド削除
- `convertToJpg` の意味を「JPEGにする（PSDが含まれる場合は自動でPhotoshop経由）」に拡張
- 「PhotoshopでJPEGに変換」チェックボックスを完全削除
- JPEG/TIFF のラベルから「Photoshopで」プレフィックスを撤去（実装詳細をUIから隠蔽）
- 断ち切り設定セクションの表示条件を `(convertToTiff || (convertToJpg && hasPsdFiles))` に変更
- JPEG チェックボックスは PSD ありかつ Photoshop 未インストール時に disabled。`hasPsdFiles && !photoshopInstalled` で disabled、PSD ありなら注釈「PSDはPhotoshop経由で変換」を表示

H3. **振り分けロジックの統合** ([src/hooks/useExport.ts](src/hooks/useExport.ts)):
- `handleExport` 冒頭で `hasPsdFiles = chapters.some(c => c.pages.some(p => p.fileType === 'psd'))` を判定
- `convertToJpgPhotoshop = convertToJpg && hasPsdFiles` をローカル変数として derive — 既存の `if (convertToJpgPhotoshop)` ブロックはそのまま動作（PSD は Photoshop、非PSDは export_pages フォールバック）
- `handlePreExport` の bleed editor 表示条件を `convertToTiff || (convertToJpg && hasPsdFiles)` に変更。PSD なし時の JPEG エクスポートは bleed editor を経由せず直接 `export_pages` パスへ流れる

H4. **JPEG混在時の出力先・拡張子統一**: PSD と非PSD（JPG等）が混在するチャプターで JPEG エクスポートした際、非PSDも JPEG再エンコードして同一フォルダに出力するよう変更。
- 非PSD用の `export_pages` 呼び出しを `convertToJpg: false` → **`convertToJpg: true`** に変更
- `jpgQuality` をハードコード `100` から **ユーザーのモーダル設定値 `jpgQuality ?? 100`**（PSD あり時はスライダー非表示で 100 固定、PSD なし時はユーザー設定値）に変更
- `outputPath: response.outputDir` は変更なし（Photoshop が書き出したフォルダと同一）→ 全ファイルが同じフォルダに `.jpg` 統一で集約

### I. EPUB生成時の PSD 自動 JPEG 化

I1. **PSD検出と自動変換** ([src/App.tsx](src/App.tsx) `handleEpubGenerate`): ユーザーが EPUB を生成しようとしたとき、チャプターに PSD が含まれていれば EPUB 生成前に自動で Photoshop 経由で JPEG に変換する。
- 全チャプターを走査して PSD ファイルパスを収集（重複は排除）
- Photoshop の存在確認 (`check_photoshop_installed`) — 無ければエラーダイアログで中止
- 進捗UIへ `epub-progress` イベント (`phase: 'psd-to-jpeg'`) を emit
- **出力先**: `<desktop>/Script_Output/EPUB用JPEG_<projectName>` 配下に JPEG 出力（同名フォルダ既存時は Rust 側 `create_unique_output_dir` が `(1)` 等を付与）
- `run_photoshop_jpeg_convert` で全 PSD を JPEG（最高画質 12）に変換（断ち切りなし）
- 元 PSD パス → 変換後 JPEG パスの `Map` を構築
- フェーズを `images` に戻して EPUB 生成本体へ進行

I2. **EPUB ページ構築ループに変換マップを適用**:
- `isPsdConverted` 判定で各 page の `filePath` を JPEG パスへ置換
- `get_image_dimensions` は変換後 JPEG に対して実行
- ファイル拡張子も `'jpg'` に強制（旧 PSD 由来でも EPUB の sourcePath は .jpg）

I3. **進捗ラベル追加** ([src/components/modals/EpubMetadataModal.tsx](src/components/modals/EpubMetadataModal.tsx)): `phase === 'psd-to-jpeg'` 時のラベル「**PSDをJPEGに変換しています…**」を追加。既存の `images` / `packaging` フェーズと並列で表示。

### バージョン同期

`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` を **`1.2.0`** に揃え。Cargo.lock は `cargo check` 経由で自動追従。

> **このバージョンの構造変更まとめ**:
> - 旧: チャプター操作 = ヘッダ右端に 4 ボタン並列、リネームはダブルクリック専用（ドラッグリスナーに阻まれて発動しない事故あり） → 新: 「…」アイコン 1 つ + ホバードロップダウンに集約（リネーム / 差し替え / 複製 / 削除）、ダブルクリックも修正
> - 旧: チャプターのファイルごと複製機能なし → 新: store.ts `duplicateChapter` で全ページに新 UUID を発行して直下に挿入、Undo 対応
> - 旧: 複数フォルダ取り込み = OS 字句順で挿入、命名は「本文1」固定 → 新: 自然順ソート + フォルダ名から数字抽出して「N話」命名（半角/全角どちらも対応）
> - 旧: エクスポートモーダル = 3 チェックボックス（JPG / PhotoshopJPEG / PhotoshopTIFF）でユーザーが Photoshop の有無を選ぶ → 新: 2 チェックボックス（JPEG / TIFF）+ PSD 有無で自動振り分け
> - 旧: JPEG 混在時、非PSDは元拡張子コピー（JPG → JPG、PNG → PNG）→ 新: 全部 .jpg に統一して同一フォルダに集約
> - 旧: EPUB 生成時に PSD が含まれているとそのまま PSD を sourcePath として渡し、EPUB ビューアで表示不可 → 新: PSD を Script_Output 配下の `EPUB用JPEG_*` フォルダへ自動変換し、変換後 JPEG を sourcePath に置換
> - 旧: ヘッダーボタン文言「エクスポート」 → 新: 「JPEG/TIF生成」(ダイアログ内ボタンは「生成」に統一)
> - 旧: EPUB メタデータに ISBN / 説明欄あり → 新: 撤去（unique_id は UUID 専用）
> - 旧: 基本フォントは Segoe UI / Yu Gothic UI → 新: Google Fonts の Noto Sans JP（MojiQ 互換）
> - 旧: 入力欄外で Ctrl+A → ブラウザ既定のページ全選択でメッセージ要素にフォーカス移動 → 新: 入力欄外では Ctrl+A を抑止

---

## v1.3.0: Tachimi 連携で全チャプターを 1 操作で PDF 化 + チャプタードラッグ修正

### 概要

別アプリ Tachimi（`C:\Users\noguchi-kosei\Desktop\Tachimi_開発` の PDF/JPEG 出力アプリ、Tauri 2 + Vanilla JS）と接続し、Daiwari Manager で組んだ台割の全チャプター・全ファイルを 1 クリックで Tachimi に渡して PDF 化できるようにした。加えて、v1.2.0 のチャプター名インライン編集で `onPointerDown` が dnd-kit のドラッグ開始イベントを食い止めていたバグも修正。

### A. Tachimi 連携: 全チャプターのファイルを 1 ボタンで PDF 化

**A1. ツールバーに「Tachimi PDF」ボタン追加** ([src/App.tsx](src/App.tsx) `toolbarActionButtons`): EPUB生成 / JPEG/TIF生成 の左に `preview-fab-secondary` スタイルの新ボタン。`allPages.length === 0` で disabled、クリックで `handleLaunchTachimi()` を発動。

**A2. PdfIcon を追加** ([src/icons.tsx](src/icons.tsx)): 書類アイコンの中央に「PDF」テキストラベルを焼き込んだ SVG。`<text fontSize="6.5" fontWeight="700">` で sans-serif を指定。

**A3. Tachimi.exe 自動検出（ファイル選択ダイアログなし）** ([src-tauri/src/commands/tachimi.rs](src-tauri/src/commands/tachimi.rs) `detect_tachimi_exe`): hint（前回成功パス、localStorage 由来）→ 開発ビルド（`%USERPROFILE%\Desktop\Tachimi_開発\Tachimi-_Standalone\src-tauri\target\{release,debug}\tachimi.exe`）→ Windows インストール想定パス（`%ProgramFiles%`, `%ProgramFiles(x86)%`, `%LOCALAPPDATA%` の `Tachimi\` / `Programs\Tachimi\`）→ デスクトップ直下、の順に探索。最初にヒットしたパスを返し、見つからなければ `None`。`localStorage.daidori_tachimi_exe_path` に成功パスをキャッシュし、次回最短経路で確定。

**A4. ハードリンクステージング方式によるファイル渡し** (`launch_tachimi_with_files`): 複数チャプール（=複数フォルダ）混在で Tachimi 側がファイルを見つけられない問題（Tachimi の `handleDroppedPaths` が「最初のファイルの親フォルダをすべてのファイルの所属フォルダと仮定」する設計起因）を回避するため、**Daiwari Manager 側で `%TEMP%\daidori_tachimi_staging\` に全ファイルをハードリンク集約**してから Tachimi に渡す:
- 4 桁ゼロ埋め連番プレフィックス（`0001_filename.psd`, `0002_...`）で**チャプター順 + ページ順を保持**。Tachimi 内部の `localeCompare(..., {numeric: true})` ソートで自然順を維持
- **ハードリンク優先** (`fs::hard_link`): 同一ボリュームならほぼ即時 + I/O ゼロ（NTFS link 機能、元データを参照するだけ）
- **コピーへフォールバック** (`fs::copy`): クロスドライブ / 権限制限 / 非 NTFS 等でハードリンクが失敗した場合
- **同名ファイル衝突回避**: 複数チャプターで同じ `p001.psd` があっても連番プレフィックスで別ファイル扱いに
- **前回ステージングは自動クリーンアップ**: 起動毎に `daidori_tachimi_staging\` を `remove_dir_all` してから作り直す（ゴミ蓄積なし）
- **元ファイル本体は触らない**: ハードリンクは参照を作るだけ、コピーフォールバックでも書き込みは temp 配下のみ

**A5. トリガー JSON 経由のファイル渡し**: ステージング後の絶対パス配列を `%TEMP%\tachimi_cli_files.json` に書き出し、`tachimi.exe` を CLI 引数なしで spawn。Tachimi 側は起動時に同 JSON を読み取り全ファイルをロード後、JSON を自動削除（既存の COMIC-Bridge 連携用パスを再利用）。CLI 引数の Windows 長さ制限（~8191 字）や、パスの quote / 空白 / 全角文字エスケープ事故とは無縁。

**A6. 結果通知は既存 `setExportResultDialog` を再利用**: 成功時は「N 件のファイルを Tachimi に渡しました」、参照切れがあれば skip 件数も併記。tachimi.exe 検出失敗 / spawn 失敗 / ステージング失敗それぞれに専用エラー文言。useExport フックから返る既存ダイアログ状態を流用するので新規モーダル DOM 追加なし。

**A7. `check_tachimi_exe` バリデーション関数**: パスが存在し、ファイル名末尾が `tachimi.exe` / `tachimi`（case-insensitive）であれば OK。`detect_tachimi_exe` が内部で使用し、フロント側からも検証用に呼び出せる。

### B. チャプタードラッグ移動の修正

**B1. `onPointerDown` の stopPropagation 削除** ([src/components/sidebar/ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx) `.chapter-name` span): v1.2.0 でチャプター名ダブルクリック編集を実装した際に追加した `onPointerDown={(e) => e.stopPropagation()}` が、dnd-kit の `PointerSensor` がチャプターヘッダ全体に張っているドラッグ開始リスナーへの伝播を遮断していた。チャプター名 span がヘッダの大半を占めるため、ユーザーがチャプター名上でドラッグを開始しても dnd-kit に届かず、結果としてチャプターのドラッグ並べ替えが事実上機能しなくなっていた。`onClick` の stopPropagation はクリックでの選択誤動作防止に必要なので維持しつつ、`onPointerDown` だけ削除。`onDoubleClick` は別経路でリネームを開始するので影響なし。

### C. Tachimi 側の補完的修正（参考）

別リポジトリ（[Tachimi-_Standalone](https://github.com/Ina986/Tachimi-_Standalone)）の `src/js/features/file-handling.js` の `handleDroppedPaths` ファイル分岐も拡張して、複数フォルダ混在のファイルリストを**共通親 + 相対パス + subfolder 情報**に変換する処理を追加（COMIC-Bridge / Daiwari Manager 等から複数チャプターの PSD を一括受信するケースに対応）。ただし Daiwari Manager 側のステージング方式（A4）で Tachimi 側の挙動に依存しない構成にしたため、こちらは追加の堅牢化として位置づけ。

### バージョン同期

`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` を **`1.3.0`** に揃え。Cargo.lock は `cargo check` 経由で自動追従。

> **このバージョンの構造変更まとめ**:
> - 旧: 台割マネージャーから別アプリで PDF 化する公式手段なし、ユーザーは手動で全ファイルを開き直す必要 → 新: ツールバー「Tachimi PDF」1 クリックで Tachimi が自動起動 → 全チャプターのファイルがロード済み状態で開き、Tachimi 側で PDF 出力するだけ
> - 旧: 別アプリ連携時のファイル渡しは未実装 → 新: `%TEMP%\daidori_tachimi_staging\` にハードリンクで連番集約 → Tachimi に絶対パス JSON を渡す。複数チャプター混在・複数ドライブ・同名ファイル衝突すべて同じ経路で解決
> - 旧: tachimi.exe の場所をユーザーがファイル選択ダイアログで指定する必要がある設計だった → 新: 既知の候補パス（dev release/debug、Program Files、LOCALAPPDATA、デスクトップ直下）を Rust 側で順次探索し、見つかれば自動採用 + localStorage キャッシュ。ユーザー操作はゼロ
> - 旧: v1.2.0 のチャプター名インライン編集が `onPointerDown` で dnd-kit のドラッグセンサーへの伝播を遮断 → チャプターのドラッグ並べ替えが機能しない → 新: `onPointerDown` の stopPropagation を撤去、`onClick` のみで選択誤動作を防ぐ最小限の制御に

---

## v1.3.1: Tachimi PDF生成安定化・チャプター表示改善・EPUB出版社選択・画像サイズサマリー

### A. Tachimi PDF生成のアプリ内完結化

A1. **チャプター単位の PDF 生成コマンドを追加** ([src-tauri/src/commands/tachimi.rs](src-tauri/src/commands/tachimi.rs)): Daiwari Manager から Tachimi を起動するだけでなく、チャプターごとのページ情報を渡して PDF 生成完了まで待機する `generate_tachimi_chapter_pdfs` を実装。白紙などの特殊ページもページ種別として渡せる構造に変更。

A2. **PDF生成プログレス表示** ([src/App.tsx](src/App.tsx), [src/styles.css](src/styles.css)): `tachimi-pdf-progress` イベントを購読し、準備中 / ページ整理中 / PDF生成中 / 確認中の進捗バーを結果ダイアログ内に表示。生成完了後は出力先と成功/失敗の詳細を表示。

A3. **ハング対策** ([src-tauri/src/commands/tachimi.rs](src-tauri/src/commands/tachimi.rs)): Tachimi 連携中の待機処理にタイムアウト、進捗イベント、出力確認を追加し、PDF生成が終わらないケースでユーザーに状況が見えるようにした。

### B. 描き下ろしチャプターのフォルダ名表示

B1. **特定フォルダ名の本文チャプター表示を分離** ([src/App.tsx](src/App.tsx), [src/store.ts](src/store.ts), [src/types.ts](src/types.ts)): `全書店` / `シーモア` / `Renta!` / `ebookjapan` のフォルダを本文チャプターへ読み込んだ場合、チャプター名を `描き下ろし`、フォルダ名を `subtitle` として保持。

B2. **サイドバーとプレビュー見出しで二段表示** ([src/components/sidebar/ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx), [src/App.tsx](src/App.tsx), [src/styles.css](src/styles.css)): `描き下ろし` の下にフォルダ名を小さなグレー文字で表示。既存の `描き下ろし（シーモア）` 形式も表示上は二段に分離。

B3. **プロジェクト保存形式を拡張** ([src-tauri/src/types/project.rs](src-tauri/src/types/project.rs)): `SavedChapter` に `subtitle` を追加し、読み込み済みのフォルダ名表示を保存/復元できるようにした。

### C. EPUB書籍情報の出版社選択をドロップダウン化

C1. **出版社トグルを撤去** ([src/components/modals/EpubMetadataModal.tsx](src/components/modals/EpubMetadataModal.tsx)): `CLLENN` / `その他` のトグルを廃止し、出版社ドロップダウンへ変更。

C2. **出版社候補を固定化**: 選択肢を `CLLENN`（読み仮名: `シレン`）と `DEEPER-ZERO`（読み仮名: `ディーパーゼロ`）に限定。出版社選択時に読み仮名を自動反映し、読み仮名欄は read-only に変更。

C3. **EPUB編集パネル側も同仕様に統一** ([src/components/epub/EpubMetadataPanel.tsx](src/components/epub/EpubMetadataPanel.tsx)): モーダルだけでなく EPUB 編集パネルでも同じ出版社ドロップダウンと読み仮名自動反映を使用。

### D. カラーモードサマリーに画像サイズ判定を追加

D1. **ピクセル数 + DPI から用紙サイズを判定** ([src/App.tsx](src/App.tsx), [src/utils/paperSize.ts](src/utils/paperSize.ts)): 画像の `imageWidth` / `imageHeight` / `imageDpi` から A4 / B4 などの規格サイズを判定し、カラーモードサマリー展開時にサイズバッジとして表示。

D2. **バッジ表面は用紙サイズ名のみ**: 通常サイズは `A4` / `B4` のような短い表示にし、ピクセル数・DPI・実寸・該当ファイルはホバー時のツールチップへ集約。

D3. **例外サイズを 1 バッジに集約**: 規格サイズに当てはまらない画像は赤い `例外サイズ` バッジ 1 つにまとめて表示。ホバー時に例外サイズの全ファイルを一覧化し、各行に `ピクセル数 / DPI / 実寸` を表示。

D4. **ホバー連動のサムネイル絞り込み**: サイズバッジにホバーすると、該当しないサムネイルを dim 表示。例外サイズバッジは例外ファイル全体をまとめて対象にする。

### E. 貼り付けタブ・校正結果UI調整

E1. **貼り付けタブの展開/格納アニメーションを滑らかに調整** ([src/styles.css](src/styles.css)): 展開状態の高さ変化と表示切替を調整し、開閉時の引っかかりを軽減。

E2. **校正結果トグルをテキストエディタタブと同系統に統一** ([src/styles.css](src/styles.css)): 正誤 / 提案 / 並列表示の切替ボタンを `cp-result-panel-tabs` と同じ見た目へ寄せた。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` を **`1.3.1`** に揃え。


---

## v1.3.2: チャプターPDF生成の統合出力・白紙対応・Tachimi連携安定化

### A. チャプターPDFを1ファイルへ統合

A1. **全チャプターを1つのPDFとして出力** ([src/App.tsx](src/App.tsx), [src-tauri/src/commands/tachimi.rs](src-tauri/src/commands/tachimi.rs)): 以前のチャプター別PDF生成ではなく、チャプター順・ページ順を保持した連番ステージングを作成し、TachimiのPDFジョブへ1件の統合ジョブとして渡すように変更。出力名はプロジェクト名をもとにした単一PDF名になる。

A2. **複数チャプター/複数フォルダ混在時のページ順を固定**: 一時フォルダ `merged_pdf` に `0001_c001_p0001.ext` 形式で集約し、同名ファイルや別フォルダ由来のファイルでも順序が崩れないようにした。

A3. **白紙チャプターもPDF化対象に含める**: フロントエンドから `chapter_type` を渡し、ページが空の `blank` チャプターもバックエンドで白紙1ページとして生成する。既存の白紙ページや特殊ページも、周辺ページサイズを参照した白JPEGとしてPDF入力へ含める。

### B. PDF生成の破損・ハング対策

B1. **Tachimi側のPDFジョブ実行を使用**: Daiwari側では画像を無理に再エンコードせず、PSDのみPDF用JPEGに変換し、それ以外はハードリンク/コピーでTachimiへ渡す。これにより画像データ不足やAcrobatでの破損表示を避ける。

B2. **進捗表示とタイムアウトを整理**: `tachimi-pdf-progress` による準備中/ページ整理中/PDF生成中/完了の表示を整え、PDF生成中にユーザーが状態を把握できるようにした。

### C. 不要コード削除

C1. **旧Tachimi起動ルートを削除**: `check_tachimi_exe`, `launch_tachimi_with_files`, `stage_filename`, 旧分割PDF生成ルートを削除し、現在のPDFジョブ方式に一本化。

C2. **Tauriコマンド登録を整理**: `detect_tachimi_exe` と `generate_tachimi_chapter_pdfs` のみを公開し、未使用コマンドをinvoke handlerから除外。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.3.2`** に更新。

---

## v1.4.0: Tachimi由来のネイティブJPEG化・6モード断ち切り移植 / チャプターPDFフロー刷新

別アプリ Tachimi（`Tachimi-_Standalone`）の **Photoshop不要なJPEG化処理（MozJPEG）** と
**6モード断ち切り（タチキリ）+ リサイズ** を Daiwari Manager に移植し、エクスポートと
チャプターPDF生成の両方をその新パイプラインに統一した。

### A. native_jpeg モジュール新設（Tachimi processor 移植）

A1. **新規 `src-tauri/src/native_jpeg/`** ([types.rs](src-tauri/src/native_jpeg/types.rs) / [jpeg.rs](src-tauri/src/native_jpeg/jpeg.rs) / [image_loader.rs](src-tauri/src/native_jpeg/image_loader.rs) / [image_processing.rs](src-tauri/src/native_jpeg/image_processing.rs) / [mod.rs](src-tauri/src/native_jpeg/mod.rs)): Tachimi `processor` から **ノンブル/PDF を除外**して移植。
- `image_loader`: PSDヘッダ直読＋RLE/PackBitsデコードの高速合成読込、失敗時 `psd` crate フォールバック
- `image_processing`: クロップ・線描画・塗りつぶし・リサイズ（`process_single_image`、ノンブル分岐削除）
- `jpeg`: MozJPEG エンコード（`encode_jpeg_mozjpeg` / `write_jpeg_mozjpeg_to_file`）
- `types`: `ProcessOptions`（crop_*/tachikiri_type/stroke_color/fill_color/fill_opacity/reference_*/resize_*/jpeg_quality）+ `color_to_rgb(a)` + `Default` 実装

A2. **断ち切り6モード**: `none` / `crop_only` / `crop_and_stroke` / `stroke_only` / `fill_white` / `fill_and_stroke`。線色・塗り色（黒/白/水色）、塗り不透明度、`reference_*` による基準サイズスケーリングに対応。

A3. **新規コマンド [commands/jpeg_native.rs](src-tauri/src/commands/jpeg_native.rs) `run_native_jpeg_convert`**: ファイル別 `ProcessOptions` を受け取り、`create_unique_output_dir` で出力先重複回避、rayon 並列 + `tokio::task::spawn_blocking`、`jpeg-convert-progress` イベントで進捗送出。レスポンスは旧 `JpegConvertResponse` と同形。

A4. **依存追加**: `Cargo.toml` に `mozjpeg = "0.10"` + `[profile.dev.package.mozjpeg] opt-level = 3`。

### B. 旧Photoshop JPEG経路の完全廃止

B1. **削除**: `src-tauri/src/commands/jpeg.rs` / `src-tauri/src/types/jpeg.rs` / `src-tauri/scripts/jpeg_convert.jsx`。`lib.rs`・`commands/mod.rs`・`types/mod.rs` の登録/再エクスポートを差し替え（`run_photoshop_jpeg_convert` → `run_native_jpeg_convert`）。

B2. **連携箇所も native へ移行**: `commands/tachimi.rs`（PDF用PSD変換）と `App.tsx` の EPUB生成時PSD→JPEG自動変換を `run_native_jpeg_convert` に置換。EPUB生成の Photoshop インストールチェックを撤去（Photoshop不要に）。

B3. **TIFFは無改修**: `run_photoshop_tiff_convert` / `tiff_convert.jsx` / `check_photoshop_installed` は従来どおり Photoshop 経路で残置。

### C. 断ち切りエディタ・型・エクスポートフロー

C1. **型拡張** ([ExportModal.tsx](src/components/modals/ExportModal.tsx)): `TachikiriType` / `BleedColor` / `BLEED_COLOR_MAP` / `BleedRegion`（選択範囲＋モード＋色＋基準サイズ）/ `ResizeMode` を追加。`BleedSettings` を `BleedRegion` 保持に変更。TIFF用に `BleedMargins` と `regionToMargins()` を残置。`ExportOptions` に `resizeMode` / `resizePercent` 追加。

C2. **BleedEditorModal 拡張** ([BleedEditorModal.tsx](src/components/modals/BleedEditorModal.tsx)): サイドパネルに **6モードカード + 線色/塗り色 select + 不透明度スライダー** を追加（ガイド/選択ロジックは維持）。`onApply` は `BleedRegion` を返す。`none` は選択不要でエクスポート可。

C3. **ExportModal UI** ([ExportModal.tsx](src/components/modals/ExportModal.tsx)): JPEGチェックを Photoshop非依存表記に変更し常時有効化、品質スライダー常時表示（既定95）、**リサイズ section（なし/%/2250×3000）追加**、断ち切り設定の表示条件を `convertToTiff || convertToJpg` に拡張。

C4. **useExport 改修** ([useExport.ts](src/hooks/useExport.ts)): JPEG分岐を全置換し全画像ファイルページを `run_native_jpeg_convert` で処理（PSD/非PSD区別撤廃、非ファイルページは従来 `export_pages`）。`resolveBleedRegion` / `buildProcessOptions` を新設・エクスポート。`handlePreExport` を全画像ファイル対象に拡張。

### D. チャプターPDFフロー刷新（JPEG化 → サイズ統一 → 断ち切り → PDF）

D1. **断ち切りキューの汎用化** ([useExport.ts](src/hooks/useExport.ts)): `buildBleedQueue` を抽出、`BleedEditorState.purpose: 'export' | 'tachimi'` を追加。完了時に purpose で分岐。新規 `startTachimiBleed(bleedMode, onComplete)` を公開。`hooks/index.ts` で `resolveBleedRegion` / `buildProcessOptions` を再エクスポート。

D2. **handleLaunchTachimi 改修** ([App.tsx](src/App.tsx)): 実行ファイル検出 → 出力先決定 → **断ち切りエディタ（表紙・本文）経由** → 各ページに `ProcessOptions` を付与して `generate_tachimi_chapter_pdfs` を呼ぶ流れに変更。**PDF出力先をフォルダ選択ダイアログ廃止 → `<デスクトップ>/Script_Output/チャプターPDF` に固定**。

D3. **`prepare_pages_for_pdf`** ([commands/tachimi.rs](src-tauri/src/commands/tachimi.rs)): 旧 `convert_psd_pages_for_pdf`（PSDのみ）を刷新。`TachimiPdfPage.options: Option<ProcessOptions>` を追加し、3段階処理:
1. **JPEG化**: PSD/JPEG/PNG/TIFF 区別なく全画像ページを native_jpeg で断ち切り適用しつつ変換
2. **サイズ一律統一**: 変換結果の最頻サイズへ exact リサイズ（同サイズはスキップ、rayon並列・MozJPEG再エンコード）
3. 統一済みJPEGに `source_path` 差し替え → 既存の統合PDFジョブへ（白紙も統一サイズで生成）

これにより Tachimi の単一DPI計算が全ページで一致し、混在サイズによるPDFの崩れを解消。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.4.0`** に更新。

---

## v1.5.0: チャプターPDF高速化・軽量化 / 例外サイズ色分けUI / デッドコード整理

v1.4.0 で導入した native_jpeg ベースのチャプターPDFフローについて、**JPEG化処理の高速化**と
**生成PDFの軽量化**を行い、あわせて例外サイズ表示のUX改善・未使用コード削除・文言整理を実施。

### A. チャプターPDFのJPEG化高速化

A1. **ベースラインJPEGエンコーダ追加** ([native_jpeg/jpeg.rs](src-tauri/src/native_jpeg/jpeg.rs)):
`write_jpeg_baseline_to_file`（`image` クレートの `JpegEncoder`）を新設。MozJPEG のトレリス量子化／
プログレッシブ最適化を使わず、漫画サイズ（10〜50MP）で数倍高速。チャプターPDFの使い捨て中間
ファイル用。ユーザー向け「JPEGに変換」エクスポートは MozJPEG のまま据え置き（回帰なし）。

A2. **二重エンコードの解消** ([commands/tachimi.rs](src-tauri/src/commands/tachimi.rs) `prepare_pages_for_pdf`):
旧実装は段階1で全ページMozJPEGエンコード後、段階2でサイズ不一致ページを再デコード＋再エンコード
していた。段階1の前に**ヘッダのみ読み**（`read_image_dimensions`）で統一目標サイズを予測
（`predict_output_dims`）し、段階1の単一パスで exact リサイズまで完了。段階2はヘッダ確認のみの
安全網に縮小（通常は再エンコード不発火）。`fast_jpeg` フラグはサーバ側でPDFパスのみ強制。

A3. **ProcessOptions 拡張** ([native_jpeg/types.rs](src-tauri/src/native_jpeg/types.rs)):
`fast_jpeg` / `resize_target_w` / `resize_target_h` を追加（`#[serde(default)]` で後方互換、
フロント変更不要）。`resize_mode` に `"exact"` を追加。

A4. **共有ロジック抽出** ([native_jpeg/image_processing.rs](src-tauri/src/native_jpeg/image_processing.rs)):
クロップ矩形計算を `compute_crop_rect`、リサイズ寸法計算を `resize_dims` に抽出し
`process_single_image` と `predict_output_dims` で共有（実処理と予測の乖離防止）。
`apply_resize` に `"exact"` 分岐（高速な Triangle フィルタ）追加。保存を `fast_jpeg` で
MozJPEG/ベースライン分岐。寸法ヘッダ読み `read_image_dimensions` を
[native_jpeg/image_loader.rs](src-tauri/src/native_jpeg/image_loader.rs) に追加。

### B. 生成PDFの軽量化（Tachimi の "fixed" リサイズ流用）

B1. **`fit_within_pdf_bbox`** ([native_jpeg/image_processing.rs](src-tauri/src/native_jpeg/image_processing.rs)):
Tachimi 標準書き出しと同じ `TARGET_RESIZE_WIDTH×TARGET_RESIZE_HEIGHT`（2250×3000）の枠に
アスペクト比保持で**縮小（拡大はしない）**するヘルパーを追加。

B2. **統一目標サイズに適用** ([commands/tachimi.rs](src-tauri/src/commands/tachimi.rs)):
`prepare_pages_for_pdf` の予測目標サイズと段階2安全網のターゲットを `fit_within_pdf_bbox`
経由に変更。ネイティブ印刷解像度（例 600dpi B4 ≈ 6071×8598px）が約2118×3000px（B5で
約300dpi相当）に抑えられ、画素数約8分の1 → PDFサイズが大幅縮小（実測 ~852MB → 100MB台）。
PDF経路は Tachimi が画像をダウンスケールしない設計のため Daiwari 側で抑制する必要があった。

### C. 例外サイズのジャンル別色分け表示

C1. **ヘッダー例外サイズツールチップのサブグループ化** ([App.tsx](src/App.tsx), [styles.css](src/styles.css)):
`EXCEPTION_SIZE_COLORS`（10色）を追加。例外サイズグループを `${pixelLabel}|${dpiLabel}` 単位で
`exceptionSubGroups` に集約し、サイズキー昇順で安定ソートして固定色を割当（**同じ例外サイズ＝同色**）。
ツールチップはサブグループごとに「色スウォッチ＋サイズ見出し＋件数」を表示。
旧 `.image-size-tooltip-filemeta`（参照消滅）を削除。

C2. **カードのアラートバッジを例外サイズ色とリンク** ([ThumbnailCard.tsx](src/components/preview/ThumbnailCard.tsx), [App.tsx](src/App.tsx)):
`exceptionColorMap`（sizeKey→色）と `getPageExceptionColor(page)` を追加。グリッドの
`<ThumbnailCard>` に `alertColor` を渡し、`.thumbnail-file-alert` の背景色をその例外サイズ色に。
非例外/規格内は従来の赤を維持。

C3. **例外サイズページはバッジを常時表示** ([ThumbnailCard.tsx](src/components/preview/ThumbnailCard.tsx)):
バッジ描画条件を「検証アラートあり **または** 例外サイズ（`alertColor` あり）」に変更。
検証アラートが無くても例外サイズなら色付きバッジを表示（検証アラート無し時のツールチップは
「例外サイズ（規格外）: 幅×高px / dpi」）。

C4. **ツールチップのファイル名クリックでカード選択** ([App.tsx](src/App.tsx), [styles.css](src/styles.css)):
`colorModeGroups` / `imageSizeGroups.files` / `exceptionSubGroups.files` に page `id` を保持。
`selectPageFromSummary(pageId)` を追加（`selectPage` ＋ `[data-page-id]` を中央へ
`scrollIntoView`）。カラーモード／例外サイズ両ツールチップの各行を `role="button"` ＋
`onClick`（`stopPropagation`）でクリック可能化、`.color-mode-tooltip-clickable` で
`cursor: pointer`。`blockIfCmyk` の一覧生成を `.map(f => f.name)` に修正。

### D. デッドコード削除（フロント確実デッド）

横断調査（`tsc --noEmit` の `noUnusedLocals` / `cargo clippy` はクリーン済み、追加で公開
シンボルの未参照を全文検証）で確認した未使用コードを削除:

- `SaveIcon` ([icons.tsx](src/icons.tsx))
- `EpubMetadataPanel` / `EpubCssEditorModal`（ファイル削除 + [components/epub/index.ts](src/components/epub/index.ts) の barrel 再エクスポート）
- store 保存系クラスタ ([store.ts](src/store.ts)): 状態 `currentProjectPath` / `isModified` /
  `lastSavedAt`、アクション `setProjectPath` / `setProjectName` / `markAsModified` /
  `markAsSaved` / `loadProjectState` / `canUndo` / `canRedo`（保存機能撤去・Ctrl+Z/Y撤去で
  参照消滅。CLAUDE.md 旧記載の保持理由 `handleOpenProject` は v1.0.5 で削除済み）。
  連鎖修正: `saveHistory()` 戻り値の `isModified`、`resetProject()` の該当初期化、未使用化した
  `SavedUiState` import を除去
- 型 ([types.ts](src/types.ts)): `FileValidationResult` / `RecentFile` / TIFF型クラスタ
  （`TiffFileConfig` / `TiffGlobalSettings` / `TiffConvertConfig` / `TiffConvertResult` /
  `TiffConvertResponse`）

> 保持: バックエンド孤立コマンド（`save_project` 等）と store `undo`/`redo` 本体は
> CLAUDE.md 記載の「将来用に保持」に従い未変更（今回の削除対象外）。

### E. 文言・出力先の整理

E1. **ボタン文言変更** ([App.tsx](src/App.tsx)): ツールバーの「チャプターPDF」ボタンを
**「PDF生成」**に変更（`title` も「PDFを生成」に統一）。

E2. **出力フォルダ名変更** ([App.tsx](src/App.tsx)): チャプターPDFの出力先を
`<デスクトップ>/Script_Output/チャプターPDF` → **`<デスクトップ>/Script_Output/台割pdf`** に変更。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.5.0`** に更新。

> **このバージョンの構造変更まとめ**:
> - 旧: チャプターPDFのJPEG化が MozJPEG 最大圧縮＋サイズ不一致ページの二重エンコードで低速 →
>   新: ベースライン高速エンコーダ＋目標サイズ事前予測で単一パス化
> - 旧: 中間JPEGがネイティブ印刷解像度のままで生成PDFが数百MB →
>   新: Tachimi の "fixed" 相当（2250×3000枠）に縮小してPDFを大幅軽量化
> - 旧: 例外サイズはツールチップ1リストで混在表示／カードに色目印なし →
>   新: 同一例外サイズごとに色分け、カードのアラートバッジも同色リンク（検証アラート無しでも表示）
> - 旧: サマリーのファイル名はクリック不可 → 新: クリックで該当カードを選択＋スクロール
> - 旧: 保存機能撤去で残った未使用 store/型/コンポーネント/アイコンが残存 → 新: 確実デッドを削除
> - 旧: ボタン文言「チャプターPDF」／出力先「Script_Output/チャプターPDF」 →
>   新: 「PDF生成」／「Script_Output/台割pdf」

---

## v1.5.1: チャプター単位のリンク一括更新

v1.5.0 までは、フォルダ内のファイルを差し替えた後にリンク更新するには、ページ単位の黄色「リンクを更新」ボタン（`fileValidationStatus === 'modified'` の時のみ表示）を1ページずつクリックするか、`fileValidationStatus` が `modified` 以外（`missing` / `meta_error` 等）のページについては個別にファイル選択し直すしかなかった。チャプター全体を一度に再リンクする手段を追加。

### A. 一括リンク更新アクション

A1. **store アクション `refreshPagesLinks(updates)` 追加** ([src/store.ts](src/store.ts)): `{ pageId, file: FileInfo }[]` を受け取り、該当する全ページの `filePath` / `fileName` / `fileType` / `fileSize` / `modifiedTime` を更新し、`thumbnailStatus: 'pending'`・`fileValidationStatus: 'ok'`・キャッシュキー無効化までを **`saveHistory()` 1回** で行う。既存の `setPageFile` をループ呼び出しすると Undo 履歴が件数分積まれてしまうため、専用の一括アクションとして分離。

### B. App.tsx ハンドラ

B1. **`handleRefreshChapterLinks(chapterId)`** ([src/App.tsx](src/App.tsx) `handleRefreshFile` の直後): チャプター内の `pageType === 'file'` かつ `filePath` あり のページを抽出し、**親フォルダ単位でグループ化**してから `get_folder_contents` を**ユニークなフォルダごとに1回**だけ呼ぶ。同一フォルダ内に N ページあっても invoke は 1 回で済む（30ページなら 30→1）。
- 取得した `FileInfo[]` を `path → FileInfo` の Map に変換し、各ページの `filePath` で照合
- 一致したものは `updates[]` へ、見つからなかったものは `missing[]`（ファイル名ベース）へ振り分け
- `updates.length > 0` のときだけ `refreshPagesLinks(updates)` を呼ぶ（空ならストアを触らない）
- 結果は既存の `setExportResultDialog` を再利用して通知: 更新件数＋欠落件数を本文に、欠落ファイル名一覧（先頭20件・超過分は「…他N件」）を `details` に表示。`updates.length === 0` のときは `isError: true`
- フォルダの読み込みに失敗した場合も同ダイアログで詳細を表示

### C. UI 配線

C1. **チャプター「…」メニューに項目追加** ([src/components/sidebar/ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx)):
- 既存の `MoreIcon` トリガーメニューに `RefreshIcon` 付きの **「リンクを一括更新」** を、リネームの直下・フォルダから差し替えの直上に挿入
- 表示条件は **`chapter.pages.some(p => p.pageType === 'file')`** — ファイルページが 1 つでもあるチャプターでのみ表示（blank チャプター・白紙のみのチャプターでは出ない）。「フォルダから差し替え」のチャプタータイプ限定（cover / chapter / intermission / ad / title / toc）とは判定軸が違う点に注意
- props として `onRefreshChapterLinks: () => void` を追加し、App.tsx 側で `handleRefreshChapterLinks(chapter.id)` を束ねて渡す
- tooltip: 「チャプター内の全ページについて、同じパスのファイルを再読込してメタデータ・サムネイルを更新」

### バージョン同期

今回は機能追加のみで **`package.json` 等のバージョンファイルは未更新**（v1.5.0 のまま）。リリース時にまとめて `1.5.1` へ昇格する想定。

> **このバージョンの構造変更まとめ**:
> - 旧: ページ単位の黄色「リンクを更新」ボタンを1ページずつクリックする必要 → 新: チャプター「…」メニューの「リンクを一括更新」1クリックで全ページ再リンク
> - 旧: 同一フォルダの N ページに対して `get_folder_contents` を N 回呼ぶ素朴な実装しかなかった → 新: 親フォルダ単位でグループ化し invoke 回数を `unique(folder)` 件に圧縮
> - 旧: setPageFile を N 回呼ぶと Undo 履歴が N 段積まれる → 新: `refreshPagesLinks` で `saveHistory()` 1 回・履歴 1 段に集約

---

## v1.5.2: PDF読み込み対応（ラスタライズ at boundary）

ユーザーが PDF をフォルダドロップ／ファイル選択／個別ドロップで投入すると、各ページが自動でチャプターのページとして取り込まれるように拡張。実装戦略は「PDF を受け取った瞬間に JPEG 群へ展開し `FileInfo[]` として上位に返す」boundary 変換方式で、既存パイプライン（サムネイル / 検証 / カラーモード / エクスポート / EPUB / Tachimi PDF / 例外サイズ）は **一切改修せずに** PDF 由来 JPEG をそのまま処理する。

### A. PDFium 依存と DLL バンドル

A1. **`pdfium-render = { version = "0.8", features = ["thread_safe", "image"] }`** を [src-tauri/Cargo.toml](src-tauri/Cargo.toml) に追加。

A2. **DLL 配置**: `src-tauri/binaries/pdfium.dll` に [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries/releases) の `pdfium-win-x64.tgz` から取り出した `bin/pdfium.dll`（約 10MB）を配置。[src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) の `bundle.resources` に `"binaries/pdfium.dll"` を追加。リポジトリには 154B のプレースホルダ `pdfium.dll` がコミットされており、Tauri バンドラのリソース存在チェックを通過しつつ起動時には「サイズが小さすぎる」として除外される（[binaries/README.md](src-tauri/binaries/README.md) に手順を記載）。

A3. **G:\共有ドライブ 自動取得** ([src-tauri/src/commands/pdf.rs](src-tauri/src/commands/pdf.rs) `fetch_pdfium_from_shared`): montblanc アプリの AI モデル自動取得 (`install-ai-models.ps1` の `Copy-DirectoryFromShared`) と同様のパターンで、初回 PDF 取り込み時に DLL が見つからなければ G:\共有ドライブ 上の以下候補から `fs::copy` でローカルキャッシュにコピーする:
- `G:\共有ドライブ\ソニーからのデータ受領\編集企画_AT業務推進\DTP制作部\Daiwari PDF\bin\pdfium.dll` ← **現運用先**（bblanchon アーカイブ展開時）
- `G:\共有ドライブ\ソニーからのデータ受領\編集企画_AT業務推進\DTP制作部\Daiwari PDF\pdfium.dll`
- `G:\共有ドライブ\編集企画_AT業務推進\DTP制作部\pdfium.dll`
- `G:\共有ドライブ\編集企画_AT業務推進\DTP制作部\Daiwari Manager\pdfium.dll`
- `G:\共有ドライブ\編集企画_AT業務推進\DTP制作部\daidori-manager\pdfium.dll`

ローカルキャッシュ先は `%LOCALAPPDATA%\daidori-manager\binaries\pdfium.dll`（既存のサムネイルキャッシュ `daidori-manager/thumbnails/` と同じディレクトリ規約）。一度コピーされれば以後は G: 接続なしで動作する。コピー進捗は既存 `pdf-rasterize-progress` イベントに `fetching` / `fetched` フェーズとして相乗りし、フロント側オーバーレイは「PDFエンジン (pdfium.dll) のセットアップ」タイトル＋共有元パスを表示する。

A4. **遅延 Pdfium 初期化** ([src-tauri/src/commands/pdf.rs](src-tauri/src/commands/pdf.rs) `create_pdfium`): `Pdfium` 型は `Send` ではないため `OnceLock<Mutex<Pdfium>>` 方式は使えず、`tokio::task::spawn_blocking` のブロッキングスレッド内で **呼び出しごとに `Pdfium::bind_to_library` → `Pdfium::new`** を実行する。OS が DLL をキャッシュするため繰り返しオーバヘッドは数十 ms 程度で、レンダリング時間に比べて無視できる。DLL は exe と同階層 → `resources/binaries/pdfium.dll` → ローカルキャッシュ → `binaries/pdfium.dll` の順で探索し、1MB 未満はプレースホルダ扱いで除外、見つからなければ A3 の G: ドライブ取得を試行、最終フォールバックは `bind_to_system_library`。

### B. rasterize_pdf コマンド

B1. **新規 [src-tauri/src/commands/pdf.rs](src-tauri/src/commands/pdf.rs) `rasterize_pdf(pdf_path) -> Vec<FileInfo>`**:
- 出力先 = `<pdf_basename>_pages/`（PDF と同じ親フォルダ配下、Windows 禁止文字を `_` で除去）
- ファイル名 = `p0001.jpg, p0002.jpg, ...` 4 桁ゼロパディング（natord 並び替え保証）
- DPI = 350（カラー漫画印刷標準、CLAUDE.md の `target_dpi_color` と整合）
- エンコーダ = MozJPEG 品質 95（既存 [src-tauri/src/native_jpeg/jpeg.rs](src-tauri/src/native_jpeg/jpeg.rs) `write_jpeg_mozjpeg_to_file` を再利用、PDF 用ベースラインではなく品質側を採用）
- 内部処理: pdfium で直列レンダリング → RGBA → RGB → rayon `par_iter` で並列 MozJPEG エンコード（pdfium-render の `thread_safe` は内部 mutex で並列メリットなし → レンダリングだけ直列、エンコードは並列で全コア利用）
- ページ数上限 = 300、超過時はエラー
- パスワード保護 PDF はエラー文言「パスワード保護されたPDFは読み込めません」に変換

B2. **サイドカーキャッシュ** (`.daiwari-pdf-meta.json`): `pdf_size` / `pdf_mtime_ns` / `page_count` / `dpi` / `encoder` をサブフォルダ直下に JSON で保存。再ラスタライズ呼び出し時にメタが一致 **かつ** 全 `p{NNNN}.jpg` が揃っていれば即座に既存 JPEG の `FileInfo[]` を返す（重い処理を完全スキップ）。

B3. **進捗イベント** (`pdf-rasterize-progress`): `{ phase: "loading" | "rendering" | "encoding" | "done", current, total, pdfName }` を `Emitter::emit` で逐次送出。フロントは `listen` で購読し専用オーバーレイ（既存の `.epub-progress-overlay` / `.epub-progress-dialog` クラスを流用）に反映、`done` 受信で 800ms 後に自動消去。

B4. **コマンド登録** ([src-tauri/src/commands/mod.rs](src-tauri/src/commands/mod.rs), [src-tauri/src/lib.rs](src-tauri/src/lib.rs)): `pub mod pdf;` 追加、`invoke_handler!` に `rasterize_pdf` を登録。

### C. バックエンドのファイル列挙

C1. **`SUPPORTED_EXTENSIONS` に `"pdf"` 追加** ([src-tauri/src/constants.rs](src-tauri/src/constants.rs)): `get_folder_contents` が PDF をエントリとして拾うようになる。`FileInfo.file_type` には `"pdf"` のマーカーが入る。

C2. **`get_file_type` に `"pdf"` 分岐追加** ([src-tauri/src/image_utils.rs](src-tauri/src/image_utils.rs)): フロントの `FileType` union（`'jpg' | 'jpeg' | 'png' | 'psd' | 'tif' | 'tiff'`）には **意図的に追加しない**。PDF は `expandPdfFiles` で消費されて `addPagesToChapter` には到達しない設計のため、union を汚さない。

C3. **`get_folder_contents` には PDF ラスタライズを組み込まない**: 当初は backend でインライン展開する案だったが、フォルダ検証や `validate_pages` から呼ばれる経路もあるため、**意図せず無関係な PDF が大量に展開される**事故を避け、フロント側の `expandPdfFiles` ヘルパで明示的に呼ぶ責務分離に変更。

### D. フロント展開ヘルパ

D1. **新規 [src/utils/pdf.ts](src/utils/pdf.ts) `expandPdfFiles(files: FileInfo[]): Promise<ExpandPdfResult>`**: 入力配列を走査し `file_type === 'pdf'` のエントリを `rasterize_pdf` 経由で JPEG 群に置換、それ以外は素通し。エラーは `errors[]` に積んで処理を継続。戻り値の `{ files, pdfCount, expandedCount, errors }` を呼び出し側で扱う。

D2. **`rasterizeSinglePdf(pdfPath)`** も補助関数として export（個別ドロップ／単独 PDF 選択時の最小経路で利用可能）。

### E. App.tsx 配線

E1. **ファイル選択ダイアログの拡張子フィルタ**: `'画像ファイル'` → `'画像・PDFファイル'`、`extensions` に `'pdf'` を追加（4 箇所一括: ページ追加 / ファイル挿入 / 特殊ページ用 / その他）。

E2. **`handleAddPages` / `handleAddFolder` / `handleInsertFile` / `handleReplacePages`**: `get_folder_contents` の結果を **`expandPdfFiles` に通してから** `addPagesToChapter` / `addPagesToChapterAt` / `replacePagesInChapter` へ。`handleAddFolder` は各フォルダのファイルを個別に展開してから `folderEntries` に集約（複数フォルダ + 各フォルダ内の PDF にも対応）。

E3. **`handleSelectFile`（表紙・奥付の単一ファイル）**: PDF が選ばれた場合、`expandPdfFiles` 後の **1 ページ目のみ** を `setPageFile` で採用（表紙チャプターは 1 ファイル制限のため）。

E4. **`handleRefreshFile` / `handleRefreshChapterLinks`**: 既存リンクの再読み込みは **既に展開済みの JPEG** を再走査するだけのため PDF 展開を呼ばない（無関係な PDF が再ラスタライズされない）。

E5. **ドロップハンドラ `__dropHandler`**:
- 分類フェーズで `imageExtensions` から `'pdf'` を除外し、新たに `pdfPaths` として分離
- 通常画像は親フォルダ単位でグルーピング → `get_folder_contents` で取得
- **PDF は 1 つ 1 つを独立した `folderEntry`** として追加（`folderName = pdf_basename`）。これにより複数 PDF を同時ドロップした場合、既存の **「分割ダイアログ」** ロジックが自動的に発動し、各 PDF を別チャプターに振り分けるか確認できる
- フォルダ候補も `expandPdfFiles` を通して内包される PDF を展開
- すべての展開エラーを `notifyPdfExpansionErrors` でまとめて 1 ダイアログ表示

E6. **PDF 進捗オーバーレイ** ([src/App.tsx](src/App.tsx)): `pdfRasterizeProgress` state + `pdf-rasterize-progress` リスナで取得 → 既存の `.epub-progress-overlay` / `.epub-progress-dialog` CSS を流用したオーバーレイで「PDFを取り込み中: {ファイル名}」+ phase ラベル + プログレスバー + `{current} / {total} ページ ({percent}%)` を表示。`phase === 'done'` で 800ms 後に自動消去。

### F. CMYK ガード・例外サイズへの影響

F1. **CMYK 警告**: PDF は 350dpi で sRGB JPEG として焼くため、元 PDF が CMYK でも `blockIfCmyk` には引っかからない（意図通り）。

F2. **例外サイズバッジ**: PDF 由来 JPEG は他のページと寸法が異なれば、既存ロジック通り「例外サイズ」グループとして同色バッジで表示される（PDF 主体のチャプターでは全ページが同一例外サイズ＝同一色でグループ化、UX 上の混乱は最小）。

### G. チャプターヘッダ「+」メニューのラベル明確化

G1. **「ファイルを選択」→「ファイル / PDF を選択」へ改名** ([src/components/sidebar/ChapterItem.tsx](src/components/sidebar/ChapterItem.tsx)): チャプター右上の `+` ボタンを開いたポップアップメニューで、PDF 対応が discoverable になるようラベル変更。
- 旧: 「ファイルを選択」/「フォルダを選択」 — ユーザーが PDF を選びたくて「フォルダを選択」を開くと OS のディレクトリピッカーは PDF ファイルを表示しないため詰む事故が発生していた
- 新: 「**ファイル / PDF を選択**」/「フォルダを選択」 — どちらのボタンを使うべきか直感的に分かるように

G2. **tooltip 追加**:
- 「ファイル / PDF を選択」: 「画像ファイル (JPG/PNG/PSD/TIFF) または PDF を選択」
- 「フォルダを選択」: 「フォルダ内の画像ファイルを一括追加（PDFはフォルダピッカーでは選べません）」 — OS 仕様の制約を明示

### H. PDFium DLL 共有ドライブパスの実運用反映

H1. **`shared_pdfium_candidates` を実配置に合わせて更新** ([src-tauri/src/commands/pdf.rs](src-tauri/src/commands/pdf.rs)): 当初は推測ベースで `編集企画_AT業務推進\DTP制作部\Daiwari Manager\` を想定していたが、実際の DTP制作部 配下のフォルダ構成（`JSON` / `OCR` / `Photoshop Scrypts` / `テキスト抽出プロンプト`）には Daiwari 用フォルダが存在しなかった。ユーザーが `G:\共有ドライブ\ソニーからのデータ受領\編集企画_AT業務推進\DTP制作部\Daiwari PDF\` 配下に **bblanchon の pdfium アーカイブ全体**（`bin/`, `include/`, `lib/`, `licenses/`, `LICENSE`, `VERSION` 等）を解凍配置したため、`bin/pdfium.dll`（7,262,208 bytes ≈ 7MB）を最優先候補に組み込んだ。

H2. **候補パスの優先順位**（5 候補に拡張）:
1. `…\Daiwari PDF\bin\pdfium.dll` ← 現運用先（アーカイブ展開時の bin/ サブフォルダ）
2. `…\Daiwari PDF\pdfium.dll` ← 将来 DLL のみ平置きされた場合のフォールバック
3. `編集企画_AT業務推進\DTP制作部\pdfium.dll` ← フォールバック
4. `…\DTP制作部\Daiwari Manager\pdfium.dll` ← 旧運用想定
5. `…\DTP制作部\daidori-manager\pdfium.dll` ← 英字運用想定

エラー文言も具体的な現運用パス（`Daiwari PDF\bin\pdfium.dll`）を明示するよう更新。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.5.2`** に更新（DLL バンドルを伴うのでメジャー寄りに昇格しない）。

> **このバージョンの構造変更まとめ**:
> - 旧: PDF は対応外。ユーザーは別ツールで PDF → 画像にバラしてから取り込む必要 → 新: PDF を直接ドロップ/選択するだけで各ページが 350dpi MozJPEG q95 で `<pdf>_pages/p0001.jpg` … に焼かれ、チャプターのページとして並ぶ
> - 旧: 既存パイプライン（サムネイル/検証/カラーモード/エクスポート/EPUB/Tachimi PDF/例外サイズ）は PDF を知らない → 新: boundary 変換で PDF を JPEG 化してから上位に渡すため、**既存パイプラインに分岐追加ゼロ**で PDF 由来ページが透過的に流れる
> - 旧: 一度ラスタライズした PDF を再度ドロップしても毎回展開していた（仕様上ありえなかった） → 新: `.daiwari-pdf-meta.json` サイドカーで `(pdf_size, mtime, page_count, dpi, encoder)` 一致 + 全 JPEG 揃いを検出して即スキップ
> - 旧: tachimi-pdf-progress / epub-progress と同じ進捗パターンを持たなかった → 新: `pdf-rasterize-progress` で loading/rendering/encoding/done フェーズを送出、既存の `.epub-progress-*` CSS を流用した専用オーバーレイで表示
> - 旧: 複数 PDF を同時ドロップする経路が存在しなかった → 新: ドロップハンドラで各 PDF を独立した `folderEntry` として扱うため、既存の「複数フォルダ → 分割ダイアログ」UX がそのまま発動し各 PDF を別チャプターに振り分けられる
> - 旧: pdfium.dll はユーザーが手動で配置する必要があった → 新: montblanc の AI モデル自動取得パターンに倣い、初回 PDF 取り込み時に G:\共有ドライブ から `%LOCALAPPDATA%\daidori-manager\binaries\pdfium.dll` へ自動コピー。共有先候補は 5 つ用意し、いずれかにあれば取得・以後はローカルキャッシュから読み込み（G: 接続なしで動作）
> - 旧: 共有 DLL 配置先を `DTP制作部\Daiwari Manager\` と推測ベースで設計していたが該当フォルダは存在しなかった → 新: 実際の運用に合わせて `DTP制作部\Daiwari PDF\bin\pdfium.dll`（bblanchon アーカイブ展開そのまま）を最優先候補に組み込み、エラー文言も実パスを明示
> - 旧: チャプター「+」メニューの「ファイルを選択」が PDF 対応か不明で、ユーザーが PDF 取り込みのつもりで「フォルダを選択」を押すと OS のフォルダピッカーが PDF を表示せず詰む事故が起きた → 新: 「ファイル / PDF を選択」にラベル変更 + 両ボタンに tooltip 追加（フォルダピッカーでは PDF が選べない旨を明示）し、PDF 取り込みの正しい導線が discoverable に

---

## v1.5.3: `.daiw` ファイル関連付け（ビルド失敗・GitHub Release 未作成）

`.daiw` 拡張子の Windows ファイル関連付けを目的に `bundle.fileAssociations` を
`tauri.conf.json` に追加したが、`icon` フィールドが Tauri 2 の `FileAssociation`
スキーマ（`#[serde(deny_unknown_fields)]`）に無く、CI でのビルドが
`Additional properties are not allowed ('icon' was unexpected)` で失敗した。
タグ `v1.5.3` は push 済みだが GitHub Release ページは作成されていない。実際に
ユーザーへ配布されたのは v1.5.4 から。

> Tauri 2 の `FileAssociation` 構造体には `ext` / `content_types` / `name` /
> `description` / `role` / `mime_type` / `rank` / `exported_type` /
> `android_intent_action_filters` のみ存在し、**`icon` は無い**。per-association
> アイコンは NSIS インストーラフックなどの追加対応が必要で、Tauri 2 標準では
> アプリ本体アイコン（`bundle.icon` の `.ico`）が `.daiw` に自動採用される。

---

## v1.5.4: `.daiw` ファイル関連付け（v1.5.3 修正リリース）

[src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) の `bundle.fileAssociations`
から `icon` フィールドを削除して Tauri 2 スキーマに準拠させ、`.daiw` を Windows に
登録できるようにした。NSIS バンドラがインストール時に `HKCR\.daiw` →
`HKCR\DaiwariProject` のレジストリエントリを書き込み、`DefaultIcon` には
`bundle.icon` の `icons/icon.ico`（= `daidori_icon` ベース）が自動採用される。

### A. tauri.conf.json — fileAssociations 修正

```json
"fileAssociations": [
  {
    "ext": ["daiw"],
    "name": "DaiwariProject",
    "description": "台割マネージャー プロジェクトファイル",
    "role": "Editor"
  }
]
```

- `icon` フィールドを削除（Tauri 2 スキーマで未サポート）
- それ以外は v1.5.3 と同じ

### B. 副産物として残る ICO ファイル

[src-tauri/icons/daidori_project.ico](src-tauri/icons/daidori_project.ico)
（v1.5.3 時に `logo/daidori_project_icon.png` から `png-to-ico` で生成した 4 解像度
ICO）はリポジトリに残置するが、本バージョンでは参照されない。将来 NSIS インストーラ
フックで `.daiw` 専用アイコンを上書きする際に再利用可能。

### C. 既知の制約

- `.daiw` ファイルのアイコンはアプリ本体アイコン（`daidori_icon`）と同一になる。
  プロジェクト専用アイコン（`daidori_project_icon`）を別途使いたい場合は、
  `bundle.windows.nsis.installerHooks` で `WriteRegStr HKCR
  "DaiwariProject\DefaultIcon"` を上書きする NSIS マクロを追加する必要がある（未対応）。
- v1.0.5 で `.daiw` の **保存/読込 UI 経路**（`save_project` / `load_project` を
  呼ぶ箇所）が削除済みのため、Explorer でダブルクリックしてもアプリは起動するが
  ファイルは読み込まれない。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.5.4`** に更新。

> **このバージョンの構造変更まとめ**:
> - 旧（v1.5.3）: `bundle.fileAssociations[0].icon` を指定 → Tauri 2 スキーマ違反で CI ビルド失敗
> - 新（v1.5.4）: `icon` フィールドを削除しスキーマ準拠 → ビルド成功、`.daiw` 拡張子が
>   Windows に登録される（アイコンはアプリ本体アイコンを使用）

---

## v1.5.6: `.daiw` ダブルクリック起動でチャプターが復元されるよう修正（ファイル関連付け起動の読込実装）

### 背景・症状

ユーザー報告: 「保存した `.daiw` をエクスプローラーでダブルクリックして開いてもチャプターが
復元されない」（インストール版で発生）。

### 根本原因

- `.daiw` 保存/読込コード自体は正常で、**アプリ内「開く」ボタン / Ctrl+O 経由の読込は問題なく動作する**
  （`save_project` / `load_project` / `loadProjectFromPath` / `restoreProjectFromFile` を静的解析で確認、
  JS↔Rust のフィールド対応も完全一致、`tsc --noEmit` / `cargo check` クリーン）。
- 真の原因は、**`.daiw` 拡張子の Windows ファイル関連付け（v1.5.4 で NSIS 登録済み）でダブルクリック起動した際、
  OS が渡すファイルパス（`argv[1]`）を受け取って読み込む処理が一切実装されていなかった**こと。
  `src-tauri/src/lib.rs` の `setup` に CLI 引数・single-instance・deep-link ハンドラが無く、
  アプリは空のプロジェクトで起動していた（= v1.5.4「既知の制約」に記載のまま）。

> 注: CLAUDE.md v1.5.4「既知の制約」の「v1.0.5 で `.daiw` の保存/読込 UI 経路が削除済み」という記述は
> 実コードと乖離していた。保存/読込 UI（サイドバー「開く」「保存」ボタン・Ctrl+S/Ctrl+Shift+S/Ctrl+O・
> `saveProjectToPath` / `loadProjectFromPath`）は `c5af7b4`（=v1.5.3 相当コミット）で**再追加済み**であり、
> 本バージョン時点で正常に機能している。本修正で v1.5.4「既知の制約」の後段（ダブルクリックで読み込まれない）も解消。

### A. single-instance プラグイン導入と起動ファイル受け渡し

`tauri-plugin-single-instance` を導入し、コールドスタート（アプリ未起動）／ウォームスタート（既に起動中）の
2 経路でダブルクリック起動を処理する。**新規の読込ロジックは作らず、既存の `loadProjectFromPath` を再利用。**

A1. **依存追加** ([src-tauri/Cargo.toml](src-tauri/Cargo.toml)): `tauri-plugin-single-instance = "2"` を追加。

A2. **バックエンド** ([src-tauri/src/lib.rs](src-tauri/src/lib.rs)):
- `use tauri::Emitter;` を追加（`app.emit` 用）。
- `struct PendingOpen(Mutex<Option<String>>)` を managed state として追加。
- `find_daiw_path(args)`: 起動引数（exe パス除く）から、実在しかつ拡張子 `.daiw` のパスを 1 件抽出するヘルパー。
- `take_pending_open_path` コマンド: 保持済み起動パスを取得し**同時にクリア**（多重実行に対して冪等で二重読込を防止）。
- `tauri_plugin_single_instance::init` を**最初のプラグインとして登録**（Tauri 公式要件）。
  ウォームスタート時にコールバックが発火し、`main` ウィンドウを `unminimize` + `set_focus` してから
  `open-project-file` イベントを emit。これにより**多重起動も抑止**される。
- `setup` でコールドスタートの `std::env::args()` から `.daiw` を拾って `PendingOpen` に保持。
- `invoke_handler!` に `take_pending_open_path` を登録。

A3. **フロントエンド** ([src/App.tsx](src/App.tsx)): `loadProjectFromPath` 定義以降に useEffect を 2 つ追加。
- コールドスタート: マウント時に `take_pending_open_path` を呼び、返ったパスがあれば `loadProjectFromPath` で読込。
- ウォームスタート: `open-project-file` イベント（`@tauri-apps/api/event` の `listen`）を購読して即時読込。

### 動作

- `.daiw` をダブルクリック → アプリ起動 → チャプター/ページが復元された状態で開く（コールドスタート）。
  main ウィンドウは `visible: false` で生成されスプラッシュ表示中に裏で読込が完了するため UX も自然。
- 起動中に別の `.daiw` をダブルクリック → 二重起動せず、既存ウィンドウが前面化して当該ファイルを読込（ウォームスタート）。
- アプリ内「開く」/ Ctrl+O 経路は従来どおり（無変更）。

### 権限

- `take_pending_open_path` はカスタムコマンドのため capability 追記不要。
- `app.emit` / フロント `listen` は既存の `core:event:default` でカバー。
- single-instance プラグインはコマンドを追加しないため権限追記不要。

### 検証

- `npx tsc --noEmit` 成功 / `cargo check` 成功（`tauri-plugin-single-instance v2.4.2` 取得・コンパイル、警告なし）。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.5.6`** に更新。

> **このバージョンの構造変更まとめ**:
> - 旧: `.daiw` 関連付けは登録済みだがダブルクリック起動時にファイルパスを受け取る処理が無く、空プロジェクトで起動 →
>   新: `tauri-plugin-single-instance` 導入 + コールドスタートは起動引数保持→フロントが取得、ウォームスタートはイベント発火で、
>   既存の `loadProjectFromPath` を使ってダブルクリックした `.daiw` を確実に復元（多重起動抑止の副次効果あり）
> - 補足: CLAUDE.md v1.5.4 の「保存/読込 UI は削除済み」記述は実コードと乖離していた（v1.5.3 で再追加済み）点を本節で訂正。
>   なお v1.5.5（分割 EPUB 関連: split range 編集・page role override・split EPUBCheck 結果表示）は本リポジトリにマージ済みだが CLAUDE.md には未文書化。

---

## v1.5.8: EPUB生成モードの画面統合と `.daiw` 専用アイコン設定

EPUB生成をモーダル表示から画面モード切替に変更し、MojiQ の「指示入れ / 校正チェック」切替に近い形で、上部の表示モードトグルから EPUB 生成画面へ移動できるようにした。あわせて `.daiw` プロジェクトファイルの専用アイコン登録、EPUB分割出力UIの移植、ツールバー整理を行った。

### A. `.daiw` プロジェクトアイコン設定

A1. **プロジェクト専用 ICO を追加**:
- `logo/daidori_project_icon.png` から `src-tauri/icons/daidori_project.ico` を生成。
- 配布時に参照できるよう `src-tauri/resources/daidori-project.ico` を追加。

A2. **Tauri / NSIS 設定** ([src-tauri/tauri.conf.json](src-tauri/tauri.conf.json), [src-tauri/nsis/installer-hooks.nsh](src-tauri/nsis/installer-hooks.nsh)):
- `resources/daidori-project.ico` を bundle resources に追加。
- `.daiw` file association に `mimeType: application/x-daiwari-project` を追加。
- NSIS installer hook で `HKCR\DaiwariProject\DefaultIcon` を `daidori-project.ico` に上書きし、Explorer 上で `.daiw` がアプリ本体アイコンではなくプロジェクト専用アイコンになるよう修正。

### B. EPUB生成をモーダルから表示モードへ変更

B1. **表示モードトグル化** ([src/App.tsx](src/App.tsx)):
- 旧: ツールバーの「EPUB生成」ボタンで `EpubMetadataModal` をモーダル表示。
- 新: 上部の表示モードトグルに `リスト / 見開き / EPUB` を並べ、EPUBを選ぶと `previewMode: 'epub'` に切り替える。
- EPUBモードへ入る時に `loadEpubFromDaidori()` を実行し、右サイドバーを展開する。
- `toolbar-content` から「EPUB生成」ボタンを削除し、PDF生成 / JPEG/TIF生成だけを残した。

B2. **右サイドバーに EPUB 設定を埋め込み** ([src/components/modals/EpubMetadataModal.tsx](src/components/modals/EpubMetadataModal.tsx), [src/styles.css](src/styles.css)):
- `EpubMetadataModal` に `embedded` prop を追加。
- EPUBモード中は右サイドバーへ EPUB 出力設定 / 書籍情報 / UUID / 生成情報 / ライセンス / 生成ボタンを表示。
- 生成処理は既存の `handleEpubGenerate` をそのまま使用し、単体出力・分割出力・EPUBCheck 結果表示の経路を維持。

B3. **EPUBモード時の左サイドバー非表示**:
- EPUB生成モードでは左のチャプター編集サイドバーをレンダーしない。
- 中央は EPUB プレビュー、右は EPUB 設定に集中する構成に変更。

### C. EPUB分割出力UIの移植

C1. **分割出力チェック時の中央表示切替** ([src/components/epub/EpubMakerView.tsx](src/components/epub/EpubMakerView.tsx), [src/components/modals/EpubMetadataModal.tsx](src/components/modals/EpubMetadataModal.tsx)):
- 右サイドバーの「分割出力」を ON にすると、中央プレビューが分割範囲選択サムネイル一覧に切り替わる。
- 旧モーダル左ペインにあった範囲作成 / 解除 / 表紙・奥付指定 / ICC指定メニューを `createPortal` で中央ビューへ移植。
- 分割設定値、範囲、各巻タイトル、読み仮名、ファイル名サフィックスは右パネル側の状態として維持。

C2. **通常見開き表示の復帰**:
- EPUBモード専用の余計な見開き幅制御を削除し、従来の `.epub-spread-page img { max-height: 80vh; max-width: 46vw; }` ベースの表示へ戻した。
- ページごとの左右余白や左右ページの分離が発生しないよう、見開き画像まわりの追加上書きを撤去。

### D. カラーモードサマリー配置調整

D1. **`color-mode-summary-container.expanded` の位置調整** ([src/styles.css](src/styles.css)):
- EPUBモードでも見開き表示と同じようにプレビュー枠上端へ貼り付くよう、EPUB専用の margin / sticky top を調整。
- 右パネル埋め込み化後も表示領域外にはみ出さないようにしつつ、上部に余計な余白が出ない配置へ修正。

### 検証

- `npm run build` 成功。
- ブラウザ確認:
  - EPUBモード時に左サイドバーが表示されない。
  - 分割出力チェック時に中央表示が分割サムネイル選択へ切り替わる。
  - EPUBモードの通常見開き表示を従来表示へ戻した。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.5.8`** に更新。

---

## v1.6.0: フォルダ形式プロジェクト保存、台割TIF出力、EPUB/UI改善

### A. プロジェクト保存をフォルダ形式へ変更

OPUS のプロジェクト保存方式を参考に、`.daiw` 単体保存から、プロジェクトフォルダ内へ
プロジェクトファイルとリンクファイルコピーをまとめる方式へ変更した。

A1. **保存先構造** ([src-tauri/src/commands/project.rs](src-tauri/src/commands/project.rs)):
- `作品.daiw` を指定した場合、実際には `作品/作品.daiw` を作成。
- 参照画像は `作品/リンクファイル/` にコピー。
- 保存する `.daiw` 内の `absolute_path` / `relative_path` / `file_name` / `file_size` / `modified_time` は
  コピー後のファイル情報へ更新。
- 同一ソースファイルは重複コピーせず、同名ファイルは連番で衝突回避。
- 書き込みは一時ファイル経由のアトミック保存を維持。

A2. **読み込み時のポータブル化**:
- `.daiw` を開いたフォルダを `base_path` として再設定。
- `relative_path` が存在する場合は、古い絶対パスよりプロジェクトフォルダ内のコピーを優先。
- プロジェクトフォルダごと移動・共有してもリンクファイルを復元しやすくした。

A3. **フロントエンド保存結果** ([src/App.tsx](src/App.tsx)):
- `save_project` の戻り値を `ProjectSaveResult` に変更し、実際の `.daiw` パスとプロジェクトフォルダを受け取る。
- 最近使ったファイルと現在のプロジェクトパスは、生成された `作品/作品.daiw` を指すよう更新。
- 保存完了ダイアログにプロジェクトフォルダとコピー件数を表示。

### B. 台割TIF出力とリネーム保存条件

B1. **台割TIFの既定出力先** ([src/components/modals/ExportModal.tsx](src/components/modals/ExportModal.tsx), [src/hooks/useExport.ts](src/hooks/useExport.ts)):
- エクスポートの既定出力先を `Desktop/Script_Output/台割TIF` に変更。
- チャプターごと設定 + TIFのみのコピー時は、チャプター名を付けた連番ファイル名へリネームし、
  サブフォルダを作らず `台割TIF` に集約。
- TIFF変換経路では PSD/JPEG を Photoshop で `.tif` に変換し、変換対象外ページも同じ出力先に `.tif` として生成。

B2. **「リネームして保存」必須化**:
- 「TIFFに変換」の下に「リネームして保存」チェックボックスを常時表示。
- チェックが入っていない場合は生成ボタンを無効化。
- UIは既存の `JPEGに変換` / `TIFFに変換` と同じチェックボックスレイアウト・間隔に統一。
- `useExport` 側にも防御処理を追加し、未チェック状態で TIFF 出力が呼ばれてもエラーにする。

### C. EPUB生成画面と情報表示の調整

C1. **EPUB生成サイドバー幅調整** ([src/styles.css](src/styles.css)):
- EPUB生成モードの右サイドバーを少し狭くし、プレビュー領域を広く使えるようにした。

C2. **格納サイズバッジ追加** ([src/App.tsx](src/App.tsx), [src/styles.css](src/styles.css)):
- `1280x1818px` の画像サイズを「格納サイズ」と判定。
- `color-mode-summary-container expanded` 内に緑基調のバッジとして表示。
- 通常の例外サイズと区別し、ホバー時の対象ハイライトにも対応。

### D. 終了確認・未保存確認の改善

D1. **終了確認ダイアログの表示調整** ([src/styles.css](src/styles.css)):
- 「保存して終了」が改行されないよう、未保存確認ダイアログの横幅とボタン幅を拡大。

D2. **未保存確認条件の調整** ([src/App.tsx](src/App.tsx)):
- チャプターをすべて削除して空になった状態で「開く」を押した場合は、不要な未保存確認を出さない。
- 一方で、未保存プロジェクトにチャプターが残っている状態でアプリを終了しようとした場合は、
  警告ダイアログを必ず表示する。

### 検証

- `npm run build` 成功。
- `cargo check` 成功。

### バージョン同期

`package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.6.0`** に更新。
