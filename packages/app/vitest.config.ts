import { defineConfig, configDefaults } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "path";
import fs from "fs";

const appNodeModules = path.resolve(__dirname, "node_modules");
const rootNodeModules = path.resolve(__dirname, "../../node_modules");
const resolvePackageEntry = (packageName: string) => {
  const appPackagePath = path.resolve(appNodeModules, packageName);
  return fs.existsSync(appPackagePath)
    ? appPackagePath
    : path.resolve(rootNodeModules, packageName);
};

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**"],
    /**
     * Several suites do `await import(...)` inside `beforeAll` so they can install globals
     * before a module graph is evaluated. Transforming those graphs measures 7-10s here, which
     * sits right on the 10s default — so the same test passes alone and times out when the run
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
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
          exclude: [...configDefaults.exclude, "e2e/**", "src/**/*.browser.{test,spec}.{ts,tsx}"],
        },
      },
      {
        extends: true,
        // Pre-bundle mermaid up front. Discovered lazily it triggers vite's
        // "optimized dependencies changed. reloading" mid-run, which vitest
        // warns is a flake vector — and the app's dependency scan can't always
        // find it for itself (it bails when a workspace `dist` isn't built yet).
        optimizeDeps: { include: ["mermaid"] },
        test: {
          name: "browser",
          fileParallelism: false,
          include: ["src/**/*.browser.{test,spec}.{ts,tsx}"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            connectTimeout: 180_000,
            instances: [{ browser: "chromium" }],
            screenshotDirectory: ".vitest-screenshots",
          },
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
      // the import chain — never against this package — so it reads as an unrelated failure.
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
    ],
  },
});
