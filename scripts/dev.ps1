$ErrorActionPreference = "Stop"

# Ensure node_modules/.bin is in PATH
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$ScriptDir\..\node_modules\.bin;$env:PATH"

# Isolated dev environment: dev port, dev OTTO_HOME, dev-only CORS/relay
# defaults. Keeps this daemon off 6868 and out of `~/.otto`, so the installed
# Otto can stay open and serving while you work on the checkout.
. "$ScriptDir\dev-home.ps1"
$Dev = Initialize-OttoDevEnvironment

Write-Host @"
======================================================
  Otto Dev (Windows)
======================================================
  Home:    $($Dev.Home)
  Models:  $($env:OTTO_LOCAL_MODELS_DIR)
  Daemon:  $($Dev.Listen) (isolated)
======================================================
"@

# Configure the app to auto-connect to this daemon on localhost
$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = $Dev.Endpoint
$env:BROWSER = "none"

# Bump Metro's Node heap to 8 GB. Long edit-while-live sessions grow Metro's
# in-memory module graph + transform cache until it walks into V8's ~4 GB default
# old-space ceiling and dies with "Ineffective mark-compacts near heap limit"
# (exit 134). Scoped to the Expo/Metro process only — the daemon keeps its default.
$MetroNodeOptions = if ($env:NODE_OPTIONS) { "$($env:NODE_OPTIONS) --max-old-space-size=8192" } else { "--max-old-space-size=8192" }

# Run both with concurrently
concurrently `
    --names "daemon,metro" `
    --prefix-colors "cyan,magenta" `
    "npm run dev:server:watch" `
    "cd packages/app && cross-env NODE_OPTIONS=`"$MetroNodeOptions`" npx expo start"
