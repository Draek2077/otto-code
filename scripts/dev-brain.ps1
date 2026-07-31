$ErrorActionPreference = "Stop"

# Run the standalone Otto Brain CLI from TypeScript source (via tsx) against the
# isolated dev OTTO_HOME. Windows mirror of `dev:brain` (./scripts/dev-home.sh npx
# tsx packages/brain/src/main.ts): same "run from source, dev home, never touch
# ~/.otto" contract, expressed through the PowerShell dev-home helpers.
#
# Pass brain verbs through npm's `--`, e.g.
#   npm run dev:win:brain -- scan
#   npm run dev:win:brain -- serve --model X

# Capture the forwarded brain verbs before anything else: dot-sourcing a script
# with no arguments clobbers this scope's automatic $args, so grab it first.
$BrainArgs = $args

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$ScriptDir\..\node_modules\.bin;$env:PATH"

# Isolated dev environment: dev port, dev OTTO_HOME. The brain resolves OTTO_HOME
# itself, so this is what keeps a dev brain pointed at the checkout-local home
# instead of the installed app's ~/.otto.
. "$ScriptDir\dev-home.ps1"
Initialize-OttoDevEnvironment | Out-Null

npx tsx (Join-Path $ScriptDir "..\packages\brain\src\main.ts") @BrainArgs
exit $LASTEXITCODE
