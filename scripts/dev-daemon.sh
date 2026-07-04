#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export OTTO_LISTEN="${OTTO_LISTEN:-127.0.0.1:6768}"
configure_dev_otto_home

if [ -z "${OTTO_LOCAL_MODELS_DIR}" ]; then
  export OTTO_LOCAL_MODELS_DIR="$HOME/.otto/models/local-speech"
  mkdir -p "$OTTO_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Otto Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${OTTO_HOME}"
echo "  Models:  ${OTTO_LOCAL_MODELS_DIR}"
echo "  Listen:  ${OTTO_LISTEN}"
echo "══════════════════════════════════════════════════════"

export OTTO_CORS_ORIGINS="${OTTO_CORS_ORIGINS:-*}"
export OTTO_NODE_INSPECT="${OTTO_NODE_INSPECT:---inspect=0}"

if [ "${OTTO_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
