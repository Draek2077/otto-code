$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path "$ScriptDir\..").Path
$AppDir = (Resolve-Path "$DesktopDir\..\app").Path
$RootDir = (Resolve-Path "$DesktopDir\..\..").Path
$env:PATH = "$RootDir\node_modules\.bin;$env:PATH"

# Build the Electron main process
npm run build:main

# Prefer Metro's stable default port so dev browser storage keeps the same
# localhost origin across restarts. Fall back only when earlier ports are busy.
$PreviousNoColor = $env:NO_COLOR
$PreviousForceColor = $env:FORCE_COLOR
try {
    $env:NO_COLOR = "1"
    $env:FORCE_COLOR = "0"
    $env:EXPO_PORT = (npx get-port-cli 8081 8082 8083 8084 8085).Trim()
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
$env:EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL = (git -C $RootDir branch --show-current).Trim()

$env:PASEO_DEV_ROOT = $RootDir
$env:PASEO_DEV_RUNTIME_FALLBACK_ROOT = $RootDir
$DevRuntime = node "$ScriptDir\dev-runtime.mjs" | ConvertFrom-Json
$env:PASEO_ELECTRON_FLAGS = $DevRuntime.electronFlags
$env:PASEO_ELECTRON_USER_DATA_DIR = $DevRuntime.userDataDir
Remove-Item Env:\PASEO_DEV_RUNTIME_FALLBACK_ROOT -ErrorAction SilentlyContinue

# Allow any origin in dev so Electron on random ports works.
# SECURITY: wildcard CORS is unsafe in production — only acceptable here because
# the daemon binds to localhost and this script is never used for production.
$env:PASEO_CORS_ORIGINS = "*"

# OTTO(dev-isolation): share the root launcher's Otto home and port.
. "$RootDir/scripts/dev-home.ps1"
$DevEnvironment = Initialize-OttoDevEnvironment
New-Item -ItemType Directory -Force -Path $env:PASEO_ELECTRON_USER_DATA_DIR | Out-Null

Write-Host @"
======================================================
  Paseo Desktop Dev (Windows)
======================================================
  Metro:      http://localhost:$($env:EXPO_PORT)
  Daemon:     $($env:PASEO_LISTEN) (isolated)
  PASEO_HOME: $($env:PASEO_HOME)
  userData:   $($env:PASEO_ELECTRON_USER_DATA_DIR)
======================================================
"@

# Launch Metro + Electron together, kill both on exit
concurrently `
    --kill-others `
    --names "metro,electron" `
    --prefix-colors "magenta,cyan" `
    "cd `"$AppDir`" && cross-env PASEO_WEB_PLATFORM=electron npx expo start --port $($env:EXPO_PORT)" `
    "npx wait-on tcp:$($env:EXPO_PORT) && npx electron `"$DesktopDir`""
