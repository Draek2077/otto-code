#!/bin/bash

default_dev_otto_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

copy_json_tree() {
  local source_dir="$1"
  local target_dir="$2"

  if [ ! -d "$source_dir" ]; then
    return
  fi

  mkdir -p "$target_dir"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --include='*/' --include='*.json' --exclude='*' "$source_dir/" "$target_dir/"
    return
  fi

  while IFS= read -r -d '' source_file; do
    local relative_path="${source_file#"$source_dir"/}"
    local target_file="$target_dir/$relative_path"
    mkdir -p "$(dirname "$target_file")"
    cp "$source_file" "$target_file"
  done < <(find "$source_dir" -type f -name '*.json' -print0)
}

has_files() {
  [ -d "$1" ] && [ -n "$(find "$1" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]
}

seed_worktree_otto_home() {
  local source_home="${OTTO_DEV_SEED_HOME:-$HOME/.otto}"
  local target_home="$1"

  if [ ! -d "$source_home" ]; then
    echo "  Seed:    skipped (${source_home} missing)"
    return
  fi

  if [ "$source_home" = "$target_home" ]; then
    echo "  Seed:    skipped (source is target)"
    return
  fi

  if [ "${OTTO_DEV_RESET_HOME:-0}" = "1" ]; then
    rm -rf "$target_home"
  elif has_files "$target_home"; then
    echo "  Seed:    skipped (${target_home} already has data)"
    return
  fi

  mkdir -p "$target_home"
  echo "  Seed:    copying metadata from ${source_home}"
  copy_json_tree "$source_home/agents" "$target_home/agents"
  copy_json_tree "$source_home/projects" "$target_home/projects"
  if [ -f "$source_home/config.json" ]; then
    cp "$source_home/config.json" "$target_home/config.json"
  fi

  echo "  Seed:    copied metadata from ${source_home}"
}

configure_dev_daemon_config() {
  if [ -z "${OTTO_LISTEN:-}" ]; then
    return
  fi

  mkdir -p "$OTTO_HOME"
  node -e '
const fs = require("fs");
const [path, listen] = [process.argv[1], process.argv[2]];
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
cfg.version = cfg.version || 1;
cfg.daemon = cfg.daemon || {};
cfg.daemon.listen = listen;
cfg.daemon.cors = cfg.daemon.cors || {};
cfg.daemon.cors.allowedOrigins = ["*"];
fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
' "$OTTO_HOME/config.json" "$OTTO_LISTEN"
}

resolve_dev_daemon_endpoint() {
  if [ -n "${OTTO_DEV_DAEMON_ENDPOINT:-}" ]; then
    echo "$OTTO_DEV_DAEMON_ENDPOINT"
    return
  fi

  case "${OTTO_LISTEN:-127.0.0.1:6868}" in
    0.0.0.0:*) echo "localhost:${OTTO_LISTEN#0.0.0.0:}" ;;
    127.0.0.1:*) echo "localhost:${OTTO_LISTEN#127.0.0.1:}" ;;
    *) echo "$OTTO_LISTEN" ;;
  esac
}

configure_dev_otto_home() {
  if [ -n "${OTTO_HOME:-}" ]; then
    export OTTO_HOME
    if [ -n "${OTTO_DEV_SEED_HOME:-}" ]; then
      seed_worktree_otto_home "$OTTO_HOME"
    fi
    mkdir -p "$OTTO_HOME"
    if [ "${OTTO_DEV_MANAGED_HOME:-0}" = "1" ] || [ -n "${OTTO_DEV_SEED_HOME:-}" ]; then
      configure_dev_daemon_config
    fi
    return
  fi

  export OTTO_HOME
  local dev_root
  dev_root="${OTTO_DEV_ROOT:-$(default_dev_otto_root)}"
  OTTO_HOME="$dev_root/.dev/otto-home"
  export OTTO_DEV_MANAGED_HOME=1

  if [ -n "${OTTO_DEV_SEED_HOME:-}" ]; then
    seed_worktree_otto_home "$OTTO_HOME"
  fi

  mkdir -p "$OTTO_HOME"
  configure_dev_daemon_config
}

configure_dev_command_env() {
  if [ -z "${OTTO_LISTEN:-}" ]; then
    if [ -n "${OTTO_SERVICE_DAEMON_PORT:-}" ]; then
      export OTTO_LISTEN="0.0.0.0:${OTTO_SERVICE_DAEMON_PORT}"
    else
      export OTTO_LISTEN="127.0.0.1:6868"
    fi
  fi

  configure_dev_otto_home
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$#" -gt 0 ]; then
    configure_dev_command_env
    exec "$@"
  fi

  configure_dev_otto_home
fi
