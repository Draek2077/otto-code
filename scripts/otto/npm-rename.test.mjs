import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  countUnrenamed,
  rewritePackageJson,
  rewritePackedTree,
  rewriteText,
  toOttoPackageName,
} from "./npm-rename.mjs";

test("package names move from the Paseo scope to the Otto scope", () => {
  assert.equal(toOttoPackageName("@getpaseo/cli"), "@otto-code/cli");
  assert.equal(toOttoPackageName("zod"), "zod");
});

test("module specifiers and package-name strings are renamed", () => {
  const source = [
    'import { DaemonClient } from "@getpaseo/client/internal/daemon-client";',
    'export * from "@getpaseo/protocol";',
    'const server = await import("@getpaseo/server/daemon-control");',
    'const root = require.resolve("@getpaseo/server");',
    'const { spawnProcess } = require("@getpaseo/plugin/server");',
    'import { execCommand } from"@getpaseo/plugin/server";',
    'export const PASEO_CLI_PACKAGE = "@getpaseo/cli";',
    'throw new Error("Unable to resolve @getpaseo/server package root");',
  ].join("\n");
  const { text, preserved } = rewriteText(source);
  assert.equal(preserved, 0);
  assert.equal(text.includes("@getpaseo/"), false);
  assert.match(text, /from "@otto-code\/client\/internal\/daemon-client"/);
  assert.match(text, /require\("@otto-code\/plugin\/server"\)/);
  assert.match(text, /from"@otto-code\/plugin\/server"/);
  assert.match(text, /PASEO_CLI_PACKAGE = "@otto-code\/cli"/);
});

test("plugin SDK literals that plugin authors write stay Paseo", () => {
  const source = [
    'if (name === "@getpaseo/plugin") return pluginSharedRuntime;',
    'if (name === "@getpaseo/plugin/server/provider") return pluginProviderRuntime;',
    'export const PLUGIN_SDK_SPECIFIERS = ["@getpaseo/plugin", "@getpaseo/plugin/client/ui"];',
    'if (typeOnly && specifier.startsWith("@getpaseo/protocol/")) continue;',
    'const dependencies = { "@getpaseo/plugin": version };',
    // Minified web UI: no space after the comparison.
    'e==="@getpaseo/plugin/client"?a:b',
  ].join("\n");
  const { text, renamed, preserved } = rewriteText(source);
  assert.equal(renamed, 0);
  assert.equal(preserved, 7);
  assert.equal(text, source);
});

test("declarations rename import types but keep SDK string constants", () => {
  const source = [
    'import type { ProviderLaunch } from "@getpaseo/plugin/server/provider";',
    'export declare const SDK: readonly ["@getpaseo/plugin"];',
    'export type Host = import("@getpaseo/plugin/client").Host;',
    'declare module "@getpaseo/protocol" {}',
  ].join("\n");
  const { text } = rewriteText(source);
  assert.match(text, /from "@otto-code\/plugin\/server\/provider"/);
  assert.match(text, /readonly \["@getpaseo\/plugin"\]/);
  assert.match(text, /import\("@otto-code\/plugin\/client"\)/);
  assert.match(text, /declare module "@otto-code\/protocol"/);
  assert.equal(countUnrenamed(text), 0);
});

test("the published manifest carries Otto's name, dependencies, and repository", () => {
  const manifest = rewritePackageJson(
    {
      name: "@getpaseo/cli",
      version: "0.10.0",
      description: "Paseo CLI - control your AI coding agents from the command line",
      bin: { otto: "bin/paseo" },
      dependencies: { "@getpaseo/server": "0.10.0", zod: "^4.4.3" },
      peerDependencies: { "@getpaseo/protocol": "0.10.0" },
      peerDependenciesMeta: { "@getpaseo/protocol": { optional: true } },
    },
    { directory: "packages/cli", license: "AGPL-3.0-or-later" },
  );
  assert.equal(manifest.name, "@otto-code/cli");
  assert.equal(manifest.version, "0.10.0");
  assert.equal(
    manifest.description,
    "Otto CLI - control your AI coding agents from the command line",
  );
  assert.deepEqual(manifest.bin, { otto: "bin/paseo" });
  assert.deepEqual(manifest.dependencies, { "@otto-code/server": "0.10.0", zod: "^4.4.3" });
  assert.deepEqual(manifest.peerDependencies, { "@otto-code/protocol": "0.10.0" });
  assert.deepEqual(Object.keys(manifest.peerDependenciesMeta), ["@otto-code/protocol"]);
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "git+https://github.com/Draek2077/otto-code.git",
    directory: "packages/cli",
  });
  assert.equal(manifest.license, "AGPL-3.0-or-later");
});

test("packed plugin SDK imports stay Paseo while installed runtime dependencies become Otto", () => {
  const root = mkdtempSync(path.join(tmpdir(), "otto-npm-rename-"));
  const write = (relativePath, contents) => {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  };
  const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
  try {
    write(
      "package.json",
      JSON.stringify({
        name: "@getpaseo/server",
        version: "0.10.0",
        dependencies: { "@getpaseo/plugin": "0.10.0" },
      }),
    );
    write(
      "dist/server/utils/spawn.js",
      'import { spawnProcess } from "@getpaseo/plugin/server";\n',
    );
    write(
      "dist/server/server/plugins/bundle-evaluator.js",
      'if (name === "@getpaseo/plugin") return runtime;\n',
    );
    write("dist/server/index.d.ts", 'export * from "@getpaseo/protocol/messages";\n');
    write("dist/server/data.json", '{"package":"@getpaseo/cli"}\n');
    write("README.md", "npm install -g @getpaseo/cli\n");
    write("bin/paseo", "#!/usr/bin/env node\nimport '@getpaseo/cli/dist/index.js'\n");
    write(
      "dist/server/builtin-plugins/zai-usage-source/index.server.ts",
      'import type { UsageReport } from "@getpaseo/plugin/server/usage";\n',
    );
    write("dist/server/model.onnx", Buffer.from([0, 1, 2, 64, 103, 101, 116]));
    write(
      "dist/server/builtin-plugins/otto-openai-compatible-provider/index.server.ts",
      'import type { PluginServerContext } from "@getpaseo/plugin/server";\nimport { BUILTIN_PROVIDER_IDS } from "@getpaseo/protocol/provider-manifest";\n',
    );

    const result = rewritePackedTree(root, { directory: "packages/server" });

    const manifest = JSON.parse(read("package.json"));
    assert.equal(manifest.name, "@otto-code/server");
    assert.deepEqual(manifest.dependencies, { "@otto-code/plugin": "0.10.0" });
    assert.equal(manifest.repository.directory, "packages/server");
    assert.match(read("dist/server/utils/spawn.js"), /from "@otto-code\/plugin\/server"/);
    assert.match(read("dist/server/server/plugins/bundle-evaluator.js"), /"@getpaseo\/plugin"/);
    assert.match(read("dist/server/index.d.ts"), /"@otto-code\/protocol\/messages"/);
    assert.match(read("dist/server/data.json"), /"@otto-code\/cli"/);
    assert.match(read("README.md"), /@otto-code\/cli/);
    assert.match(read("bin/paseo"), /'@otto-code\/cli\/dist\/index\.js'/);
    assert.match(
      read("dist/server/builtin-plugins/zai-usage-source/index.server.ts"),
      /"@getpaseo\/plugin\/server\/usage"/,
    );
    const provider = read(
      "dist/server/builtin-plugins/otto-openai-compatible-provider/index.server.ts",
    );
    assert.match(provider, /"@getpaseo\/plugin\/server"/);
    assert.match(provider, /"@otto-code\/protocol\/provider-manifest"/);
    assert.equal(result.preserved, 3);
    assert.equal(result.renamed, 6);
    assert.deepEqual(result.changedFiles.sort(), [
      "README.md",
      "bin/paseo",
      "dist/server/builtin-plugins/otto-openai-compatible-provider/index.server.ts",
      "dist/server/data.json",
      "dist/server/index.d.ts",
      "dist/server/utils/spawn.js",
      "package.json",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
