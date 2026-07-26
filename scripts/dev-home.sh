#!/bin/bash

default_dev_otto_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

# The dev daemon port. Deliberately NOT 6868: that belongs to the installed
# desktop app's daemon over `~/.otto`, and a dev daemon that lands on it either
# crash-loops fighting for the port or — worse — silently hands dev clients and
# `npm run cli` the production agent state. Keep the two on separate ports so
# both can run at once. Override with OTTO_DEV_DAEMON_PORT.
dev_daemon_port() {
  echo "${OTTO_DEV_DAEMON_PORT:-6788}"
}

# The one dev home, shared by every dev entrypoint (root daemon, Expo, desktop
# Electron, `npm run cli`). It sits under packages/desktop because that is where
# the desktop dev script has always put it, and that is where the accumulated
# dev state lives. Everything else was pointed here rather than the reverse so
# no one has to move a populated home — and its git worktrees — to get one.
# Derived from the checkout root, so an Otto worktree still gets its own.
# OTTO_DEV_HOME names a *managed* home other than the default one — the escape
# hatch for standing up an additional isolated lane (see the agent lane in
# docs/development.md). It differs from raw OTTO_HOME, which is honored but never
# written to: a managed home gets its config.json seeded with the lane's port, so
# the lane actually answers on its own port instead of inheriting 6868.
default_dev_otto_home() {
  if [ -n "${OTTO_DEV_HOME:-}" ]; then
    echo "$OTTO_DEV_HOME"
    return
  fi

  local dev_root
  dev_root="${OTTO_DEV_ROOT:-$(default_dev_otto_root)}"
  echo "$dev_root/packages/desktop/.dev/otto-home"
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
  node "$(dirname "${BASH_SOURCE[0]}")/seed-dev-daemon-config.mjs" \
    "$OTTO_HOME/config.json" "$OTTO_LISTEN"
}

resolve_dev_daemon_endpoint() {
  if [ -n "${OTTO_DEV_DAEMON_ENDPOINT:-}" ]; then
    echo "$OTTO_DEV_DAEMON_ENDPOINT"
    return
  fi

  # Bind the default before matching. Expanding OTTO_LISTEN directly in the
  # branch bodies emits a bare "localhost:" whenever it is unset — the case
  # matches the default, then the body strips a prefix off an empty string.
  local listen="${OTTO_LISTEN:-127.0.0.1:$(dev_daemon_port)}"
  case "$listen" in
    0.0.0.0:*) echo "localhost:${listen#0.0.0.0:}" ;;
    127.0.0.1:*) echo "localhost:${listen#127.0.0.1:}" ;;
    *) echo "$listen" ;;
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
  OTTO_HOME="$(default_dev_otto_home)"
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
      export OTTO_LISTEN="127.0.0.1:$(dev_daemon_port)"
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
