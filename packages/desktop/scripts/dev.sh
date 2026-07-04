#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$DESKTOP_DIR/../.." && pwd)"

source "$ROOT_DIR/scripts/dev-home.sh"

export PATH="$ROOT_DIR/node_modules/.bin:$PATH"
export OTTO_LISTEN="${OTTO_LISTEN:-127.0.0.1:6768}"
configure_dev_otto_home

DEV_ROOT="${OTTO_DEV_ROOT:-$(default_dev_otto_root)}"
export OTTO_ELECTRON_USER_DATA_DIR="${OTTO_ELECTRON_USER_DATA_DIR:-$DEV_ROOT/.dev/user-data}"
mkdir -p "$OTTO_ELECTRON_USER_DATA_DIR"

if [ -z "${EXPO_PORT:-}" ]; then
  EXPO_PORT=$(NO_COLOR=1 FORCE_COLOR=0 "$ROOT_DIR/node_modules/.bin/get-port" 8082 8083 8084 8085 8086 8087 8088 8089)
fi
export EXPO_PORT
export EXPO_DEV_URL="http://localhost:${EXPO_PORT}"

DAEMON_ENDPOINT="$(resolve_dev_daemon_endpoint)"
export OTTO_DAEMON_ENDPOINT="$DAEMON_ENDPOINT"

REMOTE_DEBUGGING_PORT="${OTTO_ELECTRON_REMOTE_DEBUGGING_PORT:-9223}"
export OTTO_ELECTRON_FLAGS="${OTTO_ELECTRON_FLAGS:+$OTTO_ELECTRON_FLAGS }--remote-debugging-port=$REMOTE_DEBUGGING_PORT"
export OTTO_CORS_ORIGINS="${OTTO_CORS_ORIGINS:-*}"

npm run build:main

echo "══════════════════════════════════════════════════════"
echo "  Otto Desktop Dev"
echo "══════════════════════════════════════════════════════"
echo "  Metro:      ${EXPO_DEV_URL}"
echo "  CDP:        http://127.0.0.1:${REMOTE_DEBUGGING_PORT}"
echo "  Daemon:     ${OTTO_LISTEN}"
echo "  Home:       ${OTTO_HOME}"
echo "  userData:   ${OTTO_ELECTRON_USER_DATA_DIR}"
echo "══════════════════════════════════════════════════════"

exec node "$SCRIPT_DIR/dev-runner.mjs"
