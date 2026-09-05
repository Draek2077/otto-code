# macOS and iOS build and test runbook

Use this runbook to bring a fresh Mac from a clone of this repository to working Otto desktop and
iOS builds. It deliberately separates local testing from distributable releases. A local iOS
simulator build and an unsigned macOS package are available now. TestFlight and a signed, notarized
macOS release require the Apple account work in [Distribution enablement](#distribution-enablement).

This is an engineering runbook. It does not authorize a product release or publishing artifacts.

## What is available today

| Goal                                | Works without Apple Developer Program membership | Output                                                 | Important limit                                                                |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| macOS desktop development           | Yes                                              | Electron window with Metro and a checkout-local daemon | Not a packaged app                                                             |
| macOS package smoke test            | Yes                                              | Unsigned DMG and ZIP for the Mac's architecture        | Direct download only. Gatekeeper intervention is expected.                     |
| iOS Simulator development           | Yes                                              | Debug development client installed in Simulator        | Simulator only.                                                                |
| iPhone/iPad development build       | Yes, with a signing Apple Account in Xcode       | Debug development client installed by Xcode            | The device must be connected, trusted, and unlocked.                           |
| TestFlight distribution             | No                                               | EAS production build uploaded to App Store Connect     | This repository is currently gated off until Apple credentials are configured. |
| Signed/notarized macOS distribution | No                                               | DMG, ZIP, update manifest, and automatic updates       | This repository is currently gated off until Apple credentials are configured. |

The macOS package is a real desktop build, but Zoom Recorder is intentionally unavailable there.
Its frozen native helper currently ships only on Windows x64 and Linux x64.

## 1. Prepare the Mac

1. Install the current full Xcode from the Mac App Store, open it once, and install the iOS
   simulator runtime that will be used for testing. Command Line Tools alone are not enough.
2. Accept Xcode's license and select it as the active developer directory:

   ```bash
   sudo xcodebuild -license accept
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   xcodebuild -version
   xcrun simctl list devices available
   ```

3. Install Git and a Node version manager. This checkout pins Node in [`.tool-versions`](../.tool-versions):
   Node `24.18.1`. `asdf install` is suitable if using asdf. Confirm the active runtime before
   installing dependencies:

   ```bash
   node --version # expected: v24.18.1
   npm --version
   git --version
   ```

4. For an iPhone or iPad, connect it by USB, unlock it, select **Trust** when prompted, and enable
   Developer Mode if iOS asks. In Xcode, sign in through **Xcode > Settings > Accounts** with the
   Apple Account that will sign device builds. A free Apple Account is enough for this local path.

   Before attempting a physical-device build, verify that Xcode really has a token, not merely a
   listed account:

   ```bash
   defaults read com.apple.dt.Xcode DVTDeveloperAccountManagerAppleIDLists
   security find-generic-password -s "Xcode-Token"
   ```

   If the second command fails, remove and re-add the Apple Account in Xcode. The build log can
   misleadingly say `No Accounts` or blame the provisioning certificate when the missing keychain
   token is the actual problem.

5. Clone and install exactly what the lockfile specifies. Do not substitute `npm install` for a
   clean bootstrap.

   ```bash
   git clone https://github.com/Draek2077/otto-code.git
   cd otto-code
   npm ci
   ```

   `npm ci` runs the repository's post-install patching and Git hook setup. Leave the working tree
   alone after this step; native prebuild can generate `packages/app/ios/` and it must not be
   casually deleted or committed as unrelated work.

## 2. Run Otto desktop in development

This is the first smoke test. It starts a dedicated Electron window, Metro, and the checkout's
dev daemon in the correct isolated lane. It never touches the installed Otto daemon on port `6868`.

```bash
npm run dev:desktop
```

The command builds app dependencies before launch, selects a Metro port from `8082` through `8089`,
uses a checkout-local Electron profile, and starts the dev daemon on `127.0.0.1:6788` with state in
`packages/desktop/.dev/otto-home`. Open a provider and create a workspace or use the welcome flow to
prove the renderer and daemon communicate.

Use a separate terminal for the focused browser-window check when needed:

```bash
npm run verify:electron-cdp --workspace=@otto-code/desktop
```

Do not start another daemon on `6868`. That port and `~/.otto` belong to the installed application.

## 3. Build an unsigned macOS package for local testing

First package the architecture of the Mac that will run it. `uname -m` is `arm64` on Apple Silicon
and `x86_64` on an Intel Mac. The release pipeline builds both architectures independently on native
GitHub runners, so validate both there rather than relying on cross-architecture local execution.

Run the normal static checks before a package build:

```bash
npm run format
npm run lint
npm run typecheck
```

Then build an unsigned package. This is the exact local equivalent of the repository's unsigned macOS
CI job. The single quotes prevent the shell from expanding electron-builder's `${version}` and
`${arch}` placeholders.

```bash
npm run build:desktop -- \
  --publish never --mac --arm64 \
  '-c.mac.artifactName=Otto-${version}-${arch}-unsigned.${ext}' \
  -c.mac.hardenedRuntime=false \
  -c.mac.notarize=false \
  -c.directories.output=release-unsigned
```

Replace `--arm64` with `--x64` on Intel. The artifacts are under
`packages/desktop/release-unsigned/` and include a DMG and ZIP. Mount the DMG, drag Otto to
Applications, then launch it. On a quarantined unsigned artifact, use Finder's **Control-click >
Open** or, only for the app being tested, remove its quarantine attribute:

```bash
xattr -dr com.apple.quarantine /Applications/Otto.app
```

An unsigned macOS package has no automatic update manifest by design. It is a direct-download test
artifact, not a candidate for the update channel.

## 4. Build and run iOS locally

### Simulator

Keep the server separate from the native app command so its output remains visible:

```bash
# Terminal A, from the repository root
npm run dev:server

# Terminal B, from the repository root
cd packages/app
npm --prefix ../.. run build:client
APP_VARIANT=development npx expo prebuild --platform ios
APP_VARIANT=development npx expo run:ios
```

Choose the installed Simulator when Expo asks. `expo run:ios` compiles, installs the development
client, and starts Metro. In Otto's welcome screen, use Direct Connection to `127.0.0.1:6788`.
That is the dev daemon, not the installed application's `6868` port.

`APP_VARIANT=development` is required. Without it, `app.config.js` defaults to production and builds
the `me.ottocode.mobile` bundle identifier instead of the debug client's
`me.ottocode.mobile.debug`, which can collide with an App Store install.

Useful simulator evidence commands:

```bash
xcrun simctl io booted screenshot /tmp/otto-ios.png
xcrun simctl ui booted appearance dark
xcrun simctl ui booted appearance light
```

### Physical iPhone or iPad

First rebuild the native binary for every change under `packages/expo-two-way-audio/ios/` or for a
new Expo native module. Metro and EAS Update only deliver JavaScript, so a stale development client
cannot test new Swift or native code.

Use a LAN-listening dev daemon for a device. Only do this on a trusted network:

```bash
# Terminal A, from the repository root
OTTO_LISTEN=0.0.0.0:6788 npm run dev:server

# Terminal B, from the repository root
cd packages/app
npm --prefix ../.. run build:client
APP_VARIANT=development npx expo prebuild --platform ios
APP_VARIANT=development npx expo run:ios --device
```

Find the Mac's active LAN address, then enter that address and port `6788` with TLS disabled in
Otto's Direct Connection screen:

```bash
ipconfig getifaddr en0
```

If `en0` is not the active interface, obtain the Wi-Fi/Ethernet address from System Settings. Do
not expose this development daemon to the public internet. For ordinary local testing, a simulator
is simpler because `127.0.0.1:6788` needs no LAN routing.

If device code signing reports `No Accounts`, inspect the line immediately before the error for a
missing `Xcode-Token` and reauthenticate in Xcode. Do not switch an Xcode-managed profile to manual
signing to work around it.

## 5. Distribution enablement

Complete this once before expecting a signed macOS release or TestFlight build. An Apple Developer
Program membership is the shared prerequisite. It provides the Developer ID signing/notarization
path for macOS and the signing and TestFlight path for iOS. Apple documents the enrollment and
distribution choices at [Apple Developer Program](https://developer.apple.com/programs/) and
[beta testing and release distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

### Signed and notarized macOS desktop releases

1. Enroll the intended owner in the Apple Developer Program and record the ten-character Team ID.
2. Create and export the Developer ID Application signing certificate as a password-protected `.p12`.
   Store the encoded certificate and its password only in GitHub Actions secrets.
3. Create an app-specific password for the Apple Account used for notarization. Do not use the
   account's normal password. Apple requires an app-specific password for Apple-ID-based
   notarization with two-factor authentication.
4. Add these repository secrets. Their names are load-bearing because
   `.github/workflows/desktop-release.yml` maps them directly to electron-builder:

   | Secret                       | Value                                                                                       |
   | ---------------------------- | ------------------------------------------------------------------------------------------- |
   | `APPLE_CERTIFICATE`          | Exported Developer ID Application `.p12`, encoded for the electron-builder `CSC_LINK` value |
   | `APPLE_CERTIFICATE_PASSWORD` | Password chosen when exporting the `.p12`                                                   |
   | `APPLE_ID`                   | Apple Account email used for notarization                                                   |
   | `APPLE_PASSWORD`             | Apple app-specific password, not the normal Apple Account password                          |
   | `APPLE_TEAM_ID`              | Apple Developer Team ID                                                                     |

Once `APPLE_CERTIFICATE` exists, the `publish-macos` job runs for release tags and builds arm64 on
macOS 14 and x64 on macOS 15 Intel. It uploads signed, notarized DMG and ZIP assets plus the macOS
update manifest. Keep the unsigned path for ad hoc testing only.

### iOS TestFlight builds

1. In App Store Connect, create the app record for bundle identifier `me.ottocode.mobile`. Copy its
   numeric Apple ID from the app's General page, then replace the literal
   `REPLACE_WITH_ASC_APP_ID` in `packages/app/eas.json` at
   `submit.production.ios.ascAppId`.
2. Create an App Store Connect API key with the **Admin** role. Save the `.p8` contents immediately,
   then record its Key ID and Issuer ID.
3. Confirm this repository's Expo token remains present, then add these GitHub Actions secrets:

   | Secret                  | Value                                                  |
   | ----------------------- | ------------------------------------------------------ |
   | `EXPO_TOKEN`            | Token for the Otto Expo/EAS project                    |
   | `APPLE_TEAM_ID`         | The same Apple Developer Team ID used by macOS signing |
   | `ASC_API_KEY_P8`        | Entire contents of the App Store Connect `.p8` file    |
   | `ASC_API_KEY_ID`        | App Store Connect API key ID                           |
   | `ASC_API_KEY_ISSUER_ID` | App Store Connect API key issuer ID                    |

4. Bootstrap signing credentials once if EAS requests an interactive setup:

   ```bash
   cd packages/app
   npx eas credentials
   ```

   Select iOS and the `production` profile, authenticate to the Apple developer team, and let EAS
   create or import the distribution certificate and provisioning profile. Do not put those
   credentials in the repository.

After the App Store Connect ID and all secrets are in place, the repository's `iOS Release` workflow
is enabled. A `v*` or `ios-v*` tag builds the `production` EAS profile and submits it to App Store
Connect, where it becomes available for TestFlight internal testing. TestFlight tester assignment,
external beta review, and eventual App Store submission remain App Store Connect actions.

For a failed submit where the EAS build itself succeeded, rerun `iOS Release` with the existing EAS
`build_id`; that retries submission without consuming another build number. Observe the result with:

```bash
cd packages/app
npx eas build:list --platform ios --limit 5 --non-interactive --json
npx eas build:view <build-id>
```

## 6. Handoff checklist

- [ ] `npm ci` completes on the Mac with Node `24.18.1`.
- [ ] `npm run dev:desktop` opens Otto and talks to the checkout-local dev daemon on `6788`.
- [ ] An unsigned native-architecture DMG launches after the expected Gatekeeper step.
- [ ] An iOS Simulator development client builds, opens, and connects to `127.0.0.1:6788`.
- [ ] If a physical device is in scope, it installs the development client and reaches the LAN dev daemon.
- [ ] If distribution is in scope, the Apple Developer membership, App Store Connect record, EAS credentials, and required GitHub secrets are all configured before the next release tag.

Related repository guidance: [development](development.md), [mobile testing](mobile-testing.md),
[release](release.md), and [fork release guide](fork-release-guide.md).
