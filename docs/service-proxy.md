# Service Proxy

Otto proxies HTTP traffic to services running inside your workspaces. Localhost service URLs are always enabled; optional public aliases and a separate service-only listener can be layered on through config.

## How it works

When a `otto.json` script of `"type": "service"` starts, Otto assigns it a local port and registers a route in the service proxy. Incoming requests whose `Host` header matches the script's generated hostname are forwarded to that port.

The generated hostname is built from the script name, branch, and project:

```
<script>--<branch>--<project>.localhost
```

If the branch is `main` or `master`, the branch segment is omitted:

```
<script>--<project>.localhost
```

**Example:** a script named `dev` in the `miniweb` project on branch `feature/auth` would be reachable at:

```
dev--feature-auth--miniweb.localhost
```

Local and public routes use one combined leftmost label (`script--branch--project`). This keeps the hostname compatible with normal single-level wildcard DNS and TLS. If the combined label would exceed DNS's 63-character label limit, Otto truncates it with a deterministic hash suffix to avoid collisions.

## Scripts are terminals

Every `otto.json` script — `"type": "service"` or plain — runs as a real terminal that is handed its command on launch. Two invariants follow from that, and both are load-bearing:

**A started script always opens a focused terminal tab.** Background running is not a mode; an invisible script is a useless script. `WorkspaceScriptsButton` requires an `onScriptTerminalStarted` callback (not optional) and every call site — the workspace header, the mobile header, the sidebar tools cluster — opens the tab through it. The catch is that the workspace layout prunes terminal tabs whose id isn't in the terminals query yet (`collapseStaleEntityTabs`), and the daemon's terminals list lags the `start_workspace_script_response` by a refetch. `stores/script-terminal-pending-store.ts` bridges that window: mark the id pending **before** opening the tab. It is a shared store rather than screen-local state because the sidebar starts scripts from outside the screen that owns the terminals query — "invalidate, then open" is a race there, not a fix.

**A script runs in its own workspace's folder.** The daemon spawns the pty with `cwd = workspace.cwd` (the worktree path for a worktree workspace, the checkout otherwise) and reads that workspace's `otto.json`. The subtle half is environment: a terminal inherits the daemon's whole `process.env`, and the daemon is very often started _by another workspace's `daemon` script_, which exports `OTTO_WORKTREE_PATH`. `spawnWorkspaceScript` therefore always stamps the workspace's own location env (`OTTO_WORKTREE_PATH`, `OTTO_SOURCE_CHECKOUT_PATH`, `OTTO_ROOT_PATH`, `OTTO_BRANCH_NAME`, `PWD`) over whatever it inherited, for plain scripts as well as services. Without it a `${OTTO_WORKTREE_PATH:-$PWD}` command quietly operates on the daemon's directory.

One consequence worth knowing: a plain script re-run reuses its previous terminal, so its command lands in whatever directory that shell is sitting in. The location env is fixed at create time and is not re-stamped.

## Configuration

Add a `serviceProxy` block under `daemon` in `~/.otto/config.json`:

```json
{
  "version": 1,
  "daemon": {
    "serviceProxy": {
      "listen": "0.0.0.0:8080",
      "publicBaseUrl": "https://ottoapps.my.domain.com"
    }
  }
}
```

| Field           | Required | Description                                                                                                                                   |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `listen`        | No       | Starts a separate service-only listener at this address. If omitted, services are still reachable on the daemon listener via localhost hosts. |
| `publicBaseUrl` | No       | Adds public service host aliases and public service links. If omitted, links use localhost addresses only.                                    |

`enabled` is accepted for old configs but no longer enables a mode. `enabled: false` suppresses optional `listen`/`publicBaseUrl` layers only; localhost service proxying remains always enabled.

## DNS and reverse proxy setup

For generated URLs to be reachable, you need wildcard DNS pointing to the machine running the Otto daemon.

**Example:** to expose services at `https://dev--miniweb.ottoapps.my.domain.com` where the daemon host is `10.1.1.1`:

1. Configure a wildcard DNS record:

   ```
   *.ottoapps.my.domain.com  →  10.1.1.1
   ```

2. Set `publicBaseUrl` to `https://ottoapps.my.domain.com` in your config.

3. If you put a reverse proxy (nginx, Caddy, Traefik, etc.) in front of Otto, point it at either the daemon listener or the optional service-only listener and ensure it forwards the `Host` header unchanged. The proxy uses the `Host` header to route requests to the correct service — rewriting it will break routing.

Public service URLs expose the workspace service itself. Daemon password authentication protects daemon APIs; it does not protect proxied dev services.

If the same reverse proxy serves the daemon web UI over HTTPS, it must also set `X-Forwarded-Proto` so the web UI can auto-connect with `wss://`. The daemon trusts forwarded headers from loopback proxies by default. If your proxy reaches the daemon from another address, configure the proxy ranges explicitly:

```json
{
  "version": 1,
  "daemon": {
    "trustedProxies": ["loopback", "172.16.0.0/12"]
  }
}
```

`OTTO_TRUSTED_PROXIES` accepts the same comma-separated values, for example `loopback,172.16.0.0/12`. Use `true` only when the final trusted proxy overwrites client-supplied `X-Forwarded-*` headers.

Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name *.ottoapps.my.domain.com;

    location / {
        proxy_pass http://10.1.1.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Environment variables

The listen address and public base URL can also be set via environment variables, which take precedence over `config.json`:

| Variable                             | Description                                                               |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `OTTO_SERVICE_PROXY_ENABLED`         | Compatibility shim; `false` suppresses optional public/listen layers only |
| `OTTO_SERVICE_PROXY_LISTEN`          | Starts the optional service-only listener, e.g. `0.0.0.0:8080`            |
| `OTTO_SERVICE_PROXY_PUBLIC_BASE_URL` | Adds public service aliases and links                                     |

Separately, every script terminal is given its workspace's location env (see [Scripts are terminals](#scripts-are-terminals)):

| Variable                    | Value                                                       |
| --------------------------- | ----------------------------------------------------------- |
| `OTTO_WORKTREE_PATH`        | The workspace's own folder (worktree path, or the checkout) |
| `OTTO_SOURCE_CHECKOUT_PATH` | The git repo root shared across that repo's worktrees       |
| `OTTO_ROOT_PATH`            | Backward-compatible alias of `OTTO_SOURCE_CHECKOUT_PATH`    |
| `OTTO_BRANCH_NAME`          | The workspace's current branch, or empty                    |
