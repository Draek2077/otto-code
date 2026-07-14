#!/usr/bin/env node
// Windows local-build fix. The React Native gradle plugin's Os.cliPath()
// rewrites `--entry-file` to a path relative to the app dir (only on Windows,
// to dodge space-in-path issues), so Expo's `export:embed` receives a bare
// `index.ts`. Expo forwards that relative entry to Metro unchanged, and Metro
// resolves it against the monorepo server root instead of the app dir, failing
// with "Unable to resolve module ./index.ts". Re-absolutize the entry (relative
// to cwd, which the gradle plugin sets to the app dir) before delegating to
// @expo/cli. On Linux/macOS the plugin already passes an absolute path, so the
// resolve() below is an identity no-op. This wrapper is wired in as the RN
// gradle plugin's `cliFile` by the withMetroEmbedCli config plugin.
const path = require("node:path");

const argv = process.argv.slice(2);
const entryIndex = argv.indexOf("--entry-file");
if (entryIndex !== -1 && typeof argv[entryIndex + 1] === "string") {
  argv[entryIndex + 1] = path.resolve(process.cwd(), argv[entryIndex + 1]);
}
process.argv = [process.argv[0], process.argv[1], ...argv];

const expoCli = require.resolve("@expo/cli", {
  paths: [require.resolve("expo/package.json")],
});
require(expoCli);
