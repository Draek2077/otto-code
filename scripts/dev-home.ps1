# Otto's Windows dev lane. Paseo's readers receive PASEO_* values; existing Otto
# settings and checkout-local data keep their names. Explicit homes are never seeded.
function Initialize-OttoDevEnvironment {
    foreach ($ottoVariable in (Get-ChildItem Env:OTTO_*)) {
        $paseoName = 'PASEO_' + $ottoVariable.Name.Substring(5)
        if (-not (Test-Path "Env:$paseoName")) {
            [Environment]::SetEnvironmentVariable($paseoName, $ottoVariable.Value, 'Process')
        }
    }
    $devPort = if ($env:PASEO_DEV_DAEMON_PORT) { $env:PASEO_DEV_DAEMON_PORT } else { '6788' }
    $managedHome = -not $env:PASEO_HOME
    if ($managedHome) {
        $devRoot = if ($env:PASEO_DEV_ROOT) { $env:PASEO_DEV_ROOT } else { (Resolve-Path "$PSScriptRoot\..").Path }
        $env:PASEO_HOME = if ($env:PASEO_DEV_HOME) { $env:PASEO_DEV_HOME } else { Join-Path $devRoot 'packages\desktop\.dev\otto-home' }
    }
    if (-not $env:PASEO_LISTEN) { $env:PASEO_LISTEN = "127.0.0.1:$devPort" }
    if (-not $env:PASEO_CORS_ORIGINS) { $env:PASEO_CORS_ORIGINS = '*' }
    if (-not $env:PASEO_LOCAL_MODELS_DIR) { $env:PASEO_LOCAL_MODELS_DIR = Join-Path $env:USERPROFILE '.otto\models\local-speech' }
    $env:OTTO_HOME = $env:PASEO_HOME
    $env:OTTO_LISTEN = $env:PASEO_LISTEN
    New-Item -ItemType Directory -Force -Path $env:PASEO_HOME | Out-Null
    if ($managedHome) {
        node (Join-Path $PSScriptRoot 'otto/seed-dev-config.mjs') (Join-Path $env:PASEO_HOME 'config.json') $env:PASEO_LISTEN
        if ($LASTEXITCODE -ne 0) { throw 'Could not seed the Otto dev configuration' }
    }
    return [pscustomobject]@{
        Port = $devPort
        Home = $env:PASEO_HOME
        Listen = $env:PASEO_LISTEN
        Endpoint = $env:PASEO_LISTEN -replace '^(127\.0\.0\.1|0\.0\.0\.0):', 'localhost:'
        ManagedHome = $managedHome
    }
}
