$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path "$ScriptDir\..").Path
$AppDir = (Resolve-Path "$DesktopDir\..\app").Path
$RootDir = (Resolve-Path "$DesktopDir\..\..").Path
$env:PATH = "$RootDir\node_modules\.bin;$env:PATH"

# Build the Electron main process
npm run build:main

# Take the lowest free port in the desktop band so dev browser storage keeps the
# same localhost origin across restarts. Fall back only when earlier ports are busy.
#
# The band starts at 8082, NOT 8081: `8081` belongs to the root-checkout Expo
# (`dev:app`, and the `otto-dev` preview config), and desktop dev must never claim
# it — otherwise the two collide whenever both are up, which is the whole reason
# the lanes own fixed ports. Kept identical to scripts/dev.sh; the two drifted
# apart once and Windows silently stole 8081 for a while.
$PreviousNoColor = $env:NO_COLOR
$PreviousForceColor = $env:FORCE_COLOR
try {
    $env:NO_COLOR = "1"
    $env:FORCE_COLOR = "0"
    $env:EXPO_PORT = (npx get-port-cli 8082 8083 8084 8085 8086 8087 8088 8089).Trim()
} finally {
    if ($null -eq $PreviousNoColor) {
        Remove-Item Env:\NO_COLOR -ErrorAction SilentlyContinue
    } else {
        $env:NO_COLOR = $PreviousNoColor
    }
    if ($null -eq $PreviousForceColor) {
        Remove-Item Env:\FORCE_COLOR -ErrorAction SilentlyContinue
    } else {
        $env:FORCE_COLOR = $PreviousForceColor
    }
}

# Set EXPO_DEV_URL in the environment so Electron inherits it
$env:EXPO_DEV_URL = "http://localhost:$($env:EXPO_PORT)"

$RemoteDebuggingPort = if ($env:OTTO_ELECTRON_REMOTE_DEBUGGING_PORT) {
    $env:OTTO_ELECTRON_REMOTE_DEBUGGING_PORT
} else {
    "9223"
}
$ExistingElectronFlags = if ($env:OTTO_ELECTRON_FLAGS) {
    "$($env:OTTO_ELECTRON_FLAGS) "
} else {
    ""
}
$env:OTTO_ELECTRON_FLAGS = "$($ExistingElectronFlags)--remote-debugging-port=$RemoteDebuggingPort"

# Fully isolate the dev instance from a production Otto install so `npm run dev`
# works while the installed app is open. Without this the dev build loses the
# Electron single-instance lock to the installed app and quits, and ends up
# pointed at the production daemon, whose CORS allowlist rejects the Metro origin.
. "$RootDir\scripts\dev-home.ps1"
$Dev = Initialize-OttoDevEnvironment

# A userData dir of its own is what breaks the single-instance lock tie with the
# installed app. Sibling of the dev OTTO_HOME, matching scripts/dev.sh.
if (-not $env:OTTO_ELECTRON_USER_DATA_DIR) {
    $env:OTTO_ELECTRON_USER_DATA_DIR = Join-Path (Get-OttoDevStateDir) "user-data"
}
New-Item -ItemType Directory -Force -Path $env:OTTO_ELECTRON_USER_DATA_DIR | Out-Null

if (-not $Dev.ManagedHome) {
    Write-Host "  (custom OTTO_HOME - leaving its config.json untouched)"
}

Write-Host @"
======================================================
  Otto Desktop Dev (Windows)
======================================================
  Metro:      http://localhost:$($env:EXPO_PORT)
  CDP:        http://127.0.0.1:$RemoteDebuggingPort
  Daemon:     $($Dev.Listen) (isolated)
  OTTO_HOME:  $($Dev.Home)
  userData:   $($env:OTTO_ELECTRON_USER_DATA_DIR)
======================================================
"@

# Bump Metro's Node heap to 8 GB. Long edit-while-live sessions grow Metro's
# in-memory module graph + transform cache until it walks into V8's ~4 GB default
# old-space ceiling and dies with "Ineffective mark-compacts near heap limit"
# (exit 134). Scoped to the Expo/Metro process only — Electron keeps its default.
$MetroNodeOptions = if ($env:NODE_OPTIONS) { "$($env:NODE_OPTIONS) --max-old-space-size=8192" } else { "--max-old-space-size=8192" }

# Launch Metro + Electron together, kill both on exit
concurrently `
    --kill-others `
    --names "metro,electron" `
    --prefix-colors "magenta,cyan" `
    "cd `"$AppDir`" && cross-env OTTO_WEB_PLATFORM=electron NODE_OPTIONS=`"$MetroNodeOptions`" npx expo start --port $($env:EXPO_PORT)" `
    "npx wait-on tcp:$($env:EXPO_PORT) && npx electron `"$DesktopDir`""
