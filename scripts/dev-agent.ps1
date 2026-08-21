$ErrorActionPreference = "Stop"

# The AGENT lane: a daemon + web front end an AI agent can start, drive and
# screenshot on its own, without disturbing anything the human has running.
#
# It is a fourth fixed lane alongside the installed app (6868) and dev (6788) -
# see docs/development.md → "Four lanes". Everything it owns is its own: port,
# OTTO_HOME, Metro port. Start it while Otto Release and Otto Dev are both up and
# nothing collides; that is the entire point of this script existing.
#
# Front end is Expo *web*, not Electron, so it can be opened in Otto's browser
# pane and verified with the browser tools. Electron would need a separate
# userData for the single-instance lock and could only be inspected over CDP.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
$env:PATH = "$RepoRoot\node_modules\.bin;$env:PATH"

. "$ScriptDir\dev-home.ps1"

# A managed home of its own (seeded with the lane's port), kept next to the dev
# one under the already-gitignored packages/desktop/.dev/. Persistent on purpose:
# a throwaway home mints a new daemon keypair/serverId every run, and a client
# that remembered the old identity refuses the new one.
if (-not $env:OTTO_DEV_HOME) {
    $env:OTTO_DEV_HOME = Join-Path $RepoRoot "packages\desktop\.dev\agent-home"
}
if (-not $env:OTTO_DEV_DAEMON_PORT) { $env:OTTO_DEV_DAEMON_PORT = "6799" }

$Dev = Initialize-OttoDevEnvironment

$MetroPort = if ($env:OTTO_AGENT_METRO_PORT) { $env:OTTO_AGENT_METRO_PORT } else { "8095" }
$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = $Dev.Endpoint
$env:BROWSER = "none"

Write-Host @"
======================================================
  Otto Agent Lane (Windows)
======================================================
  Home:    $($Dev.Home)
  Daemon:  $($Dev.Listen)
  Web:     http://localhost:$MetroPort
======================================================
  Safe to run alongside Otto Release (6868) and Otto Dev (6788).
======================================================
"@

# Metro reads the workspace packages from their compiled dist, and snapshots
# its file map at startup - a stale dist there is an unresolvable import for the
# whole session. No-op when everything is already built.
node "$ScriptDir\ensure-app-deps.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Metro's heap, same reasoning as scripts/dev.ps1.
$MetroNodeOptions = if ($env:NODE_OPTIONS) { "$($env:NODE_OPTIONS) --max-old-space-size=8192" } else { "--max-old-space-size=8192" }

concurrently `
    --names "daemon,web" `
    --prefix-colors "cyan,magenta" `
    "npm run dev:server:watch" `
    "cd packages/app && cross-env NODE_OPTIONS=`"$MetroNodeOptions`" npx expo start --web --port $MetroPort"
