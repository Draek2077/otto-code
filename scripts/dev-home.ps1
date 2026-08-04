# Shared dev-environment defaults for the Windows dev scripts.
#
# PowerShell mirror of scripts/dev-home.sh - keep the two in sync. Both exist to
# guarantee one thing: a dev Otto never touches the installed Otto. Different
# port, different OTTO_HOME, different Electron userData.

# The dev daemon port. Deliberately NOT 6868: that belongs to the installed
# desktop app's daemon over `~/.otto`, and a dev daemon that lands on it either
# crash-loops fighting for the port or - worse - silently hands dev clients and
# `npm run cli` the production agent state. Keep the two on separate ports so
# both can run at once. Override with OTTO_DEV_DAEMON_PORT.
function Get-OttoDevDaemonPort {
    if ($env:OTTO_DEV_DAEMON_PORT) { return $env:OTTO_DEV_DAEMON_PORT }
    return "6788"
}

function Get-OttoDevRoot {
    if ($env:OTTO_DEV_ROOT) { return $env:OTTO_DEV_ROOT }
    $repoRoot = git rev-parse --show-toplevel 2>$null
    if (-not $repoRoot) { $repoRoot = (Resolve-Path "$PSScriptRoot\..").Path }
    return ($repoRoot -replace '/', '\')
}

# The one dev home, shared by every dev entrypoint (root daemon, Expo, desktop
# Electron, `npm run cli`). It sits under packages/desktop because that is where
# the desktop dev script has always put it, and that is where the accumulated
# dev state lives. Everything else was pointed here rather than the reverse so
# no one has to move a populated home - and its git worktrees - to get one.
# Derived from the checkout root, so an Otto worktree still gets its own.
# OTTO_DEV_HOME names a *managed* home other than the default one - the escape
# hatch for standing up an additional isolated lane (see the agent lane in
# docs/development.md). It differs from raw OTTO_HOME, which is honored but never
# written to: a managed home gets its config.json seeded with the lane's port, so
# the lane actually answers on its own port instead of inheriting 6868.
function Get-OttoDevHome {
    if ($env:OTTO_DEV_HOME) { return $env:OTTO_DEV_HOME }
    return (Join-Path (Get-OttoDevRoot) "packages\desktop\.dev\otto-home")
}

function Get-OttoDevStateDir {
    return (Split-Path -Parent (Get-OttoDevHome))
}

# Seeds the dev home's config.json. See scripts/seed-dev-daemon-config.mjs for
# why the daemon's listen address has to land in the file and not just the env.
function Set-OttoDevDaemonConfig {
    param(
        [Parameter(Mandatory = $true)][string] $OttoHome,
        [Parameter(Mandatory = $true)][string] $Listen
    )

    node (Join-Path $PSScriptRoot "seed-dev-daemon-config.mjs") `
        (Join-Path $OttoHome "config.json") $Listen
}

# Establishes the isolated dev environment and returns its settings. An
# OTTO_HOME already in the environment is honored and left completely alone -
# including its config.json, which may be a production one the caller pointed us
# at on purpose. Only the script-managed home gets seeded.
function Initialize-OttoDevEnvironment {
    $devPort = Get-OttoDevDaemonPort
    $managedHome = $false

    if (-not $env:OTTO_HOME) {
        $env:OTTO_HOME = Get-OttoDevHome
        $managedHome = $true
    }
    New-Item -ItemType Directory -Force -Path $env:OTTO_HOME | Out-Null

    if (-not $env:OTTO_LISTEN) { $env:OTTO_LISTEN = "127.0.0.1:$devPort" }

    # Allow any origin in dev so Electron and Metro on their shifting localhost
    # ports all work. SECURITY: wildcard CORS is unsafe in production - only
    # acceptable here because the dev daemon binds to loopback and these scripts
    # are never used for production.
    if (-not $env:OTTO_CORS_ORIGINS) { $env:OTTO_CORS_ORIGINS = "*" }

    # Relay off by default in dev: the hosted relay endpoint is not live yet, so
    # the daemon would just spam DNS-failure retries. Set OTTO_RELAY_ENABLED=true
    # to opt in.
    if (-not $env:OTTO_RELAY_ENABLED) { $env:OTTO_RELAY_ENABLED = "false" }

    # Share speech models with the installed app to avoid re-downloading GBs.
    # This is the one directory dev and production are meant to have in common.
    if (-not $env:OTTO_LOCAL_MODELS_DIR) {
        $env:OTTO_LOCAL_MODELS_DIR = "$env:USERPROFILE\.otto\models\local-speech"
        New-Item -ItemType Directory -Force -Path $env:OTTO_LOCAL_MODELS_DIR | Out-Null
    }

    if ($managedHome) {
        Set-OttoDevDaemonConfig -OttoHome $env:OTTO_HOME -Listen $env:OTTO_LISTEN
    }

    $endpoint = $env:OTTO_LISTEN -replace '^(127\.0\.0\.1|0\.0\.0\.0):', 'localhost:'

    return [pscustomobject]@{
        Port          = $devPort
        Home          = $env:OTTO_HOME
        Listen        = $env:OTTO_LISTEN
        Endpoint      = $endpoint
        ManagedHome   = $managedHome
    }
}
