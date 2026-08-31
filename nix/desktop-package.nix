{
  lib,
  stdenv,
  buildNpmPackage,
  nodejs_24,
  python3,
  makeWrapper,
  autoPatchelfHook,
  copyDesktopItems,
  makeDesktopItem,
  electron,
  libuv,
  buildVersion,
  # Reuse the daemon's prebuilt npm-deps FOD. Same lockfile, same content -
  # without this, the desktop drv produces a separately-named store path
  # (`otto-desktop-<v>-npm-deps`) and refetches the entire registry. Override
  # the upstream hash via `otto.override { npmDepsHash = "..."; }`.
  otto,
}:
buildNpmPackage {
  pname = "otto-desktop";
  version = (builtins.fromJSON (builtins.readFile ../package.json)).version;

  src = lib.cleanSourceWith {
    src = ./..;
    filter = path: type: let
      baseName = builtins.baseNameOf path;
      relPath = lib.removePrefix (toString ./..) path;
    in
      # Exclude mobile-only platform code (we only need the web/electron build)
      !(lib.hasPrefix "/packages/app/android" relPath)
      && !(lib.hasPrefix "/packages/app/ios" relPath)
      # Website is unrelated to the desktop app
      && !(lib.hasPrefix "/packages/website" relPath)
      # Documentation, CI definitions and agent/editor configuration. None of
      # these reach the build, but every one of them is part of `src`, so a
      # docs-only or workflow-only commit currently invalidates the whole
      # desktop derivation and pays for a full Expo export to produce a
      # byte-identical result.
      && !(lib.hasPrefix "/docs" relPath)
      && !(lib.hasPrefix "/.github" relPath)
      && !(lib.hasPrefix "/.agents" relPath)
      && !(lib.hasPrefix "/.claude" relPath)
      && !(lib.hasPrefix "/.codex" relPath)
      && !(lib.hasPrefix "/docker" relPath)
      # Top-level prose only (README, CHANGELOG, AGENTS...). Deeper markdown is
      # not necessarily documentation: skills/*/SKILL.md is a runtime file the
      # installPhase copies into the output.
      && builtins.match "/[^/]+\\.md" relPath == null
      # Test fixtures and build artifacts
      && !(lib.hasSuffix ".test.ts" baseName)
      && !(lib.hasSuffix ".e2e.test.ts" baseName)
      && baseName != "node_modules"
      && baseName != ".git"
      && baseName != ".otto"
      && baseName != ".DS_Store"
      && baseName != "release";
  };

  nodejs = nodejs_24;
  inherit (otto) npmDeps;

  # Prevent onnxruntime-node's install script from running during automatic
  # npm rebuild. We manually rebuild only node-pty in buildPhase.
  npmRebuildFlags = ["--ignore-scripts"];

  nativeBuildInputs =
    [
      python3 # for node-gyp (node-pty)
    ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [
      autoPatchelfHook
      makeWrapper
      copyDesktopItems
    ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    libuv
    stdenv.cc.cc.lib # libstdc++ for sherpa-onnx prebuilt binaries
  ];

  dontNpmBuild = true;

  env = {
    EXPO_NO_TELEMETRY = "1";
    # Expo's web build pulls in some pre-bundled assets; ensure it doesn't try
    # to phone home during the build.
    CI = "1";
  };

  buildPhase = ''
    runHook preBuild

    # Native deps (terminal emulation; libuv-linked on Linux)
    npm rebuild node-pty

    # Server workspaces (highlight + relay + protocol + client + server + cli)
    npm run build:server

    # App workspace deps not covered by build:server
    npm run build --workspace=@otto-code/expo-two-way-audio

    # Expo web export for the Electron renderer
    ( cd packages/app && OTTO_WEB_PLATFORM=electron npx expo export --platform web )

    # Desktop main process
    npm run build:main --workspace=@otto-code/desktop

    ${lib.optionalString stdenv.hostPlatform.isDarwin ''
      # Let electron-builder create the native bundle layout (including helper
      # app names and bundle identifiers), but source Electron from nixpkgs
      # instead of downloading a release at build time. electron-builder edits
      # the copied helper plists, so stage a writable distribution rather than
      # pointing it directly at the read-only Nix store.
      electron_dist="$NIX_BUILD_TOP/electron-dist"
      mkdir -p "$electron_dist"
      cp -R ${electron}/Applications/Electron.app "$electron_dist/"
      chmod -R u+w "$electron_dist/Electron.app"
      (
        cd packages/desktop
        # The Nix output is not a distributable DMG, so leave it unsigned and
        # disable the hardened runtime that requires a matching signature.
        CSC_IDENTITY_AUTO_DISCOVERY=false \
          ../../node_modules/.bin/electron-builder \
            --config electron-builder.yml \
            --dir \
            --mac \
            --publish never \
            --config.electronDist="$electron_dist" \
            --config.buildVersion=${lib.escapeShellArg buildVersion} \
            --config.mac.identity=null \
            --config.mac.hardenedRuntime=false \
            --config.mac.notarize=false
      )
    ''}

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin

    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      mkdir -p $out/share/otto-desktop

      # Materialize only the desktop and daemon runtime graphs. Copying the
      # complete monorepo used to ship every build-time dependency (including
      # Electron, Expo tooling, and cross-platform builder binaries), making the
      # desktop output larger than 2 GiB.
      OTTO_TRACE_DESKTOP=1 node scripts/trace-daemon.mjs > desktop-files.txt

      while IFS= read -r path; do
        [ -z "$path" ] && continue
        mkdir -p "$out/share/otto-desktop/$(dirname "$path")"
        cp -a "$path" "$out/share/otto-desktop/$path"
      done < desktop-files.txt

      # Keep the same unpackaged monorepo layout expected by main.js.
      cp package.json $out/share/otto-desktop/
      mkdir -p $out/share/otto-desktop/packages/app
      cp -a packages/app/dist $out/share/otto-desktop/packages/app/

      # Wake-word models are data, so the runtime trace never reaches them.
      mkdir -p $out/share/otto-desktop/packages/expo-two-way-audio/models
      cp -a packages/expo-two-way-audio/models/wake-word $out/share/otto-desktop/packages/expo-two-way-audio/models/
      install -Dm644 vendor/agent-flow/LICENSE \
        $out/share/otto-desktop/packages/expo-two-way-audio/models/wake-word/LICENSE-APACHE-2.0.txt

      for runtime_path in \
        packages/desktop/dist/main.js \
        packages/desktop/dist/preload.js \
        packages/desktop/dist/features/browser-keyboard/guest-preload.js \
        packages/desktop/package.json; do
        if [ ! -e "$out/share/otto-desktop/$runtime_path" ]; then
          echo "desktop runtime trace omitted $runtime_path" >&2
          exit 1
        fi
      done

      if [ -e $out/share/otto-desktop/node_modules/electron ]; then
        echo "desktop runtime trace included npm Electron" >&2
        exit 1
      fi

      # Hicolor icon for desktop environments
      install -Dm644 packages/desktop/assets/icon.png \
        $out/share/icons/hicolor/512x512/apps/otto-desktop.png

      # Electron derives Wayland's toplevel app_id from the package name in the
      # app root it launches. Point it at a one-file app named "otto-desktop"
      # so shells can match the window to the desktop entry and hicolor icon.
      mkdir -p $out/share/otto-desktop/electron-app
      printf '%s\n' "{ \"name\": \"otto-desktop\", \"version\": \"$version\", \"main\": \"index.js\" }" \
        > $out/share/otto-desktop/electron-app/package.json
      printf '%s\n' 'require("../packages/desktop/dist/main.js");' \
        > $out/share/otto-desktop/electron-app/index.js

      # Chromium's setuid sandbox cannot live in the immutable Nix store.
      makeWrapper ${electron}/bin/electron $out/bin/otto-desktop \
        --add-flags "$out/share/otto-desktop/electron-app" \
        --add-flags "--no-sandbox" \
        --add-flags "--class=otto-desktop" \
        --set EXPO_DEV_URL "otto://app/" \
        --set CHROME_DESKTOP "otto-desktop.desktop" \
        --set OTTO_WAKE_WORD_MODEL_DIR "$out/share/otto-desktop/packages/expo-two-way-audio/models/wake-word"

      copyDesktopItems
    ''}

    ${lib.optionalString stdenv.hostPlatform.isDarwin ''
      app="$(find packages/desktop/release -maxdepth 3 -type d -name Otto.app -print -quit)"
      if [ -z "$app" ]; then
        echo "electron-builder did not produce Otto.app" >&2
        exit 1
      fi
      mkdir -p "$out/Applications"
      cp -R "$app" "$out/Applications/Otto.app"
      ln -s ../Applications/Otto.app/Contents/MacOS/Otto "$out/bin/otto-desktop"
    ''}

    runHook postInstall
  '';

  desktopItems = lib.optionals stdenv.hostPlatform.isLinux [
    (makeDesktopItem {
      name = "otto-desktop";
      desktopName = "Otto";
      genericName = "AI Coding Agents";
      comment = "Self-hosted daemon for AI coding agents";
      exec = "otto-desktop";
      icon = "otto-desktop";
      categories = ["Development"];
      startupWMClass = "otto-desktop";
    })
    # Hidden alias entry. Which of the two names Electron ends up publishing as
    # the Wayland app_id depends on the Electron version: 41 uses the app-root
    # package.json `name` ("otto-desktop"), 38 uses the runtime app name that
    # main.ts sets ("Otto"). Ship a NoDisplay entry for the second spelling so
    # the icon resolves either way without a duplicate launcher item.
    (makeDesktopItem {
      name = "Otto";
      desktopName = "Otto";
      genericName = "AI Coding Agents";
      comment = "Self-hosted daemon for AI coding agents";
      exec = "otto-desktop";
      icon = "otto-desktop";
      categories = [ "Development" ];
      startupWMClass = "Otto";
      noDisplay = true;
    })
  ];

  meta = {
    description = "Otto desktop app (Electron wrapper)";
    homepage = "https://github.com/Draek2077/otto-code";
    license = lib.licenses.agpl3Plus;
    mainProgram = "otto-desktop";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
