<!-- OTTO(identity): Otto distribution names; internal Paseo API identifiers stay upstream. -->
<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Otto logo">
</p>

<h1 align="center">Otto</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/Draek2077/otto-code/stargazers">
    <img src="https://img.shields.io/github/stars/Draek2077/otto-code?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/Draek2077/otto-code/releases">
    <img src="https://img.shields.io/github/v/release/Draek2077/otto-code?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode 和 Pi agents 的统一界面。</p>

## 快速开始

Otto 会运行一个名为 daemon 的本地服务，用来管理你的 coding agents。桌面 app、移动 app、Web app 和 CLI 等客户端都会连接到它。

### 前置条件

你至少需要安装一个 agent CLI，并用你的凭据完成配置：

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### 桌面 app（推荐）

从 [otto-code.me/download](https://otto-code.me/download) 或 [GitHub releases 页面](https://github.com/Draek2077/otto-code/releases)下载。打开 app 后 daemon 会自动启动，不需要再安装其他东西。

如果要从手机连接，在 Settings 中扫描显示的二维码。

### CLI / 无头模式

安装 CLI 并启动 Otto：

```bash
npm install -g @otto-code/cli
otto
```

终端中会显示一个二维码。你可以从任意客户端连接。这个方式适合服务器和远程机器。

完整安装和配置见：

- [文档](https://otto-code.me/docs)
- [配置参考](https://otto-code.me/docs/configuration)

## CLI

你能在 app 中完成的事情，也都可以在终端中完成。

```bash
otto run --provider claude/opus-4.6 "implement user authentication"
otto run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

otto ls                           # 列出正在运行的 agents
otto attach abc123                # 实时流式查看输出
otto send abc123 "also add tests" # 发送后续任务

# 在远程 daemon 上运行
otto --host workstation.local:6868 run "run the full test suite"
```

更多内容见[完整 CLI 参考](https://otto-code.me/docs/cli)。

## Skills

Skills 会教你的 agent 使用 Otto 来编排其他 agents。

```bash
npx skills add getpaseo/paseo
```

然后在任意 agent 对话中使用：

- `/paseo-handoff` — 在 agents 之间交接工作。我会用它先和 Claude 规划，再交给 Codex 实现。
- `/paseo-advisor` — 启动单个 agent 作为 advisor，提供第二意见，但不把工作委托出去。
- `/paseo-committee` — 组建两个风格互补的 agents，让它们后退一步做根因分析并产出计划。

## 开发

Monorepo 包结构速览：

- `packages/server`：Otto daemon（agent 进程编排、WebSocket API、MCP server）
- `packages/app`：Expo 客户端（iOS、Android、Web）
- `packages/cli`：用于 daemon 和 agent 工作流的 `otto` CLI
- `packages/desktop`：Electron 桌面 app
- `packages/relay`：用于远程连接的 relay 包
- `packages/website`：营销站点和文档（`otto-code.me`）

常用命令：

```bash
# 运行所有本地开发服务
npm run dev

# 单独运行某个界面
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# 构建 server stack
npm run build:server

# 全仓库检查
npm run typecheck
```

## 相关项目

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — 官方分布式 relay，使用 Elixir 编写
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code 扩展

### 自托管 relay TLS

自托管 relay 默认使用 `ws://`，除非显式启用 TLS。对于 nginx 后面、监听 443 的 relay，可以这样启动 daemon：

```bash
PASEO_RELAY_ENDPOINT=127.0.0.1:8080 \
PASEO_RELAY_PUBLIC_ENDPOINT=relay.example.com:443 \
PASEO_RELAY_USE_TLS=true \
otto daemon start
```

等价配置：

```json
{
  "daemon": {
    "relay": {
      "enabled": true,
      "endpoint": "127.0.0.1:8080",
      "publicEndpoint": "relay.example.com:443",
      "useTls": true
    }
  }
}
```

最小 nginx WebSocket 代理配置：

```nginx
server {
  listen 443 ssl;
  server_name relay.example.com;

  ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

  location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

## License and upstream

Otto is distributed under [AGPL-3.0-or-later](LICENSE). It is built on
[Paseo](https://github.com/getpaseo/paseo); the upstream license is retained in
[LICENSE-Paseo](LICENSE-Paseo), with attribution in [NOTICE](NOTICE).
