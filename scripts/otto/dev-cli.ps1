$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../dev-home.ps1"
$DevEnvironment = Initialize-OttoDevEnvironment
& node --import tsx "$PSScriptRoot/../../packages/cli/src/index.ts" @args
exit $LASTEXITCODE
