$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path "$ScriptDir\..").Path
$RootDir = (Resolve-Path "$DesktopDir\..\..").Path
$env:PATH = "$RootDir\node_modules\.bin;$env:PATH"

# Build the Electron main process
npm run build:main

# Take the lowest free port in the desktop band so dev browser storage keeps the
# same localhost origin across restarts. Fall back only when earlier ports are busy.
#
# The band starts at 8082, NOT 8081: `8081` belongs to the root-checkout Expo
# (`dev:app`, and the `otto-dev` preview config), and desktop dev must never claim
# it - otherwise the two collide whenever both are up, which is the whole reason
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

# Launch Metro + Electron together, kill both on exit. Same runner as
# scripts/dev.sh - it owns the Metro heap bump, the port wait, and the teardown.
#
# This must NOT go back to building shell command strings for `concurrently`.
# Windows PowerShell 5.1 passes arguments to a native command by wrapping them in
# quotes without escaping the quotes already inside, so a command string carrying
# a quoted path came back out of CommandLineToArgvW split at the first space in
# that path: `cd C:\Users\Philippe` and `Durand\...\app && ...` arrived as two
# separate commands, and concurrently ran four of them. Any checkout whose path
# contains a space hit it. dev-runner.mjs passes the directory as a spawn `cwd`
# option, so no shell ever parses it.
node (Join-Path $ScriptDir "dev-runner.mjs")
