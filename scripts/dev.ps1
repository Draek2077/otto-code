$ErrorActionPreference = "Stop"

# Ensure node_modules/.bin is in PATH
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$ScriptDir\..\node_modules\.bin;$env:PATH"

# Derive OTTO_HOME: stable name for worktrees, temporary dir otherwise
if (-not $env:OTTO_HOME) {
    $GitDir = git rev-parse --git-dir 2>$null
    $GitCommonDir = git rev-parse --git-common-dir 2>$null

    if ($GitDir -and $GitCommonDir -and ($GitDir -ne $GitCommonDir)) {
        # Inside a worktree — derive a stable home from the worktree name
        $WorktreeRoot = git rev-parse --show-toplevel
        $WorktreeName = (Split-Path -Leaf $WorktreeRoot).ToLower() -replace '[^a-z0-9-]', '-' -replace '-+', '-' -replace '^-|-$', ''
        $env:OTTO_HOME = "$env:USERPROFILE\.otto-$WorktreeName"
        New-Item -ItemType Directory -Force -Path $env:OTTO_HOME | Out-Null
    } else {
        $env:OTTO_HOME = Join-Path ([System.IO.Path]::GetTempPath()) "otto-dev-$([System.Guid]::NewGuid().ToString('N').Substring(0,6))"
        New-Item -ItemType Directory -Force -Path $env:OTTO_HOME | Out-Null
        # Register cleanup on exit
        $TempOttoHome = $env:OTTO_HOME
        Register-EngineEvent PowerShell.Exiting -Action {
            Remove-Item -Recurse -Force $TempOttoHome -ErrorAction SilentlyContinue
        } | Out-Null
    }
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
  Daemon:  localhost:6768
======================================================
"@

# Allow any origin in dev so Electron on random ports all work.
# SECURITY: wildcard CORS is unsafe in production — only acceptable here because
# the daemon binds to localhost and this script is never used for production.
$env:OTTO_CORS_ORIGINS = "*"

# Configure the app to auto-connect to this daemon on localhost
$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = "localhost:6768"
$env:OTTO_LISTEN = "127.0.0.1:6768"
$env:BROWSER = "none"

# Run both with concurrently
concurrently `
    --names "daemon,metro" `
    --prefix-colors "cyan,magenta" `
    "npm run dev:server:watch" `
    "cd packages/app && npx expo start"
