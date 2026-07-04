# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS source-pack

ARG OTTO_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /tmp/otto-src
COPY . .

RUN set -eux; \
    if [ -n "${OTTO_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${OTTO_VERSION}"; \
    fi; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

RUN set -eux; \
    mkdir -p /tmp/otto-packs; \
    npm pack --workspace=@otto-code/highlight --pack-destination /tmp/otto-packs; \
    npm pack --workspace=@otto-code/relay --pack-destination /tmp/otto-packs; \
    npm pack --workspace=@otto-code/protocol --pack-destination /tmp/otto-packs; \
    npm pack --workspace=@otto-code/client --pack-destination /tmp/otto-packs; \
    npm pack --workspace=@otto-code/server --pack-destination /tmp/otto-packs; \
    npm pack --workspace=@otto-code/cli --pack-destination /tmp/otto-packs

FROM ${NODE_IMAGE}

ENV HOME=/home/otto \
    OTTO_HOME=/home/otto/.otto \
    OTTO_LISTEN=0.0.0.0:6868 \
    OTTO_WEB_UI_ENABLED=true \
    OTTO_LOG_FORMAT=json \
    OTTO_LOG_LEVEL=info \
    CLAUDE_CONFIG_DIR=/home/otto/.claude \
    CODEX_HOME=/home/otto/.codex \
    XDG_CONFIG_HOME=/home/otto/.config \
    XDG_DATA_HOME=/home/otto/.local/share \
    XDG_STATE_HOME=/home/otto/.local/state \
    XDG_CACHE_HOME=/home/otto/.cache \
    ONNXRUNTIME_NODE_INSTALL=skip

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      lbzip2 \
      openssh-client \
      procps \
      tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=source-pack /tmp/otto-packs /tmp/otto-packs
RUN set -eux; \
	npm install -g /tmp/otto-packs/*.tgz; \
    rm -rf /tmp/otto-packs; \
    npm cache clean --force; \
    server_entry="$(npm root -g)/@otto-code/server/dist/scripts/supervisor-entrypoint.js"; \
    test -f "$server_entry"; \
    printf '%s\n' "$server_entry" > /etc/otto-server-entry; \
    node --check "$server_entry"

RUN set -eux; \
    existing_group="$(getent group 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_group" ] && [ "$existing_group" != "otto" ]; then \
      groupmod --new-name otto "$existing_group"; \
    elif [ -z "$existing_group" ]; then \
      groupadd --gid 1000 otto; \
    fi; \
    existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_user" ] && [ "$existing_user" != "otto" ]; then \
      usermod --login otto --gid otto --home /home/otto --shell /bin/bash "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
      useradd --uid 1000 --gid otto --create-home --home-dir /home/otto --shell /bin/bash otto; \
    fi; \
    mkdir -p \
      /workspace \
      "$OTTO_HOME" \
      "$CLAUDE_CONFIG_DIR" \
      "$CODEX_HOME" \
      "$XDG_CONFIG_HOME" \
      "$XDG_DATA_HOME" \
      "$XDG_STATE_HOME" \
      "$XDG_CACHE_HOME"; \
    chown -R otto:otto /home/otto /workspace

COPY docker/base/rootfs/ /
RUN chmod +x /usr/local/bin/otto-docker-entrypoint

WORKDIR /workspace

EXPOSE 6868
VOLUME ["/home/otto"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const listen=process.env.OTTO_LISTEN||'0.0.0.0:6868'; const m=listen.match(/:(\\d+)$/); const port=m?Number(m[1]):6868; require('http').get({hostname:'127.0.0.1',port,path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/otto-docker-entrypoint"]
