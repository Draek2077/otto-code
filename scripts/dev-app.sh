#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$ROOT_DIR/node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export OTTO_LISTEN="${OTTO_LISTEN:-127.0.0.1:6868}"
configure_dev_otto_home

EXPO_PORT="${EXPO_PORT:-8081}"
DAEMON_ENDPOINT="$(resolve_dev_daemon_endpoint)"

echo "══════════════════════════════════════════════════════"
echo "  Otto App Dev"
echo "══════════════════════════════════════════════════════"
echo "  Metro:   http://localhost:${EXPO_PORT}"
echo "  Daemon:  ${DAEMON_ENDPOINT}"
echo "  Home:    ${OTTO_HOME}"
echo "══════════════════════════════════════════════════════"

# Bump Metro's Node heap to 8 GB. Long edit-while-live sessions grow Metro's
# in-memory module graph + transform cache until it walks into V8's ~4 GB default
# old-space ceiling and dies with "Ineffective mark-compacts near heap limit".
exec cross-env \
  BROWSER="${BROWSER:-none}" \
  APP_VARIANT=development \
  EXPO_PUBLIC_LOCAL_DAEMON="$DAEMON_ENDPOINT" \
  NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192" \
  npm run start:expo --workspace=@otto-code/app -- --port "$EXPO_PORT"
