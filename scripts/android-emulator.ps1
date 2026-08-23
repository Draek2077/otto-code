# Android emulator lane for local development (Windows).
#
# One entry point for the whole emulator loop, so nobody has to rediscover
# which SDK path, which port and which package id are the real ones. Every
# command is safe to run while Otto Release (6868) and Otto Dev (6788) are up:
# this script never starts, stops or reconfigures a daemon. It only drives the
# emulator and the app installed on it.
#
# Usage:
#   npm run android:emu -- doctor
#   npm run android:emu -- start
#   npm run android:emu -- logs --crash
#
# See docs/android.md for the full workflow.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path

. "$ScriptDir\dev-home.ps1"

# The emulator reaches the host through `adb reverse`, so these are host ports.
# The daemon port comes from dev-home so this lane can never drift onto 6868
# (the installed app) the way a hardcoded default eventually would.
$AvdName = if ($env:OTTO_ANDROID_AVD) { $env:OTTO_ANDROID_AVD } else { "Android_Phone" }
$MetroPort = if ($env:OTTO_ANDROID_METRO_PORT) { $env:OTTO_ANDROID_METRO_PORT } else { "8081" }
$DaemonPort = if ($env:OTTO_ANDROID_DAEMON_PORT) { $env:OTTO_ANDROID_DAEMON_PORT } else { Get-OttoDevDaemonPort }

# Mirrors packages/app/app.config.js: APP_VARIANT=development builds the
# `.debug` id. Keep the two in sync or every flow targets a package that is not
# installed - the exact drift that broke packages/app/maestro for a month.
$AppId = if ($env:OTTO_ANDROID_APP_ID) { $env:OTTO_ANDROID_APP_ID } else { "me.ottocode.mobile.debug" }
$MainActivity = ".MainActivity"

function Get-Sdk {
    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    throw "No Android SDK found. Set ANDROID_HOME, or install the SDK through Android Studio."
}

$Sdk = Get-Sdk
$Adb = Join-Path $Sdk "platform-tools\adb.exe"
$Emulator = Join-Path $Sdk "emulator\emulator.exe"
$EmulatorCheck = Join-Path $Sdk "emulator\emulator-check.exe"

function Assert-Tool {
    param([string] $Path, [string] $Hint)
    if (-not (Test-Path $Path)) { throw "Missing $Path. $Hint" }
}

function Get-BootedSerial {
    if (-not (Test-Path $Adb)) { return $null }
    $lines = & $Adb devices 2>$null | Select-Object -Skip 1
    foreach ($line in $lines) {
        if ($line -match '^(\S+)\s+device$') { return $Matches[1] }
    }
    return $null
}

function Wait-ForBoot {
    param([int] $TimeoutSeconds = 300)

    Write-Host "Waiting for the emulator to finish booting (up to $TimeoutSeconds s)..."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $serial = Get-BootedSerial
        if ($serial) {
            # `device` in adb only means adbd answered. sys.boot_completed is
            # the property that means the launcher is actually up; installing
            # before it flips fails with INSTALL_FAILED_* or a silent no-op.
            $booted = (& $Adb -s $serial shell getprop sys.boot_completed 2>$null | Out-String).Trim()
            if ($booted -eq "1") {
                Write-Host "Booted: $serial"
                return $serial
            }
        }
        Start-Sleep -Seconds 3
    }
    throw "Emulator did not report sys.boot_completed within $TimeoutSeconds s. Try: npm run android:emu -- start -Cold"
}

function Set-Reverse {
    param([string] $Serial)

    # `adb reverse` is what lets the emulator reuse the Metro and daemon that
    # are already running on the host, with the app's own `localhost` addresses
    # and no rebuild. The alternative (10.0.2.2) bakes a different host into the
    # JS bundle and therefore needs a fresh bundle to change.
    & $Adb -s $Serial reverse "tcp:$MetroPort" "tcp:$MetroPort" | Out-Null
    & $Adb -s $Serial reverse "tcp:$DaemonPort" "tcp:$DaemonPort" | Out-Null
    Write-Host "Reversed: Metro $MetroPort, daemon $DaemonPort"
}

function Invoke-Doctor {
    Write-Host "=== Android emulator doctor ==="
    Write-Host "SDK:         $Sdk"
    Write-Host "AVD:         $AvdName"
    Write-Host "App id:      $AppId"
    Write-Host "Metro port:  $MetroPort"
    Write-Host "Daemon port: $DaemonPort"
    Write-Host ""

    $ok = $true

    foreach ($tool in @(@{ Path = $Adb; Name = "adb" }, @{ Path = $Emulator; Name = "emulator" })) {
        if (Test-Path $tool.Path) {
            Write-Host "  [ok]   $($tool.Name)"
        } else {
            Write-Host "  [FAIL] $($tool.Name) missing at $($tool.Path)"
            $ok = $false
        }
    }

    # `java -version` prints to stderr, which a native command turns into a
    # terminating error under `ErrorActionPreference = Stop`. Relax it just here.
    $javaVersion = & {
        $ErrorActionPreference = "Continue"
        (& java -version 2>&1 | Select-Object -First 1 | Out-String).Trim()
    }
    if ($javaVersion -match '"(\d+)') {
        $major = [int]$Matches[1]
        if ($major -ge 17) {
            Write-Host "  [ok]   java $major"
        } else {
            Write-Host "  [FAIL] java $major - the Android Gradle plugin needs 17 or newer"
            $ok = $false
        }
    } else {
        Write-Host "  [FAIL] java not found on PATH"
        $ok = $false
    }

    $imageRoot = Join-Path $Sdk "system-images"
    if (Test-Path $imageRoot) {
        $images = Get-ChildItem -Path $imageRoot -Recurse -Depth 2 -Directory |
            Where-Object { Test-Path (Join-Path $_.FullName "system.img") }
        if ($images) {
            Write-Host "  [ok]   system images: $($images.Count)"
        } else {
            Write-Host "  [FAIL] no system image contains system.img - reinstall through Android Studio"
            $ok = $false
        }
    } else {
        Write-Host "  [FAIL] no system-images directory - install one in Android Studio's SDK Manager"
        $ok = $false
    }

    if (Test-Path $Emulator) {
        $avds = & $Emulator -list-avds 2>$null | Where-Object { $_ -and $_.Trim() }
        if ($avds) {
            Write-Host "  [ok]   AVDs: $($avds -join ', ')"
            if ($avds -notcontains $AvdName) {
                Write-Host "  [warn] '$AvdName' is not one of them - set OTTO_ANDROID_AVD"
            }
        } else {
            Write-Host "  [FAIL] no AVDs - create one in Android Studio's Device Manager"
            $ok = $false
        }
    }

    if (Test-Path $EmulatorCheck) {
        $accel = (& $EmulatorCheck accel 2>&1 | Out-String)
        if ($accel -match "is installed and usable") {
            Write-Host "  [ok]   hardware acceleration"
        } else {
            Write-Host "  [warn] acceleration unconfirmed; the emulator will be slow"
            Write-Host $accel.Trim()
        }
    }

    $serial = Get-BootedSerial
    if ($serial) {
        Write-Host "  [ok]   emulator running: $serial"
        $installed = (& $Adb -s $serial shell pm list packages $AppId 2>$null | Out-String).Trim()
        if ($installed) {
            Write-Host "  [ok]   $AppId installed"
        } else {
            Write-Host "  [warn] $AppId not installed - run: npm run android"
        }
    } else {
        Write-Host "  [warn] no emulator running - run: npm run android:emu -- start"
    }

    foreach ($port in @($MetroPort, $DaemonPort)) {
        $listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
        if ($listening) {
            Write-Host "  [ok]   host port $port is listening"
        } else {
            Write-Host "  [warn] nothing listening on host port $port"
        }
    }

    Write-Host ""
    if ($ok) { Write-Host "Doctor: no blocking problems." } else { Write-Host "Doctor: blocking problems above." }
    if (-not $ok) { exit 1 }
}

function Invoke-Start {
    param([switch] $Cold)

    Assert-Tool $Emulator "Install the emulator package in Android Studio's SDK Manager."

    $existing = Get-BootedSerial
    if ($existing -and -not $Cold) {
        Write-Host "Emulator already running: $existing"
        Set-Reverse -Serial $existing
        return
    }

    $emulatorArgs = @("-avd", $AvdName, "-no-boot-anim")
    if ($Cold) { $emulatorArgs += "-no-snapshot-load" }

    Write-Host "Starting $AvdName..."
    # Detached on purpose: the emulator has to outlive this script, and a child
    # of a transient shell dies with it.
    Start-Process -FilePath $Emulator -ArgumentList $emulatorArgs -WindowStyle Normal | Out-Null

    $serial = Wait-ForBoot
    Set-Reverse -Serial $serial
    Write-Host ""
    Write-Host "Ready. Next: npm run android    (build + install + launch)"
}

function Invoke-Stop {
    $serial = Get-BootedSerial
    if (-not $serial) {
        Write-Host "No emulator running."
        return
    }
    Write-Host "Stopping $serial..."
    & $Adb -s $serial emu kill | Out-Null
    Write-Host "Stopped."
}

function Invoke-Launch {
    $serial = Get-BootedSerial
    if (-not $serial) { throw "No emulator running. Run: npm run android:emu -- start" }
    Set-Reverse -Serial $serial
    & $Adb -s $serial shell am start -n "$AppId/$MainActivity" | Out-Null
    Write-Host "Launched $AppId"
}

function Invoke-Logs {
    param([switch] $Crash)

    $serial = Get-BootedSerial
    if (-not $serial) { throw "No emulator running. Run: npm run android:emu -- start" }

    if ($Crash) {
        Write-Host "Scanning the log buffer..."
        $log = & {
            $ErrorActionPreference = "Continue"
            (& $Adb -s $serial logcat -d -v time 2>&1 | Out-String)
        }
        $lines = $log -split "[\r\n]+"

        # Only these fail the scan. The first two are the Fabric view-parent
        # signature that packages/app/maestro's workspace-create harness greps
        # for; the rest are genuine process death. Ordinary ReactNativeJS error
        # lines are deliberately NOT in here - the app logs handled errors at
        # that level constantly, so counting them as crashes makes the check cry
        # wolf and it stops being read.
        # NOTE: do not add "beginning of crash" here. logcat prints that as a
        # buffer section divider on every device that has ever crashed, so it
        # matches when nothing is wrong.
        $crashPattern = "failed to insert view|specified child already has a parent|FATAL EXCEPTION|ANR in "
        $crashes = $lines | Where-Object { $_ -match $crashPattern }

        $jsErrors = $lines | Where-Object { $_ -match "ReactNativeJS.*(Error|error:)" }
        if ($jsErrors) {
            Write-Host ""
            Write-Host "JS errors (informational, not failures): $($jsErrors.Count) lines"
            $jsErrors | Select-Object -Last 10 | ForEach-Object { Write-Host "  $_" }
        }

        if ($crashes) {
            Write-Host ""
            Write-Host "CRASH SIGNATURES: $($crashes.Count) lines"
            $crashes | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
            exit 1
        }

        Write-Host ""
        Write-Host "No crash signatures in the current buffer."
        return
    }

    Write-Host "Tailing logcat (Ctrl+C to stop)..."
    & $Adb -s $serial logcat -v time ReactNative:V ReactNativeJS:V AndroidRuntime:E "*:S"
}

function Invoke-Shot {
    param([string] $OutPath)

    $serial = Get-BootedSerial
    if (-not $serial) { throw "No emulator running. Run: npm run android:emu -- start" }

    if (-not $OutPath) {
        $tmp = Join-Path $RepoRoot ".tmp"
        if (-not (Test-Path $tmp)) { New-Item -ItemType Directory -Path $tmp | Out-Null }
        $OutPath = Join-Path $tmp ("emulator-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".png")
    }

    # Capture to the device, then pull. Piping `exec-out screencap` into a file
    # looks simpler and is wrong on any multi-display AVD: screencap prepends a
    # "Multiple displays were found" warning to *stdout*, so the PNG arrives
    # with a few hundred bytes of English in front of the magic number and no
    # viewer will open it. Writing on-device sidesteps the shared stream, and
    # `adb pull` moves the bytes verbatim.
    $devicePath = "/sdcard/otto-emulator-shot.png"
    & {
        $ErrorActionPreference = "Continue"
        & $Adb -s $serial shell screencap -p $devicePath 2>&1 | Out-Null
        & $Adb -s $serial pull $devicePath $OutPath 2>&1 | Out-Null
        & $Adb -s $serial shell rm -f $devicePath 2>&1 | Out-Null
    }

    if (-not (Test-Path $OutPath)) { throw "Screenshot capture failed; nothing was written to $OutPath" }
    Write-Host $OutPath
}

function Invoke-Reverse {
    $serial = Get-BootedSerial
    if (-not $serial) { throw "No emulator running. Run: npm run android:emu -- start" }
    Set-Reverse -Serial $serial
}

function Show-Usage {
    Write-Host @"
Otto Android emulator lane

  doctor              Check SDK, JDK, images, AVDs, acceleration and ports
  start [-Cold]       Boot the AVD, wait for boot, apply adb reverse
  stop                Shut the emulator down
  launch              Start the installed app
  reverse             Re-apply the Metro and daemon port reverses
  logs [-Crash]       Tail the app log, or scan the buffer for crash signatures
  shot [path]         Write a PNG screenshot (defaults into .tmp/)

Environment:
  OTTO_ANDROID_AVD           default $AvdName
  OTTO_ANDROID_METRO_PORT    default 8081
  OTTO_ANDROID_DAEMON_PORT   default the dev lane port from scripts/dev-home.ps1
  OTTO_ANDROID_APP_ID        default me.ottocode.mobile.debug
"@
}

$command = if ($args.Count -gt 0) { $args[0] } else { "" }
$rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

switch ($command.ToLowerInvariant()) {
    "doctor" { Invoke-Doctor }
    "start" { Invoke-Start -Cold:($rest -contains "-Cold" -or $rest -contains "--cold") }
    "stop" { Invoke-Stop }
    "launch" { Invoke-Launch }
    "reverse" { Invoke-Reverse }
    "logs" { Invoke-Logs -Crash:($rest -contains "-Crash" -or $rest -contains "--crash") }
    "shot" { Invoke-Shot -OutPath ($rest | Where-Object { $_ -notlike "-*" } | Select-Object -First 1) }
    default { Show-Usage }
}
