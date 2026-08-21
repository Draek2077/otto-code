#!/bin/bash
set -e

# The AGENT lane: a daemon + web front end an AI agent can start, drive and
# screenshot on its own, without disturbing anything the human has running.
# POSIX mirror of scripts/dev-agent.ps1 - keep the two in sync.
#
# It is a fourth fixed lane alongside the installed app (6868) and dev (6788) -
# see docs/development.md → "Four lanes". Everything it owns is its own: port,
# OTTO_HOME, Metro port. Start it while Otto Release and Otto Dev are both up and
# nothing collides; that is the entire point of this script existing.
#
# Front end is Expo *web*, not Electron, so it can be opened in Otto's browser
# pane and verified with the browser tools.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$ROOT_DIR/node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

# A managed home of its own (seeded with the lane's port), kept next to the dev
# one under the already-gitignored packages/desktop/.dev/. Persistent on purpose:
# a throwaway home mints a new daemon keypair/serverId every run, and a client
# that remembered the old identity refuses the new one.
export OTTO_DEV_HOME="${OTTO_DEV_HOME:-$ROOT_DIR/packages/desktop/.dev/agent-home}"
export OTTO_DEV_DAEMON_PORT="${OTTO_DEV_DAEMON_PORT:-6799}"
export OTTO_LISTEN="${OTTO_LISTEN:-127.0.0.1:$(dev_daemon_port)}"
configure_dev_otto_home

METRO_PORT="${OTTO_AGENT_METRO_PORT:-8095}"
DAEMON_ENDPOINT="$(resolve_dev_daemon_endpoint)"

echo "══════════════════════════════════════════════════════"
echo "  Otto Agent Lane"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${OTTO_HOME}"
echo "  Daemon:  ${OTTO_LISTEN}"
echo "  Web:     http://localhost:${METRO_PORT}"
echo "══════════════════════════════════════════════════════"
echo "  Safe alongside Otto Release (6868) and Otto Dev (6788)."
echo "══════════════════════════════════════════════════════"

export OTTO_RELAY_ENABLED="${OTTO_RELAY_ENABLED:-false}"
export OTTO_CORS_ORIGINS="${OTTO_CORS_ORIGINS:-*}"

# Metro reads the workspace packages from their compiled dist, and snapshots
# its file map at startup - a stale dist there is an unresolvable import for the
# whole session. No-op when everything is already built.
node "$SCRIPT_DIR/ensure-app-deps.mjs"

exec concurrently \
  --names "daemon,web" \
  --prefix-colors "cyan,magenta" \
  "npm run dev:server:watch" \
  "cd packages/app && cross-env APP_VARIANT=development BROWSER=none EXPO_PUBLIC_LOCAL_DAEMON=$DAEMON_ENDPOINT NODE_OPTIONS=\"${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192\" npx expo start --web --port $METRO_PORT"
