import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNpmScriptProvider } from "./npm-script-provider.js";
import { discoverWorkspaceScripts, type DeclaredScriptSummary } from "./script-discovery.js";
import {
  normalizeScriptCommand,
  parseQualifiedScriptName,
  qualifyScriptName,
  type ScriptProvider,
} from "./script-provider.js";

const logger = pino({ level: "silent" });

let workspaceDirectory: string;

beforeEach(async () => {
  workspaceDirectory = await mkdtemp(path.join(tmpdir(), "otto-script-discovery-"));
});

afterEach(async () => {
  await rm(workspaceDirectory, { recursive: true, force: true });
});

async function writeManifest(contents: string): Promise<void> {
  await writeFile(path.join(workspaceDirectory, "package.json"), contents, "utf8");
}

async function discover(declaredScripts: DeclaredScriptSummary[] = []) {
  return discoverWorkspaceScripts({ workspaceDirectory, declaredScripts, logger });
}

describe("npm script provider", () => {
  it("discovers each script in the workspace root package.json", async () => {
    await writeManifest(
      JSON.stringify({ scripts: { build: "tsc -b", typecheck: "tsc --noEmit" } }),
    );

    const discovered = await discover();

    expect(discovered).toEqual([
      {
        name: "build",
        scriptName: "npm:build",
        command: "npm run build",
        cwd: null,
        sourceFile: "package.json",
        sourceId: "npm",
        sourceLabel: "npm",
      },
      {
        name: "typecheck",
        scriptName: "npm:typecheck",
        command: "npm run typecheck",
        cwd: null,
        sourceFile: "package.json",
        sourceId: "npm",
        sourceLabel: "npm",
      },
    ]);
  });

  it("returns nothing when there is no package.json", async () => {
    expect(await discover()).toEqual([]);
  });

  it("returns nothing rather than throwing when package.json is malformed", async () => {
    await writeManifest("{ this is not json");

    expect(await discover()).toEqual([]);
  });

  it("returns nothing when package.json declares no scripts", async () => {
    await writeManifest(JSON.stringify({ name: "thing", version: "1.0.0" }));

    expect(await discover()).toEqual([]);
  });

  it("skips entries whose body is not a runnable string", async () => {
    await writeManifest(
      JSON.stringify({
        scripts: { build: "tsc -b", broken: 42, blank: "   ", nested: { nope: true } },
      }),
    );

    expect((await discover()).map((entry) => entry.name)).toEqual(["build"]);
  });

  it("ignores a scripts key that is not an object", async () => {
    await writeManifest(JSON.stringify({ scripts: ["build"] }));

    expect(await discover()).toEqual([]);
  });

  it("names the detected package manager in both the command and the group label", async () => {
    await writeManifest(JSON.stringify({ scripts: { dev: "vite" } }));
    await writeFile(path.join(workspaceDirectory, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const [entry] = await discover();

    expect(entry).toMatchObject({ command: "pnpm run dev", sourceLabel: "pnpm" });
  });

  it("quotes a script name that the shell would otherwise reinterpret", async () => {
    await writeManifest(JSON.stringify({ scripts: { "build all": "tsc -b" } }));

    const [entry] = await discover();

    expect(entry?.command).toBe('npm run "build all"');
    expect(entry?.scriptName).toBe("npm:build all");
  });
});

describe("de-duplication against declared scripts", () => {
  beforeEach(async () => {
    await writeManifest(JSON.stringify({ scripts: { dev: "vite", build: "tsc -b" } }));
  });

  it("suppresses a discovered script that a declared script already runs", async () => {
    const discovered = await discover([{ scriptName: "serve", command: "  npm   run  dev -- " }]);

    expect(discovered.map((entry) => entry.name)).toEqual(["build"]);
  });

  it("suppresses a discovered script whose bare name a declared script already uses", async () => {
    const discovered = await discover([
      { scriptName: "dev", command: "npm run daemon && npm run app" },
    ]);

    expect(discovered.map((entry) => entry.name)).toEqual(["build"]);
  });

  it("keeps a discovered script that shares neither name nor command", async () => {
    const discovered = await discover([{ scriptName: "daemon", command: "node ./daemon.js" }]);

    expect(discovered.map((entry) => entry.name)).toEqual(["dev", "build"]);
  });
});

describe("provider isolation", () => {
  function stubProvider(input: {
    sourceId: string;
    discover: ScriptProvider["discover"];
  }): ScriptProvider {
    return { sourceId: input.sourceId, sourceLabel: input.sourceId, discover: input.discover };
  }

  it("keeps the other sources when one provider throws", async () => {
    const discovered = await discoverWorkspaceScripts({
      workspaceDirectory,
      declaredScripts: [],
      logger,
      providers: [
        stubProvider({
          sourceId: "broken",
          discover: () => Promise.reject(new Error("no")),
        }),
        stubProvider({
          sourceId: "make",
          discover: () =>
            Promise.resolve([
              { name: "release", command: "make release", cwd: null, sourceFile: "Makefile" },
            ]),
        }),
      ],
    });

    expect(discovered.map((entry) => entry.scriptName)).toEqual(["make:release"]);
  });

  it("lets two sources offer the same bare name", async () => {
    await writeManifest(JSON.stringify({ scripts: { build: "tsc -b" } }));

    const discovered = await discoverWorkspaceScripts({
      workspaceDirectory,
      declaredScripts: [],
      logger,
      providers: [
        createNpmScriptProvider(),
        stubProvider({
          sourceId: "make",
          discover: () =>
            Promise.resolve([
              { name: "build", command: "make build", cwd: null, sourceFile: "Makefile" },
            ]),
        }),
      ],
    });

    expect(discovered.map((entry) => entry.scriptName)).toEqual(["npm:build", "make:build"]);
  });
});

describe("qualified names", () => {
  it("round-trips a name through qualification", () => {
    const scriptName = qualifyScriptName({ sourceId: "npm", name: "build:web" });

    expect(scriptName).toBe("npm:build:web");
    expect(parseQualifiedScriptName(scriptName)).toEqual({ sourceId: "npm", name: "build:web" });
  });

  it("treats a bare otto.json name as unqualified", () => {
    expect(parseQualifiedScriptName("dev")).toBeNull();
    expect(parseQualifiedScriptName(":dev")).toBeNull();
    expect(parseQualifiedScriptName("npm:")).toBeNull();
  });
});

describe("command normalization", () => {
  it("collapses whitespace and drops forwarded argument separators", () => {
    expect(normalizeScriptCommand("  npm   run   dev -- ")).toBe("npm run dev");
    expect(normalizeScriptCommand("npm run dev")).toBe("npm run dev");
  });
});
