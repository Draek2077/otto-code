#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Runs the repo's vitest suites end to end and captures every line to file.

.DESCRIPTION
  Each suite gets its own log, and the run never stops on a failure, so one
  broken workspace cannot hide the state of the eight after it. The output is
  written for a reader that cannot scroll a terminal: `combined.log` opens with
  the verdict table, and `failures.log` carries only the suites that failed.

  Colour is disabled and ANSI escapes are stripped, because vitest's progress
  rewriting turns a piped log into cursor-movement noise that is worse than
  useless to a downstream reader.

  Deliberately NOT set: CI=1. It would read as a different environment than the
  one being tested, and it silently switches off the opt-in voice E2E in
  packages/server. Piping alone already puts vitest in its non-interactive
  reporter, which is the part that mattered.

.PARAMETER LogDir
  Where the logs land. Relative paths resolve against the repo root.
  Existing *.log / *.jsonl / summary.md in that directory are replaced.

.PARAMETER SkipBuild
  Skip the two build steps. Only safe when the workspace `dist` output is
  already current; stale cross-workspace declarations produce fake type errors.

.PARAMETER Only
  Run a subset, by step key. Example: -Only server,app

.PARAMETER KillDiag
  Windows only. Loads scripts/vitest-kill-diag.cjs into every node process of
  the server steps and writes a kill/exit ledger next to the logs. Use this when
  a suite prints all-green and then dies with "[vitest-pool]: Worker forks
  emitted error"; the ledger names the killer call site and the victim fork.

.EXAMPLE
  ./scripts/run-full-suite.ps1

.EXAMPLE
  ./scripts/run-full-suite.ps1 -SkipBuild -Only server,server-e2e -KillDiag
#>
[CmdletBinding()]
param(
  [string]$LogDir = "test-logs",
  [switch]$SkipBuild,
  [string[]]$Only,
  [switch]$KillDiag
)

$ErrorActionPreference = "Continue"
# PS 7.4+ turns a non-zero native exit code into a terminating error when
# ErrorActionPreference is Stop. Every step here is expected to be able to fail.
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$logRoot = if ([System.IO.Path]::IsPathRooted($LogDir)) { $LogDir } else { Join-Path $repoRoot $LogDir }
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
Get-ChildItem -Path $logRoot -File -Include *.log, *.jsonl, summary.md -Recurse |
  Remove-Item -Force -ErrorAction SilentlyContinue

# oxfmt/oxlint and every workspace binary live here. An empty .bin means an
# interrupted install, and every step below would fail identically on "not
# recognized as an internal or external command".
if (-not (Test-Path (Join-Path $repoRoot "node_modules/.bin/tsc*"))) {
  Write-Host "node_modules/.bin looks empty. Run 'npm ci' before this script." -ForegroundColor Red
  exit 1
}

$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"
$ansi = "$([char]27)\[[0-9;?]*[a-zA-Z]"

$steps = @(
  @{ Key = "build-server";   Title = "build: server stack";       Halt = $true;  Args = @("run", "build:server") }
  @{ Key = "build-app-deps"; Title = "build: app dependencies";   Halt = $true;  Args = @("run", "build:app-deps") }
  @{ Key = "protocol";       Title = "protocol";                  Halt = $false; Args = @("run", "test", "--workspace=@otto-code/protocol") }
  @{ Key = "client";         Title = "client";                    Halt = $false; Args = @("run", "test", "--workspace=@otto-code/client") }
  @{ Key = "highlight";      Title = "highlight";                 Halt = $false; Args = @("run", "test", "--workspace=@otto-code/highlight") }
  @{ Key = "relay";          Title = "relay";                     Halt = $false; Args = @("run", "test", "--workspace=@otto-code/relay") }
  @{ Key = "brain";          Title = "brain";                     Halt = $false; Args = @("run", "test", "--workspace=@otto-code/brain") }
  @{ Key = "server";         Title = "server (unit + integration)"; Halt = $false; Args = @("run", "test", "--workspace=@otto-code/server") }
  @{ Key = "desktop";        Title = "desktop";                   Halt = $false; Args = @("run", "test", "--workspace=@otto-code/desktop") }
  @{ Key = "app";            Title = "app (unit + browser)";      Halt = $false; Args = @("run", "test", "--workspace=@otto-code/app") }
  @{ Key = "cli-unit";       Title = "cli (unit only)";           Halt = $false; Args = @("run", "test:unit", "--workspace=@otto-code/cli") }
  @{ Key = "server-e2e";     Title = "server daemon E2E";         Halt = $false; Args = @("run", "test:e2e", "--workspace=@otto-code/server") }
)

if ($SkipBuild) { $steps = $steps | Where-Object { $_.Key -notlike "build-*" } }
if ($Only) { $steps = $steps | Where-Object { $Only -contains $_.Key } }

if (-not $steps) {
  Write-Host "No steps matched -Only. Valid keys: build-server, build-app-deps, protocol, client, highlight, relay, brain, server, desktop, app, cli-unit, server-e2e" -ForegroundColor Red
  exit 1
}

Write-Host "Logs: $logRoot" -ForegroundColor DarkGray
Write-Host ""

$results = @()
$runStarted = Get-Date

foreach ($step in $steps) {
  $log = Join-Path $logRoot "$($step.Key).log"
  $cmd = "npm $($step.Args -join ' ')"
  $started = Get-Date

  Write-Host "==> $($step.Title)" -ForegroundColor Cyan
  Write-Host "    $cmd" -ForegroundColor DarkGray

  "===== $($step.Key) :: $cmd" | Out-File -FilePath $log -Encoding utf8
  "===== started $($started.ToString('u'))" | Out-File -FilePath $log -Encoding utf8 -Append

  $usedKillDiag = $false
  if ($KillDiag -and $IsWindows -and $step.Key -like "server*") {
    $env:NODE_OPTIONS = "--require `"$repoRoot\scripts\vitest-kill-diag.cjs`""
    $env:OTTO_KILL_DIAG_FILE = Join-Path $logRoot "$($step.Key)-kill-diag.jsonl"
    $usedKillDiag = $true
  }

  $stepArgs = $step.Args
  & npm @stepArgs 2>&1 |
    ForEach-Object { $_.ToString() -replace $ansi, "" } |
    Tee-Object -FilePath $log -Append

  $code = $LASTEXITCODE

  if ($usedKillDiag) {
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    Remove-Item Env:OTTO_KILL_DIAG_FILE -ErrorAction SilentlyContinue
  }

  $elapsed = (Get-Date) - $started
  "===== exit $code after $([int]$elapsed.TotalSeconds)s" | Out-File -FilePath $log -Encoding utf8 -Append

  $results += [pscustomobject]@{
    Key      = $step.Key
    Title    = $step.Title
    Command  = $cmd
    Exit     = $code
    Seconds  = [int]$elapsed.TotalSeconds
    Log      = "$($step.Key).log"
  }

  if ($code -eq 0) {
    Write-Host "    PASS in $([int]$elapsed.TotalSeconds)s" -ForegroundColor Green
  } else {
    Write-Host "    FAIL (exit $code) in $([int]$elapsed.TotalSeconds)s" -ForegroundColor Red
  }
  Write-Host ""

  if ($code -ne 0 -and $step.Halt) {
    Write-Host "Build step failed. Testing against stale or missing dist output would only produce fake failures, so stopping here." -ForegroundColor Red
    break
  }
}

$totalElapsed = (Get-Date) - $runStarted
$failed = @($results | Where-Object { $_.Exit -ne 0 })

$summary = @()
$summary += "# Full suite run"
$summary += ""
$summary += "- Started: $($runStarted.ToString('u'))"
$summary += "- Wall clock: $([int]$totalElapsed.TotalMinutes)m $($totalElapsed.Seconds)s"
$summary += "- Steps run: $($results.Count)"
$summary += "- Failed: $($failed.Count)"
$summary += ""
$summary += "| step | result | seconds | command | log |"
$summary += "| ---- | ------ | ------- | ------- | --- |"
foreach ($r in $results) {
  $verdict = if ($r.Exit -eq 0) { "pass" } else { "FAIL ($($r.Exit))" }
  $summary += "| $($r.Key) | $verdict | $($r.Seconds) | ``$($r.Command)`` | $($r.Log) |"
}
$summary += ""
if ($failed.Count -gt 0) {
  $summary += "Failing steps, full output in failures.log:"
  foreach ($r in $failed) { $summary += "- $($r.Key) ($($r.Log))" }
} else {
  $summary += "All steps passed."
}

$summaryPath = Join-Path $logRoot "summary.md"
$summary | Out-File -FilePath $summaryPath -Encoding utf8

# combined.log leads with the verdict table so a reader that starts at line 1
# knows what it is looking at before the first stack trace.
$combinedPath = Join-Path $logRoot "combined.log"
$summary | Out-File -FilePath $combinedPath -Encoding utf8
foreach ($r in $results) {
  "" | Out-File -FilePath $combinedPath -Encoding utf8 -Append
  "########## $($r.Key) (exit $($r.Exit)) ##########" | Out-File -FilePath $combinedPath -Encoding utf8 -Append
  Get-Content (Join-Path $logRoot $r.Log) | Out-File -FilePath $combinedPath -Encoding utf8 -Append
}

$failuresPath = Join-Path $logRoot "failures.log"
if ($failed.Count -gt 0) {
  $summary | Out-File -FilePath $failuresPath -Encoding utf8
  foreach ($r in $failed) {
    "" | Out-File -FilePath $failuresPath -Encoding utf8 -Append
    "########## $($r.Key) (exit $($r.Exit)) ##########" | Out-File -FilePath $failuresPath -Encoding utf8 -Append
    Get-Content (Join-Path $logRoot $r.Log) | Out-File -FilePath $failuresPath -Encoding utf8 -Append
  }
}

Write-Host "----------------------------------------" -ForegroundColor DarkGray
foreach ($r in $results) {
  $colour = if ($r.Exit -eq 0) { "Green" } else { "Red" }
  Write-Host ("{0,-16} {1,6}s  exit {2}" -f $r.Key, $r.Seconds, $r.Exit) -ForegroundColor $colour
}
Write-Host "----------------------------------------" -ForegroundColor DarkGray
Write-Host "summary:   $summaryPath"
Write-Host "combined:  $combinedPath"
if ($failed.Count -gt 0) { Write-Host "failures:  $failuresPath" -ForegroundColor Red }
Write-Host "total:     $([int]$totalElapsed.TotalMinutes)m $($totalElapsed.Seconds)s"

exit ([int]($failed.Count -gt 0))
