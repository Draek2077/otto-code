// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Demo templates are standalone fake projects (their own package.json),
    // not app code — they must not be linted against the app's config.
    ignores: ["dist/*", "demo/staging/templates/**", "demo/.out/**"],
  },
]);
