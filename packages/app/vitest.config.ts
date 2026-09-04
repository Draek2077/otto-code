import { defineConfig, configDefaults } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "path";
import fs from "fs";
import os from "os";

// `npm run browsers:install` (scripts/ensure-browsers.mjs) fills a repo-local
// cache unless PLAYWRIGHT_BROWSERS_PATH says otherwise. Playwright's own
// registry has to be told the same place, or a plain `vitest run` installs a
// browser it never finds and dies with "Executable doesn't exist" under the
// user's platform cache - which is exactly how CI's app-tests job failed.
const repoLocalBrowserCache = path.resolve(__dirname, "../../.tmp/otto-playwright-browsers");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() && fs.existsSync(repoLocalBrowserCache)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = repoLocalBrowserCache;
}

const appNodeModules = path.resolve(__dirname, "node_modules");
const rootNodeModules = path.resolve(__dirname, "../../node_modules");
const resolvePackageEntry = (packageName: string) => {
  const appPackagePath = path.resolve(appNodeModules, packageName);
  return fs.existsSync(appPackagePath)
    ? appPackagePath
    : path.resolve(rootNodeModules, packageName);
};

/**
 * Where Playwright keeps downloaded browsers, per its own platform rules.
 * `PLAYWRIGHT_BROWSERS_PATH=0` means "next to the package", which we do not
 * try to second-guess: returning null there leaves the provider's default.
 */
function playwrightCacheRoot(): string | null {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (configured) {
    return configured === "0" ? null : configured;
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData ? path.join(localAppData, "ms-playwright") : null;
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  }
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

// The launcher binary inside one `<cache>/<browser>-<revision>` directory, whatever
// the platform names it. Scanned rather than hardcoded because the inner folder is
// arch-suffixed (`chrome-headless-shell-win64`, `-linux64`, `-mac-arm64`, ...) and a
// partially downloaded revision can leave the folder present but the binary missing.
function findBrowserBinary(browserDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(browserDir);
  } catch {
    return null;
  }
  const names =
    process.platform === "win32"
      ? ["chrome-headless-shell.exe", "chrome.exe"]
      : ["chrome-headless-shell", "chrome"];
  for (const entry of entries) {
    const candidates = names.map((name) => path.join(browserDir, entry, name));
    // macOS ships the full browser inside an app bundle.
    candidates.push(path.join(browserDir, entry, "Chromium.app", "Contents", "MacOS", "Chromium"));
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * The Chromium the browser project should launch, or null to let Playwright pick.
 *
 * `@vitest/browser-playwright` resolves the executable from the revision pinned in
 * `playwright-core/browsers.json` and demands exactly that build. CI installs it, so
 * this returns null there and nothing changes. A developer machine whose
 * `ms-playwright` cache was filled by the e2e harness holds other revisions instead,
 * and the run dies with "Executable doesn't exist ... chromium_headless_shell-<rev>"
 * only after every other project has already passed, which reads as a late
 * regression when it is a missing download. Installing the pinned revision is a
 * large fetch for a build nothing else here uses, so fall back to the newest cached
 * one instead. `VITEST_BROWSER_EXECUTABLE` overrides both.
 */
function resolveBrowserExecutablePath(): string | null {
  const override = process.env.VITEST_BROWSER_EXECUTABLE?.trim();
  if (override) {
    return override;
  }

  const cacheRoot = playwrightCacheRoot();
  if (!cacheRoot) {
    return null;
  }

  let pinnedRevision: string | null = null;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(resolvePackageEntry("playwright-core"), "browsers.json"), "utf8"),
    ) as { browsers?: Array<{ name?: string; revision?: string }> };
    pinnedRevision =
      manifest.browsers?.find((browser) => browser.name === "chromium-headless-shell")?.revision ??
      null;
  } catch {
    pinnedRevision = null;
  }

  // The pinned build is present (the CI case). Leave the provider alone so the
  // version it was tested against is the version that runs.
  if (
    pinnedRevision &&
    findBrowserBinary(path.join(cacheRoot, `chromium_headless_shell-${pinnedRevision}`))
  ) {
    return null;
  }

  let cached: string[];
  try {
    cached = fs.readdirSync(cacheRoot);
  } catch {
    return null;
  }
  const revisionOf = (dir: string) => Number(dir.slice(dir.lastIndexOf("-") + 1)) || 0;
  // Headless shell first: it is what this project asks for. Full Chromium is the
  // fallback, and newest revision wins within each.
  for (const prefix of ["chromium_headless_shell-", "chromium-"]) {
    const matches = cached
      .filter((dir) => dir.startsWith(prefix) && /-\d+$/.test(dir))
      .sort((a, b) => revisionOf(b) - revisionOf(a));
    for (const dir of matches) {
      const binary = findBrowserBinary(path.join(cacheRoot, dir));
      if (binary) {
        return binary;
      }
    }
  }
  return null;
}

const browserExecutablePath = resolveBrowserExecutablePath();

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**", "**/.tmp/**"],
    /**
     * Several suites do `await import(...)` inside `beforeAll` so they can install globals
     * before a module graph is evaluated. Transforming those graphs measures 7-10s here, which
     * sits right on the 10s default - so the same test passes alone and times out when the run
     * is loaded, and a slower CI machine fails what a developer's machine does not. That
     * asymmetry reads as flakiness, so the budget is raised well clear of the real cost rather
     * than nudged past it. These are ceilings for pathological runs, not expected durations; a
     * genuine hang still fails, just later.
     */
    hookTimeout: 60_000,
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.{test,spec}.{ts,tsx}", "native-release-version.test.ts"],
          setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
          exclude: [
            ...configDefaults.exclude,
            "e2e/**",
            "**/.tmp/**",
            "src/**/*.browser.{test,spec}.{ts,tsx}",
          ],
        },
      },
      {
        extends: true,
        // Pre-bundle mermaid up front. Discovered lazily it triggers vite's
        // "optimized dependencies changed. reloading" mid-run, which vitest
        // warns is a flake vector - and the app's dependency scan can't always
        // find it for itself (it bails when a workspace `dist` isn't built yet).
        optimizeDeps: { include: ["mermaid"] },
        // expo-router's build output carries JSX in plain `.js` files that the
        // dependency optimizer cannot parse. Any browser test whose import
        // graph reaches the router aborted the optimizer mid-run and every file
        // after that point failed with "Failed to fetch dynamically imported
        // module". Browser tests exercise components, not navigation.
        resolve: {
          alias: [
            {
              find: /^expo-router$/,
              replacement: path.resolve(__dirname, "test-stubs/expo-router.ts"),
            },
          ],
        },
        test: {
          name: "browser",
          fileParallelism: false,
          include: ["src/**/*.browser.{test,spec}.{ts,tsx}"],
          browser: {
            enabled: true,
            // The override must ride on the provider's `launchOptions`; a
            // per-instance `launch:` key is ignored by this provider.
            provider: playwright(
              browserExecutablePath
                ? { launchOptions: { executablePath: browserExecutablePath } }
                : undefined,
            ),
            headless: true,
            connectTimeout: 180_000,
            instances: [{ browser: "chromium" }],
            screenshotDirectory: ".vitest-screenshots",
          },
          globalSetup: path.resolve(__dirname, "src/runtime/websocket-test-global-setup.ts"),
        },
      },
    ],
    /**
     * Expo pulls in native tooling (xcode, etc.) that executes files relying on `process.send`.
     * Vitest's default worker pool uses worker_threads, which intentionally stub that API and
     * immediately throw `Unexpected call to process.send`. Running the suite in forked processes
     * keeps `process.send` intact so the app tests can boot before hitting the intentional failures.
     */
    pool: "forks",
    maxWorkers: 2,
    server: {
      deps: {
        fallbackCJS: true,
        inline: ["zustand", "@tanstack/react-query", "react-native-web"],
      },
    },
  },
  // Reanimated ships one file per platform and picks between them by extension
  // (`findHostInstance.web.js`). Vite's dependency optimizer does not apply `resolve.extensions`,
  // so it scans the native files and dies on imports react-native-web has no answer for.
  // Unbundled, the same imports go through the resolver below and land on the web files.
  optimizeDeps: {
    include: ["react/jsx-runtime"],
    exclude: ["react-native-reanimated"],
  },
  // The globals a React Native bundler defines, which esbuild is no longer there to supply for
  // the package excluded above.
  define: {
    "process.env.JEST_WORKER_ID": "undefined",
    __DEV__: "false",
    global: "globalThis",
  },
  resolve: {
    extensions: [
      ".web.mjs",
      ".web.js",
      ".web.mts",
      ".web.ts",
      ".web.jsx",
      ".web.tsx",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
    ],
    alias: [
      {
        find: /^@otto-code\/relay\/e2ee$/,
        replacement: path.resolve(__dirname, "../relay/src/e2ee.ts"),
      },
      {
        find: /^@otto-code\/relay$/,
        replacement: path.resolve(__dirname, "../relay/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // Must precede the `react-native` alias: a string `find` matches by prefix, so this subpath
      // would otherwise resolve inside a react-native-web *file* and break the dependency scan.
      // Reanimated only imports it on the native path, which no test takes.
      {
        find: /^react-native\/Libraries\/Renderer\/shims\/ReactFabric$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-fabric-shim.ts"),
      },
      // Point to the ESM build so Vite can transform its imports and apply the
      // react alias below (the CJS build uses require('react') which bypasses
      // Vite alias resolution).
      {
        find: "react-native",
        replacement: path.resolve(rootNodeModules, "react-native-web/dist/index.js"),
      },
      { find: "react", replacement: resolvePackageEntry("react") },
      {
        find: "react-dom",
        replacement: resolvePackageEntry("react-dom"),
      },
      // The real package reaches `react-native/Libraries/Utilities/codegenNativeComponent`,
      // a Flow-typed `.js` no test environment can parse. It surfaces as
      // `SyntaxError: Unexpected token 'typeof'` against whichever test file is at the top of
      // the import chain - never against this package - so it reads as an unrelated failure.
      // See the stub for what it provides and why zero insets are correct here.
      {
        find: /^react-native-safe-area-context$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-safe-area-context.ts"),
      },
      {
        find: /^@xterm\/addon-ligatures\/lib\/addon-ligatures\.mjs$/,
        replacement: path.resolve(__dirname, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^@xterm\/addon-ligatures$/,
        replacement: path.resolve(__dirname, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^react-native-unistyles$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-unistyles.ts"),
      },
      {
        find: /^react-native-svg$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-svg.ts"),
      },
      // Both ship untranspiled Flow and fail to parse on import, which takes out any test that
      // mounts a menu surface.
      {
        find: /^react-native-safe-area-context$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-safe-area-context.ts"),
      },
      {
        find: /^@gorhom\/bottom-sheet$/,
        replacement: path.resolve(__dirname, "test-stubs/gorhom-bottom-sheet.ts"),
      },
      {
        find: /^react-native-reanimated\/scripts\/validate-worklets-version$/,
        replacement: path.resolve(__dirname, "test-stubs/reanimated-validate-worklets-version.ts"),
      },
      {
        find: /^expo-linking$/,
        replacement: path.resolve(__dirname, "test-stubs/expo-linking.ts"),
      },
      {
        find: /^lucide-react-native$/,
        replacement: path.resolve(__dirname, "test-stubs/lucide-react-native.ts"),
      },
    ],
  },
});
