# Android

## App variants

Controlled by `APP_VARIANT` in `packages/app/app.config.js` (vanilla Expo, no custom Gradle plugin):

| Variant       | App name   | Package ID                 |
| ------------- | ---------- | -------------------------- |
| `production`  | Otto       | `me.ottocode.mobile`       |
| `development` | Otto Debug | `me.ottocode.mobile.debug` |

EAS profiles: `development`, `production`, and `production-apk` in `packages/app/eas.json`.

`development` uses Android `debug`.

## Version codes

`packages/app/app.config.js` derives Android `versionCode` from the package version with:

```text
major * 1_000_000 + minor * 1_000 + patch
```

Prerelease metadata is ignored, so `0.1.102-beta.1` and `0.1.102` both produce `1102`. The same value is used as the iOS `buildNumber` because `packages/app/eas.json` uses EAS's local app version source. Do not re-enable EAS remote version counters or Android `autoIncrement`; F-Droid and other source-based builders need the native build number to be visible in the repo.

The formula reserves three digits each for minor and patch. If either reaches `1000`, change the formula before cutting that release.

## Prerequisites (local dev)

### macOS and Linux (mise)

The Android toolchain is pinned in `.tool-versions` (`java 21`, `android-sdk 21.0`) and wired up by `.mise.toml` (which derives `ANDROID_HOME` and the command-line tool paths from the `android-sdk` entry). With [mise](https://mise.jdx.dev):

```bash
mise install        # java 21 + android-sdk 21.0 command-line tools
```

> **Pin a real `android-sdk` version, not `latest`.** The mise `android-sdk` plugin's `latest` resolved to the ancient `1.0` bundle, whose `sdkmanager` (3.6.0) predates the `emulator` package and fails with `Failed to find package emulator`. `21.0` ships a current `sdkmanager`. If you bump it, update only the version in `.tool-versions`; `.mise.toml` derives its paths from that tool entry.

`mise install` only lays down the command-line tools. Install the rest and create an emulator. On Apple Silicon:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" \
           "system-images;android-35;google_apis;arm64-v8a"
avdmanager create avd -n otto -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7
emulator @otto     # start it; leave running
```

On an Intel Mac, use the `x86_64` system image:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" \
           "system-images;android-35;google_apis;x86_64"
avdmanager create avd -n otto -k "system-images;android-35;google_apis;x86_64" -d pixel_7
emulator @otto     # start it; leave running
```

Gradle auto-fetches the platform/build-tools it needs once licenses are accepted, so adjust `android-35` only if it asks for a different level.

### Windows (Android Studio)

Windows does not use mise. Install **Android Studio** and let it own the SDK; everything else is
already on the machine or comes from the repo.

1. Android Studio → **SDK Manager** → SDK Platforms: install one platform (API 36 is current).
2. Same dialog → **SDK Tools**: make sure `Android SDK Platform-Tools` and `Android Emulator` are
   ticked.
3. SDK Platforms → **Show Package Details**: tick a system image. `google_apis` x86_64 is the right
   default; take `google_apis_playstore` only if the scenario needs the Play Store app.
4. **Device Manager** → create a virtual device.

You do **not** need `cmdline-tools` (`sdkmanager` / `avdmanager`) if you create devices through
Android Studio. It is only worth installing if you want to script AVD creation.

Then verify the whole toolchain in one command:

```bash
npm run android:emu -- doctor
```

`doctor` checks the SDK path, the JDK major version, that a system image actually contains a
`system.img`, that at least one AVD exists, that hardware acceleration is usable, and which of the
host ports are listening. It prints `[FAIL]` only for things that will genuinely stop a build, so a
clean run means you can go straight to building.

> **JDK 17 or newer.** The Android Gradle plugin will not run on older Java. `doctor` fails loudly
> rather than letting Gradle produce a confusing class-version error much later.

> **Hardware acceleration on Windows is WHPX, not HAXM.** HAXM is dead on modern Windows and
> irrelevant here. If Hyper-V or the Windows Hypervisor Platform is enabled, the emulator uses WHPX
> automatically. `emulator-check accel` is the authority, and `doctor` runs it for you. Do not go
> hunting in BIOS before checking it.

## The emulator lane on Windows

`scripts/android-emulator.ps1` (through `npm run android:emu`) is the one entry point. It never
starts, stops or reconfigures a daemon, so it is safe to run while the installed app (6868) and the
dev lane (6788) are both up.

```bash
npm run android:emu -- doctor       # check the toolchain
npm run android:emu -- start        # boot the AVD, wait for boot, wire up ports
npm run android:emu -- launch       # start the installed app
npm run android:emu -- logs --crash # scan the log buffer for crash signatures
npm run android:emu -- logs         # tail the app log
npm run android:emu -- shot         # PNG screenshot into .tmp/
npm run android:emu -- stop
```

Defaults, all overridable by environment variable:

| Variable                   | Default                    | Notes                                        |
| -------------------------- | -------------------------- | -------------------------------------------- |
| `OTTO_ANDROID_AVD`         | `Android_Phone`            | Any name from `emulator -list-avds`          |
| `OTTO_ANDROID_METRO_PORT`  | `8081`                     | Expo's default                               |
| `OTTO_ANDROID_DAEMON_PORT` | the dev lane port (`6788`) | Read from `scripts/dev-home.ps1`, never 6868 |
| `OTTO_ANDROID_APP_ID`      | `me.ottocode.mobile.debug` | Must match `APP_VARIANT` in `app.config.js`  |

### Why `start` waits, and what it waits for

`adb devices` reporting `device` only means `adbd` answered. The property that means the launcher is
actually up is `sys.boot_completed`. Installing before it flips gives you a silent no-op or an
`INSTALL_FAILED_*`, so `start` polls for the property rather than the device state.

If a boot hangs or the device comes up wedged, cold-boot it:

```bash
npm run android:emu -- start --cold
```

### `adb reverse`, and why it is the default here

The emulator does not share the host's loopback: `localhost` inside the emulator is the emulator.
There are two ways to reach the host, and they are not equivalent.

- **`adb reverse` (what `start` does).** Forwards the emulator's `localhost:8081` and
  `localhost:<daemon>` to the host's. The app keeps using its ordinary `localhost` addresses, so
  **the same JS bundle works unchanged** and you can point the emulator at a Metro and daemon that
  are already running. Nothing to rebuild.
- **`10.0.2.2` (the AVD's host alias).** Requires `REACT_NATIVE_PACKAGER_HOSTNAME` and
  `EXPO_PUBLIC_LOCAL_DAEMON` to be set at build time, because both are inlined into the JS bundle.
  Changing either one therefore needs a fresh bundle. Use it when `adb reverse` misbehaves, or for
  the worktree-daemon flow below.

`adb reverse` does not survive an emulator reboot or an `adb kill-server`. Re-apply it with
`npm run android:emu -- reverse` rather than rebuilding anything.

## What reloads, and what does not

This is the question that wastes the most time, because the answer depends entirely on **where** the
change is. Metro's Fast Refresh is not a general "picks up changes" mechanism.

| Change                                                              | What it takes                                      |
| ------------------------------------------------------------------- | -------------------------------------------------- |
| `packages/app/src/**` (components, hooks, screens)                  | Nothing. Fast Refresh applies it on save           |
| `packages/protocol`, `packages/client`, `packages/highlight`        | Rebuild the package **and restart Metro**          |
| `app.config.js`, a config plugin, a native dependency, a permission | `expo prebuild` + a full rebuild and reinstall     |
| `EXPO_PUBLIC_*` values                                              | Rebuild the bundle; `npx expo start -c` to be safe |

> **Metro snapshots its file map at startup.** `@otto-code/protocol`, `@otto-code/client` and
> `@otto-code/highlight` resolve through each package's compiled `dist`. A Metro that started while
> one of those was stale or missing keeps failing with `Unable to resolve @otto-code/...` for the
> whole session, **even after the watcher rebuilds it**. Restarting Metro is the fix, not another
> rebuild. `scripts/ensure-app-deps.mjs` builds them before Metro starts for exactly this reason,
> and skips the work when every `dist` is newer than its sources.

So if you changed daemon-facing protocol or client code and the emulator seems to be ignoring you,
you are almost certainly right that it is stale. Restart Metro.

## Troubleshooting

| Symptom                                                      | Cause and fix                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Unable to resolve @otto-code/<pkg>` that survives a rebuild | Metro's startup file map is stale. Restart Metro; see above                                                                          |
| App loads, then cannot reach the daemon                      | `adb reverse` was lost (emulator reboot, `adb kill-server`). Run `npm run android:emu -- reverse`                                    |
| `Failed to connect to /<lan-ip>:8081`                        | Expo baked a LAN IP into the bundle. Either use `adb reverse`, or rebuild with `REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2`             |
| App connects to the wrong Otto                               | `EXPO_PUBLIC_LOCAL_DAEMON` is unset, so the client defaults to `localhost:6868`, the **installed** app. Set it, or reverse that port |
| Screenshot file will not open                                | Something captured `exec-out screencap` through a shell. Use `npm run android:emu -- shot`; see the multi-display note below         |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE`                         | A build with a different signing key is installed. `adb uninstall me.ottocode.mobile.debug` first                                    |
| Emulator boots to a black screen                             | Try `--cold`. If it persists, the GPU mode is suspect: `emulator @<avd> -gpu swiftshader_indirect`                                   |
| Gradle fails on a Java class version                         | Wrong JDK. `npm run android:emu -- doctor` reports the major version                                                                 |

> **Screenshots and multi-display AVDs.** `adb exec-out screencap -p` prepends a
> `Multiple displays were found` warning to **stdout** on any AVD with more than one display (the
> Resizable device is one). The PNG arrives with a few hundred bytes of English before its magic
> number and no viewer will open it. `npm run android:emu -- shot` captures on the device and pulls
> the file instead, which cannot hit this.

## Local build + install

From repo root:

```bash
npm run android:development    # Debug build
npm run android:production     # Release build
npm run android:clear          # Remove generated Android project
```

For a production-ID release APK that local Android profiling tools can attach to:

```bash
OTTO_PROFILE_BUILD=1 npm run android:production
```

This keeps the `me.ottocode.mobile` package id, release Hermes bundle, and release optimizations. It
adds `<profileable android:shell="true" />` and enables local Android trace markers for workspace
mounts and daemon WebSocket traffic. The markers contain message types and sizes, never payload
contents, and emit only while a system trace records the app
(`perfetto -a me.ottocode.mobile ...`).

### Profiling a native-heap leak on a physical device

`npm run android:production` signs `release` with the **debug** keystore, so the APK will not
install over a sideloaded Otto. To profile the app a user actually has installed, drive gradle
directly with the repo keystore injected, exactly as `.github/workflows/android-apk-release.yml`
does. A signature mismatch is refused by Android rather than destructive, so attempting the install
is safe; only uninstalling first would lose data.

```bash
cd packages/app
OTTO_PROFILE_BUILD=1 APP_VARIANT=production   npx expo prebuild --platform android --clean --non-interactive
grep -q profileable android/app/src/main/AndroidManifest.xml || exit 1   # assert, do not assume

cd android
./gradlew :app:assembleRelease --no-parallel --max-workers=1   -PreactNativeArchitectures=arm64-v8a   -x lint -x lintVitalAnalyzeRelease -x lintVitalRelease   -x generateReleaseLintModel -x generateReleaseLintVitalModel   "-Pandroid.injected.signing.store.file=$(cygpath -m ../credentials/android/keystore.jks)"   "-Pandroid.injected.signing.store.password=..."   "-Pandroid.injected.signing.key.alias=..."   "-Pandroid.injected.signing.key.password=..."
```

Credentials come from `packages/app/credentials.json`. Restricting to `arm64-v8a` roughly halves
the build; it was 18 minutes cold, 10 to 12 warm.

Then capture. `heapprofd` works on a **profileable** app on a user build, which is the whole reason
for `OTTO_PROFILE_BUILD`:

```bash
adb push heapprofd.cfg /data/local/tmp/heapprofd.cfg
adb shell 'cat /data/local/tmp/heapprofd.cfg | perfetto --txt -c - -o /data/misc/perfetto-traces/heap.pftrace'
adb pull /data/misc/perfetto-traces/heap.pftrace
```

Analyse offline with `trace_processor_shell` from
[perfetto releases](https://github.com/google/perfetto/releases) (`windows-amd64.zip`). Net growth
by owning callstack, which is the query that attributes a leak:

```sql
create perfetto table cs_net as
  select callsite_id as cs, sum(size) as net from heap_profile_allocation
  where heap_name = 'libc.malloc' group by callsite_id having net > 0;
-- then walk stack_profile_callsite.parent_id recursively and join
-- stack_profile_frame / stack_profile_mapping to name each frame
```

#### Traps that cost real time here

- **`dumpsys meminfo` forces a GC in the target process**, so it perturbs exactly what it measures.
  A run of `Explicit` GCs in logcat can be your own sampling. Use `VmRSS` from
  `/proc/<pid>/status` for slope measurements; it is non-perturbing.
- **Hermes frames symbolicate as empty names** in heapprofd. A native profile can prove that JS
  drives a per-frame commit but not which component does. Budget for elimination, or bring a
  React-level profiler.
- **Git Bash rewrites device paths.** `adb push x /data/local/tmp` becomes
  `C:/Program Files/Git/data/local/tmp`. Set `MSYS_NO_PATHCONV=1`, and then convert the _local_
  side yourself with `cygpath -w`, because that variable disables both directions.
- **`cmd //c "gradlew.bat ..."` does not resolve** from Git Bash. Use the POSIX `./gradlew`, which
  works fine on Windows.
- **Foreground versus background matters.** A render-driven leak stops dead when the app is
  backgrounded. Record `topResumedActivity` alongside RSS or a background sample will read as a
  fixed leak.

Past investigations using this workflow are recorded as Otto Knowledge findings.

Or from `packages/app`:

```bash
# Debug
npx cross-env APP_VARIANT=development expo prebuild --platform android --clean --non-interactive
npx cross-env APP_VARIANT=development expo run:android --variant=debug

# Release
npx cross-env APP_VARIANT=production expo prebuild --platform android --clean --non-interactive
npx cross-env APP_VARIANT=production expo run:android --variant=release

# Clear generated Android project
rm -rf android
```

## Running on an emulator against a worktree daemon

`npm run android` builds and installs the dev client, but two connections have to reach your Mac from inside the emulator - Metro (the JS bundle) and the Otto daemon - and **the emulator does not share the host's loopback**: `localhost` inside the emulator is the emulator itself. Reach the host at `10.0.2.2` (the standard AVD's host alias) for both:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2 \
  EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:$OTTO_SERVICE_DAEMON_PORT \
  npm run android
```

- **`REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2`** - without it, Expo bakes your Mac's LAN IP into the dev client's Metro URL, which the emulator can't route to, and the app dies with `Failed to connect to /<lan-ip>:8081` before any JS loads.
- **`EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:<port>`** - the client's daemon endpoint (`packages/app/src/runtime/host-runtime.ts`); when unset it defaults to `localhost:6868`, the production daemon. Use `$OTTO_SERVICE_DAEMON_PORT` for a worktree daemon running as a Otto service, or `6768` for a standalone `npm run dev:server`. It is inlined into the JS bundle at Metro bundle time, so set it on the build command and clear the Metro cache (`npx expo start -c`) if a change doesn't take.

**Alternative - `adb reverse` + `localhost`** (if `10.0.2.2` misbehaves):

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:$OTTO_SERVICE_DAEMON_PORT tcp:$OTTO_SERVICE_DAEMON_PORT
REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
  EXPO_PUBLIC_LOCAL_DAEMON=localhost:$OTTO_SERVICE_DAEMON_PORT \
  npm run android
```

This is the Android counterpart of the iOS local-simulator flow in [development.md](development.md): on iOS the simulator shares the Mac's loopback so `localhost:<port>` works directly; on Android you need `10.0.2.2` or `adb reverse`.

## F-Droid / source-only Android builds

F-Droid builds should set `OTTO_FDROID_BUILD=1` when running Expo prebuild:

```bash
cd packages/app
OTTO_FDROID_BUILD=1 APP_VARIANT=production npx expo prebuild --platform android --clean --non-interactive
cd android
OTTO_FDROID_BUILD=1 ./gradlew assembleRelease --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
```

The flag must be present for both prebuild and Gradle because Gradle starts Metro for the release bundle. Keep the source build serial and daemon-free as shown above: compiling every Expo module can exhaust memory when Gradle workers run in parallel. The profile enables source-built Expo modules, excludes the proprietary camera, Firebase notification, and Expo development-client native modules, disables Gradle dependency metadata, and substitutes JavaScript stubs for camera and notifications. The resulting app supports direct and pasted-link pairing but not QR scanning or push notifications.

For a single-ABI APK, pass React Native's architecture property to Gradle:

```bash
OTTO_FDROID_BUILD=1 ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
```

Supported values are `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`. The F-Droid profile filters native libraries to that ABI and changes the APK version code to `baseVersionCode * 10 + abiSuffix`, where the suffixes are ordered `1` through `4` in that same sequence. F-Droid metadata should use four build blocks with `VercodeOperation` entries `10 * %c + 1` through `10 * %c + 4` and pass the matching `reactNativeArchitectures` value in each build command. Builds without a single architecture keep the base version code.

Keep the excluded npm packages installed. Normal builds use them, while the F-Droid profile removes only their Android native modules and config plugins. Otto always applies `expo-gradle-jvmargs` with `-Xmx4096m` and `-XX:MaxMetaspaceSize=1024m` so local Expo prebuilds have enough Gradle heap whether they use precompiled AARs or source-built Expo modules.

The EAS `production-apk` profile uses the large Android resource class. Release builds compile the native ABIs and run Hermes bundling in the same Gradle invocation; the default worker can exhaust its remaining memory and kill Hermes with exit code 137 even when Gradle's own heap is correctly sized.

The GitHub runner build (`.github/workflows/android-apk-release.yml`) cannot be resized, so it splits the work instead: `:app:createBundleReleaseJsAndAssets` runs in its own Gradle invocation first, the daemon is stopped, and only then does `:app:assembleRelease` run, finding the bundle task `UP-TO-DATE`. Inside a single `assembleRelease` the Metro, `hermesc`, and `compose-source-maps.js` chain runs last, after the Gradle and Kotlin daemons have grown their heaps compiling every native module. That combined peak is what produces the bare "The operation was canceled." failure on a hosted runner (v0.8.1 at a 12G swapfile, v0.9.0 at 24G): the box thrashes, the runner misses its heartbeat, and the service cancels the job with no annotation. Both Gradle steps print `free -m` samples every fifteen seconds into the step log so the next such failure carries numbers. The first sampled run (the `android-v0.9.0` retry, 2026-09-04) put the peak at about 40 GB: from two minutes after Metro finished until the bundle task ended eighteen minutes later, RAM sat at 15.6 GB used with the whole 24 GB swapfile consumed and under 400 MB available. That is `hermesc` plus `compose-source-maps.js` on a 6389-module bundle, and it is why no swap size survived while the Gradle and Kotlin daemons were also resident. The split is therefore necessary but not generous. The next lever, if the bundle keeps growing, is the Hermes pass itself: dropping `-output-source-map` from `hermesFlags` (a product call, since it removes release symbolication) or reducing what Metro bundles.

### React version lockstep

Keep `react` and `react-dom` pinned to the React version embedded by the current `react-native` release. React Native `0.81.x` embeds `react-native-renderer` `19.1.0`, so `packages/app` must use React `19.1.0`. Bumping React to a newer patch can build successfully but crash at JS startup on Android with `Incompatible React versions`, leaving the app on the native splash screen.

### Windows local builds: `Unable to resolve module ./index.ts`

On Windows, the `:app:createBundleReleaseJsAndAssets` step fails with
`Unable to resolve module ./index.ts from <monorepo root>`. Cause: the React
Native gradle plugin's `Os.cliPath()` rewrites `--entry-file` to a path relative
to the app dir **only on Windows** (to dodge Gradle's space-in-path issues), so
Expo's `export:embed` receives a bare `index.ts`. Expo forwards that relative
entry to Metro unchanged, and in this npm-workspace monorepo Metro resolves it
against the workspace server root instead of `packages/app`. Linux/macOS (EAS)
get an absolute path from `cliPath()`, so cloud builds never hit this.

Fix (in tree): [`plugins/with-metro-embed-cli.js`](../packages/app/plugins/with-metro-embed-cli.js)
points the gradle plugin's `cliFile` at
[`scripts/metro-embed-cli.cjs`](../packages/app/scripts/metro-embed-cli.cjs), a
wrapper that re-absolutizes `--entry-file` before delegating to `@expo/cli`. The
plugin is gated to `win32` prebuilds, so EAS output is byte-for-byte unaffected.
Note: a `metro.config.js` is **not** a viable fix here - its mere presence makes
Expo take the `mergeConfig` path, which breaks the `.js`→`.ts` source-extension
substitution that workspace packages (e.g. `@otto-code/relay`) rely on.

## Screenshots

```bash
adb exec-out screencap -p > screenshot.png
```

## Cloud build + submit (EAS)

> **Fork reality:** on this fork the only thing a tag push triggers on the mobile side is
> `.github/workflows/android-apk-release.yml`, which builds an APK on the fork's own EAS project
> (`otto-code` Expo org) and attaches it to the GitHub Release. There are **no store
> submissions** - no Play Console listing, no Apple account, no EAS GitHub-app store pipeline.
> The upstream description below is kept as reference for if/when store accounts exist; see
> [fork-release-guide.md](fork-release-guide.md).

Upstream's stable tag pushes like `v0.1.0` trigger:

- The EAS GitHub app on Expo servers (iOS + Android production builds + store submit). There is no workflow file in this repo for it, and it is not wired up on this fork.
- `.github/workflows/android-apk-release.yml` on GitHub Actions (APK asset on GitHub Release) - the only part active on this fork.

Upstream: iOS auto-submits to App Store review via a Fastlane lane after EAS uploads to TestFlight, and Android auto-submits to the Play Store via EAS-managed credentials. Neither happens on this fork.

Beta tags like `v0.1.1-beta.1` only trigger the GitHub APK workflow. They publish a GitHub prerelease APK for testing and do not submit to the stores.

`android-v*` tags also trigger only the GitHub APK workflow - useful when you want to ship an APK without going through stores. The GitHub APK workflow supports `workflow_dispatch` with an existing `tag` input so you can rebuild without cutting a new tag.

### Useful commands

```bash
cd packages/app

# Recent builds
npx eas build:list --limit 10 --non-interactive --json | jq '.[] | {platform, status, appVersion, gitCommitHash}'

# Inspect a build (the printed `Logs` URL opens the build's Expo dashboard page,
# which has a Submissions section showing the auto-submit to the Play Store).
npx eas build:view <build-id>
```

The Play Console (Internal testing → Production tracks) is the final confirmation that the binary reached the store.

See [docs/release.md](release.md) for the full mobile-build babysitting flow.
