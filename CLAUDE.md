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
├── src/                    # Reactフロントエンド
│   ├── App.tsx            # メインコンポーネント
│   ├── store.ts           # Zustand状態管理
│   ├── types.ts           # 型定義
│   ├── icons.tsx          # アイコンコンポーネント
│   ├── styles.css         # グローバルスタイル
│   └── main.tsx           # エントリーポイント
├── src-tauri/             # Tauriバックエンド
│   ├── src/
│   │   ├── lib.rs         # Rustコマンド実装
│   │   └── main.rs        # エントリーポイント
│   ├── Cargo.toml         # Rust依存関係
│   └── tauri.conf.json    # Tauri設定
├── package.json           # npm依存関係
└── vite.config.ts         # Vite設定
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
