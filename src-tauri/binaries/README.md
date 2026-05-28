# PDFium DLL

このディレクトリには `pdfium.dll` を配置します（PDF読み込み機能で使用）。
**通常はユーザーが手動配置する必要はありません** — アプリが初回PDF取り込み時に
G:\共有ドライブ から自動でローカル `%LOCALAPPDATA%\daidori-manager\binaries\pdfium.dll`
にコピーします。

## 自動取得元（優先順）

アプリは初回PDF取り込み時、以下の場所に DLL があれば順に検索・コピーします:

1. `G:\共有ドライブ\ソニーからのデータ受領\編集企画_AT業務推進\DTP制作部\Daiwari PDF\bin\pdfium.dll` ← **現運用先**（bblanchon アーカイブ展開時）
2. `G:\共有ドライブ\ソニーからのデータ受領\編集企画_AT業務推進\DTP制作部\Daiwari PDF\pdfium.dll`
3. `G:\共有ドライブ\編集企画_AT業務推進\DTP制作部\pdfium.dll`
4. `G:\共有ドライブ\編集企画_AT業務推進\DTP制作部\Daiwari Manager\pdfium.dll`
5. `G:\共有ドライブ\編集企画_AT業務推進\DTP制作部\daidori-manager\pdfium.dll`

候補パスは [src-tauri/src/commands/pdf.rs](../src/commands/pdf.rs) の
`shared_pdfium_candidates` に記載。現在の運用では `Daiwari PDF\` フォルダに
bblanchon の pdfium アーカイブ全体（`bin/`, `include/`, `lib/`, `licenses/` 等）が
展開済みのため、`bin/pdfium.dll` を最優先で参照します。

## ローカルキャッシュ

取得した DLL は `%LOCALAPPDATA%\daidori-manager\binaries\pdfium.dll` に保存され、
以後はそのキャッシュから読み込まれます（G: 接続なしでも動作）。

## 手動配置（オフライン・開発用）

G: ドライブが使えない環境では、以下のいずれかに DLL を配置することでも動作します:

1. https://github.com/bblanchon/pdfium-binaries/releases から
   `pdfium-win-x64.tgz` をダウンロード
2. アーカイブを展開し、`bin/pdfium.dll` を以下のいずれかにコピー:
   - **このディレクトリ** (`src-tauri/binaries/pdfium.dll`) — 開発時・本番バンドル両用
   - `%LOCALAPPDATA%\daidori-manager\binaries\pdfium.dll` — 本番のローカルキャッシュ
   - インストール先 exe と同じフォルダ — 本番のポータブル配置

## 前提条件

`pdfium.dll` は **Visual C++ ランタイム** (vcredist) を必要とします。
未インストールの環境ではロードに失敗します。

## プレースホルダ

リポジトリには 154B のテキストプレースホルダ `pdfium.dll` がコミットされています。
これは Tauri バンドラのリソース存在チェックを通過させるためのもので、
実行時は「1MB 未満」として除外されるため悪影響はありません。
本物の DLL（約 10MB）に置き換えると、リソースとしてインストーラに同梱されます。
