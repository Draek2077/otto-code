<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Otto logo">
</p>

<h1 align="center">Otto</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/otto-code-ai/otto-code/stargazers">
    <img src="https://img.shields.io/github/stars/otto-code-ai/otto-code?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/otto-code-ai/otto-code/releases">
    <img src="https://img.shields.io/github/v/release/otto-code-ai/otto-code?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://x.com/moboudra">
    <img src="https://img.shields.io/badge/%40moboudra-555?logo=x" alt="X">
  </a>
  <a href="https://discord.gg/jz8T2uahpH">
    <img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord">
  </a>
  <a href="https://www.reddit.com/r/OttoAI/">
    <img src="https://img.shields.io/badge/Reddit-555?logo=reddit" alt="Reddit">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode、Pi のエージェントを、ひとつのインターフェースで。</p>

<p align="center">
  <img src="https://otto-code.ai/hero-mockup.png" alt="Otto アプリのスクリーンショット" width="100%">
</p>

<p align="center">
  <img src="https://otto-code.ai/mobile-mockup.png" alt="Otto モバイルアプリ" width="100%">
</p>

> [!NOTE]
> 私はひとりでメンテナンスしているため、GitHub Issues を毎日確認できるとは限りません。
> 急ぎの問題や作業がブロックされている場合は、[Discord](https://discord.gg/jz8T2uahpH) から連絡するのが一番早いです。

---

自分のマシンでエージェントを並列実行。スマートフォンからでもデスクからでも、開発を進めてリリースできます。

- **セルフホスト:** エージェントはあなたのマシン上で動作し、完全な開発環境を使用します。自分のツール・設定・スキルをそのまま活用できます。
- **マルチプロバイダー:** Claude Code、Codex、Copilot、OpenCode、Pi を同一のインターフェースで利用。タスクに合ったモデルを選べます。
- **音声コントロール:** 音声モードでタスクを口述したり問題を話し合ったりできます。ハンズフリーが必要なときに便利です。
- **クロスデバイス:** iOS、Android、デスクトップ、Web、CLI に対応。机で作業を始め、スマートフォンで確認し、ターミナルから自動化できます。
- **プライバシー優先:** Otto にはテレメトリー・トラッキング・強制ログインは一切ありません。

## はじめかた

Otto はコーディングエージェントを管理するローカルサーバー（デーモン）を起動します。デスクトップアプリ・モバイルアプリ・Web アプリ・CLI などのクライアントがこのデーモンに接続します。

### 前提条件

エージェント CLI をひとつ以上インストールし、認証情報を設定しておく必要があります。

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### デスクトップアプリ（推奨）

[otto-code.ai/download](https://otto-code.ai/download) または [GitHub のリリースページ](https://github.com/otto-code-ai/otto-code/releases)からダウンロードしてください。アプリを開くとデーモンが自動的に起動します。追加のインストールは不要です。

スマートフォンから接続するには、Settings 画面に表示される QR コードをスキャンしてください。

### CLI / ヘッドレス

CLI をインストールして Otto を起動します。

```bash
npm install -g @otto-code/cli
otto
```

ターミナルに QR コードが表示されます。どのクライアントからでも接続できます。サーバーやリモートマシンでの利用に適しています。

詳しいセットアップと設定については以下を参照してください。

- [ドキュメント](https://otto-code.ai/docs)
- [設定リファレンス](https://otto-code.ai/docs/configuration)

## CLI

アプリでできることはすべてターミナルからも実行できます。

```bash
otto run --provider claude/opus-4.6 "implement user authentication"
otto run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

otto ls                           # 実行中のエージェントを一覧表示
otto attach abc123                # ライブ出力をストリーミング
otto send abc123 "also add tests" # 追加タスクを送信

# リモートデーモンで実行
otto --host workstation.local:6868 run "run the full test suite"
```

詳細は[完全な CLI リファレンス](https://otto-code.ai/docs/cli)を参照してください。

## スキル

スキルはエージェントに Otto を使って他のエージェントをオーケストレーションする方法を教えます。

```bash
npx skills add otto-code-ai/otto-code
```

どのエージェントとの会話でも使用できます。

- `/otto-handoff` — エージェント間で作業を引き継ぎます。私はこれを使って Claude で計画し、Codex に実装を引き継いでいます。
- `/otto-loop` — 明確な受け入れ基準に沿ってエージェントをループさせます（Ralph loops とも呼ばれます）。検証役を追加することもできます。
- `/otto-advisor` — 単一のエージェントをアドバイザーとして起動し、作業を委任せずにセカンドオピニオンを得ます。
- `/otto-committee` — 対照的な2つのエージェントで委員会を構成し、一歩引いた視点で根本原因を分析して計画を作成します。

## 開発

モノレポのパッケージ構成：

- `packages/server`: Otto デーモン（エージェントプロセスのオーケストレーション、WebSocket API、MCP サーバー）
- `packages/app`: Expo クライアント（iOS、Android、Web）
- `packages/cli`: デーモンおよびエージェントワークフロー向け `otto` CLI
- `packages/desktop`: Electron デスクトップアプリ
- `packages/relay`: リモート接続用リレーパッケージ
- `packages/website`: マーケティングサイトとドキュメント（`otto-code.ai`）

よく使うコマンド：

```bash
# すべてのローカル開発サービスを起動
npm run dev

# 個別のサービスを起動
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# サーバースタックをビルド
npm run build:server

# リポジトリ全体のチェック
npm run typecheck
```

## コミュニティ

- [otto-relay](https://github.com/zenghongtu/otto-relay) — Go 実装のセルフホスト型リレー
- [otto-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.otto-vscode) — VS Code 拡張機能

---

<p align="center">
  <a href="https://star-history.com/#otto-code-ai/otto-code&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=otto-code-ai/otto-code&type=Date&theme=dark">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=otto-code-ai/otto-code&type=Date">
      <img src="https://api.star-history.com/svg?repos=otto-code-ai/otto-code&type=Date" alt="otto-code-ai/otto-code のスター履歴チャート" width="600" style="max-width: 100%;">
    </picture>
  </a>
</p>

## ライセンス

AGPL-3.0
