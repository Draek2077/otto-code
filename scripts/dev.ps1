$ErrorActionPreference = "Stop"

# Ensure node_modules/.bin is in PATH
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$ScriptDir\..\node_modules\.bin;$env:PATH"

# Tie every child we spawn (daemon, Metro, and any preview dev servers the
# daemon spawns with CREATE_NO_WINDOW — which Ctrl-C never reaches) to this
# script's lifetime, so Ctrl-C / closing the terminal tears the whole tree
# down. See the helper for why nothing weaker works on Windows.
. "$ScriptDir\dev-kill-on-close-job.ps1"
Enable-OttoDevTreeTeardown

# Persistent checkout-local home, matching scripts/dev-home.sh. A throwaway home
# would mint a new daemon keypair/serverId every run, and clients that remembered
# the previous identity refuse the new one (host-runtime closes the connection on
# serverId mismatch) — the home must survive restarts.
if (-not $env:OTTO_HOME) {
    $RepoRoot = git rev-parse --show-toplevel 2>$null
    if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $ScriptDir }
    $env:OTTO_HOME = Join-Path ($RepoRoot -replace '/', '\') ".dev\otto-home"
    New-Item -ItemType Directory -Force -Path $env:OTTO_HOME | Out-Null
}

# Share speech models with the main install to avoid duplicate downloads
if (-not $env:OTTO_LOCAL_MODELS_DIR) {
    $env:OTTO_LOCAL_MODELS_DIR = "$env:USERPROFILE\.otto\models\local-speech"
    New-Item -ItemType Directory -Force -Path $env:OTTO_LOCAL_MODELS_DIR | Out-Null
}

Write-Host @"
======================================================
  Otto Dev (Windows)
======================================================
  Home:    $($env:OTTO_HOME)
  Models:  $($env:OTTO_LOCAL_MODELS_DIR)
  Daemon:  localhost:6868
======================================================
"@

# Relay off by default in dev: the hosted relay endpoint is not live yet, so the
# daemon would just spam DNS-failure retries. Set OTTO_RELAY_ENABLED=true to opt in.
if (-not $env:OTTO_RELAY_ENABLED) { $env:OTTO_RELAY_ENABLED = "false" }

# Allow any origin in dev so Electron on random ports all work.
# SECURITY: wildcard CORS is unsafe in production — only acceptable here because
# the daemon binds to localhost and this script is never used for production.
$env:OTTO_CORS_ORIGINS = "*"

# Configure the app to auto-connect to this daemon on localhost
$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = "localhost:6868"
$env:OTTO_LISTEN = "127.0.0.1:6868"
$env:BROWSER = "none"

# Run both with concurrently
concurrently `
    --names "daemon,metro" `
    --prefix-colors "cyan,magenta" `
    "npm run dev:server:watch" `
    "cd packages/app && npx expo start"
