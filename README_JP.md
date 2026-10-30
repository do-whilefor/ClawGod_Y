<div align="center">

# ClawGod_Y

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) ゴッドモード。

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.14%2B-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-555)](#使用方法)
[![License](https://img.shields.io/badge/License-GPL_v3-orange)](./LICENSE)

[概要](#概要) · [使用方法](#使用方法) · [利用範囲とセキュリティ](#利用範囲とセキュリティ) · [ライセンスと関連ファイル](#ライセンスと関連ファイル)

[English](README.md) | [中文](README_ZH.md) | [日本語](README_JP.md)

</div>

## 概要

ClawGod_Y は公式 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI に適用されるランタイムパッチで、許可されたペネトレーションテストとセキュリティ監査専用のツールへと変えます。サードパーティ製クライアントでは**ありません**：インストーラは公式バイナリからコードを抽出し、AST レベルのパッチを適用して、Bun ランタイムでパッチ済みビルドを実行します。

パッチの実装は [0Chencc/clawgod](https://github.com/0Chencc/clawgod) を参考にしています。オープンソース化してくれた原プロジェクトに感謝します。本フォークは上流のクロスバージョン対応パッチアーキテクチャを維持し、パッチ済みランタイムを独立してインストールします：

- **`clawgod` がパッチ済みの Claude Code を起動します（v2.1.312 に固定）。** パッチ済みランタイムはすべて `~/.clawgod`（Windows では `%USERPROFILE%\.clawgod`）に格納されます。
- **Claude Code がすでにインストールされている場合、既存の `claude` コマンドは変更されません。** 公式 Claude Code の事前インストールは不要です。既存のオリジナルの `claude update` は通常どおり動作します。
- **バージョンをまたぐ互換性を考慮した設計。** パッチはクロスバージョンのアンカーを使用し、他の Claude Code バージョンにも適合させられますが、すべてのバージョンでの互換性は保証しません。現在のインストーラは v2.1.312 のみをインストールします。必須でないパッチが一致しない場合は警告してスキップしますが、必須のプロンプト注入やソース処理に失敗した場合はインストールを中止します。
- **ペンテスト向けパッチ**：ツールの権限プロンプトと安全分類器をデフォルトでバイパスし、プロンプトを許可されたテストの文脈に書き換え、不要なオフィス／コンシューマー機能を削除します。

## 使用方法

### 必要条件

| 項目 | 要件 |
| --- | --- |
| ホスト | Windows、macOS、または Linux/WSL |
| インストーラ | Node.js 18 以降（npm を含む）。対話型ターミナルで実行 |
| ローカルランタイム | Bun 1.3.14 以降（未検出時は自動インストール）と ripgrep（`rg`） |
| Windows | PowerShell 5.1 以降、`tar` が利用可能であること |
| macOS / Linux / WSL | Bash、`curl`、`tar`。Bun の自動インストールには `unzip` も必要 |

### インストール

**macOS / Linux / WSL：**

```bash
curl -fsSL https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.sh | bash
```

**Windows PowerShell：**

```powershell
irm https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.ps1 | iex
```

インストール後、新しいターミナルを開き、`clawgod` でパッチ済み Claude を起動してください。公式 Claude Code がすでにインストールされていた場合は、引き続き `claude` でオリジナルを起動できます。パッチ済みランタイムは `~/.clawgod`（Windows では `%USERPROFILE%\.clawgod`）に保存されます。

### モデルの設定と開始

`clawgod` の初回起動時に `~/.clawgod/provider.json`（Windows では `%USERPROFILE%\.clawgod\provider.json`）が作成されます。このファイルは Claude 自身の設定とは独立しています。Anthropic 互換 API を使う場合：

```json
{
  "protocol": "anthropic",
  "apiKey": "REPLACE_WITH_YOUR_API_KEY",
  "baseURL": "https://api.anthropic.com",
  "model": "main-model-id",
  "smallModel": "small-model-id",
  "effort": "max",
  "timeoutMs": 3000000
}
```

OpenAI Chat Completions 互換サービスの場合は `protocol` を `openai-chat` に設定し、プロバイダの `baseURL`、API キー、モデル名を入力してください。API 認証情報ではなく Claude サブスクリプションのログインを使う場合は、`provider.json` をデフォルトのままにしてください。`clawgod` は `~/.claude.json` の既存ログインを共有します。保存後、`clawgod` を再起動してください。

### アンインストール

```text
clawgod --uninstall
```

`clawgod` を起動できない場合、**macOS / Linux / WSL** では `bash ~/.clawgod/install.sh --uninstall`、**Windows PowerShell** では `powershell -File "$env:USERPROFILE\.clawgod\install.ps1" -Uninstall` を実行してください。

アンインストールでは `clawgod` ランチャ、主要なランタイムファイル、独立した `~/.clawgod/lean-settings.json` を削除し、`~/.claude/settings.json` は変更しません。`provider.json` や `features.json` などの設定と一部のファイルは保持され、`~/.clawgod` ディレクトリ全体は削除されません。

## 利用範囲とセキュリティ

使用前に[免責事項および利用コンプライアンス通知](./SECURITY.md)をお読みください。

- **合法的な許可**：自分のシステム、明示的に許可されたターゲット、テストが許可された CTF やラボ環境でのみ使用してください。許可された資産・期間・操作の範囲内に留まってください。許可のない侵入、データ窃取、破壊行為は禁止です。
- **人間によるレビュー**：モデルの判断やツールの結果は、生の証拠・実際の影響・カバレッジと照らし合わせて検証してください。パッチ適用済みセッションは権限プロンプトをスキップするため、すべての操作が確認なしで実行されます。
- **情報保護**：ソースコード、ログ、認証情報などを送信する前に、機密保持要件とモデルサービスのデータ処理条項への準拠を確認してください。
- **リソース管理**：モデルサービスで利用上限を設定し、実行時間・ディスク使用量・証拠の保存を自身で管理してください。

ユーザーはテストの許可を取得し、自身の行為とその結果について法的責任を負う必要があります。本プロジェクトのライセンスは、第三者のシステムへのテストを許可するものではありません。

## ライセンスと関連ファイル

このリポジトリは [GNU General Public License v3.0](./LICENSE) の下でライセンスされています。ライセンス条項に従う限り、使用・改変・配布・商用利用が可能です。配布時には、著作権表示・ライセンス・対応するソースコードに関する義務を遵守してください。全文は `LICENSE` を参照してください。

サードパーティのソフトウェア、依存関係、ブランド資産は、それぞれのライセンスと権利表示に従います。このリポジトリのライセンスは、Claude Code、モデルサービス、その他のサードパーティコンポーネントの利用規約に取って代わるものではありません。

| ファイル | 内容 |
| --- | --- |
| [LICENSE](./LICENSE) | GNU GPL v3 の英語全文 |
| [SECURITY.md](./SECURITY.md) | 免責事項、利用コンプライアンス要件、デプロイリスク |
