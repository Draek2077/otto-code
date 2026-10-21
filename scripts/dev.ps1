$ErrorActionPreference = "Stop"

# Ensure node_modules/.bin is in PATH
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$ScriptDir\..\node_modules\.bin;$env:PATH"

# OTTO(dev-isolation): one managed home and port for every Windows launcher.
. "$PSScriptRoot/dev-home.ps1"
$DevEnvironment = Initialize-OttoDevEnvironment

Write-Host @"
======================================================
  Paseo Dev (Windows)
======================================================
  Home:    $($env:PASEO_HOME)
  Models:  $($env:PASEO_LOCAL_MODELS_DIR)
  Daemon:  localhost:$($DevEnvironment.Port)
======================================================
"@

# Allow any origin in dev so Electron on random ports all work.
# SECURITY: wildcard CORS is unsafe in production — only acceptable here because
# the daemon binds to localhost and this script is never used for production.
$env:PASEO_CORS_ORIGINS = "*"

# Configure the app to auto-connect to this daemon on localhost
$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = "localhost:$($DevEnvironment.Port)"
$env:EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL = (git branch --show-current).Trim()
$env:PASEO_LISTEN = $DevEnvironment.Listen
$env:BROWSER = "none"

# Run both with concurrently
concurrently `
    --names "daemon,metro" `
    --prefix-colors "cyan,magenta" `
    "npm run dev:server:watch" `
    "cd packages/app && npx expo start"
