import { expect, test } from "vitest";
import type { Metafile } from "esbuild";

test("keeps daemon-client APIs out of the server public entry", async () => {
  const serverExports = await import("./exports.js");

  expect(serverExports.createPaseoDaemon).toBeTypeOf("function");
  expect(serverExports.resolvePaseoHome).toBeTypeOf("function");

  for (const name of [
    "DaemonClient",
    "DaemonClientConfig",
    "ConnectionState",
    "DaemonEvent",
    "WebSocketFactory",
    "WebSocketLike",
  ]) {
    expect(serverExports).not.toHaveProperty(name);
  }
});

// Keep the emitted dependency tree intact: production runs unbundled modules,
// so tree-shaking must not hide the cost of an unused re-export.
test.each([
  ["desktop daemon management", "../../../desktop/src/daemon/daemon-manager.ts"],
  ["supervisor", "../../scripts/supervisor-entrypoint.ts"],
  ["daemon control", "@getpaseo/server/daemon-control"],
  ["configuration without the session admission resolver", "@getpaseo/server/configuration"],
])("%s does not load the daemon runtime or wire schemas", async (_name, entry) => {
  const inputs = await runtimeDependencies(entry);
  expect(inputs.filter((file) => /\/(?:bootstrap|messages)\.[jt]s$/.test(file))).toEqual([]);
});

test("CLI command registration does not load the daemon implementation", async () => {
  const inputs = await runtimeDependencies("../../../cli/src/cli.ts");
  expect(
    inputs.filter((file) => /\/(?:bootstrap|agent-manager|session)\.[jt]s$/.test(file)),
  ).toEqual([]);
});

async function runtimeDependencies(entry: string): Promise<string[]> {
  const { build } = await import("esbuild");
  const { fileURLToPath } = await import("node:url");
  const { isAbsolute } = await import("node:path");
  const result = await build({
    stdin: {
      contents: `import ${JSON.stringify(entry.startsWith("@") ? entry : fileURLToPath(new URL(entry, import.meta.url)))};`,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    },
    bundle: true,
    write: false,
    metafile: true,
    treeShaking: false,
    platform: "node",
    // Server unit CI builds dependency workspaces, then tests server source.
    conditions: ["source"],
    format: "esm",
    logLevel: "silent",
    plugins: [
      {
        name: "external-vendors",
        setup(builder) {
          builder.onResolve({ filter: /^[^./]/ }, ({ path }) => {
            if (!isAbsolute(path) && !path.startsWith("@getpaseo/")) {
              return { path, external: true };
            }
          });
        },
      },
    ],
  });
  const inputs = eagerRuntimeInputs(result.metafile);
  expect(inputs.length).toBeGreaterThan(1);
  return inputs;
}

// OTTO(test): account for lazy Brain commands while retaining eager Paseo import checks.
/** A deferred import is present in bundle metadata but is not evaluated by
 * registration. Static imports/re-exports remain counted without tree shaking. */
function eagerRuntimeInputs(metafile: Metafile): string[] {
  const pending = Object.values(metafile.outputs).flatMap((output) =>
    output.entryPoint ? [output.entryPoint] : [],
  );
  const loaded = new Set<string>();
  while (pending.length) {
    const file = pending.pop();
    if (!file || loaded.has(file)) continue;
    loaded.add(file);
    for (const entry of metafile.inputs[file]?.imports ?? []) {
      if (!entry.external && entry.kind !== "dynamic-import") pending.push(entry.path);
    }
  }
  return [...loaded];
}

test("the import-cost check retains unused re-exports while excluding explicit deferred operations", async () => {
  const { build } = await import("esbuild");
  const result = await build({
    stdin: { contents: 'export * from "eager"; export const run = () => import("deferred");' },
    bundle: true,
    write: false,
    metafile: true,
    treeShaking: false,
    format: "esm",
    plugins: [
      {
        name: "import-cost-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^(eager|deferred)$/ }, ({ path }) => ({
            path,
            namespace: "import-cost-fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "import-cost-fixture" }, () => ({
            contents: "export const value = 1;",
            loader: "js",
          }));
        },
      },
    ],
  });
  expect(Object.keys(result.metafile.inputs)).toContain("import-cost-fixture:deferred");
  const eager = eagerRuntimeInputs(result.metafile);
  expect(eager).toContain("import-cost-fixture:eager");
  expect(eager).not.toContain("import-cost-fixture:deferred");
});
