import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrainConfigSchema, type BrainConfig } from "../config/schema.js";
import { effectiveAuthToken, startService } from "./serve.js";

// The bind guard must throw before any process is spawned; a truthy stub runtime
// is all resolveRuntime needs to provide for that path.
vi.mock("../runtime/index.js", () => ({
  resolveRuntime: () => ({ source: "managed" }),
}));

const tmpDirs: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-serve-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function configWith(overrides: {
  auth?: Partial<BrainConfig["auth"]>;
  listen?: Partial<BrainConfig["listen"]>;
  allowInsecureBind?: boolean;
}): BrainConfig {
  return BrainConfigSchema.parse(overrides);
}

describe("effectiveAuthToken", () => {
  it("returns the token when mode is token and one is set", () => {
    expect(effectiveAuthToken(configWith({ auth: { mode: "token", token: "s3cret" } }))).toBe(
      "s3cret",
    );
  });

  it("returns null when mode is none, even with a stored token", () => {
    expect(effectiveAuthToken(configWith({ auth: { mode: "none", token: "s3cret" } }))).toBeNull();
  });

  it("returns null when mode is token but the token is null", () => {
    expect(effectiveAuthToken(configWith({ auth: { mode: "token", token: null } }))).toBeNull();
  });

  it("returns null when mode is token but the token is empty", () => {
    expect(effectiveAuthToken(configWith({ auth: { mode: "token", token: "" } }))).toBeNull();
  });
});

describe("startService bind guard", () => {
  // A fresh home per test so no real lastModelId leaks in and the past-the-guard
  // failure is deterministically NO_MODEL. The injected env alone must be enough:
  // startService threading it into every path resolution is part of what we test.
  const env = (): NodeJS.ProcessEnv => ({ OTTO_HOME: makeTmp() });

  it("refuses a non-loopback bind when mode=token has no token (the auth bypass)", async () => {
    const config = configWith({
      listen: { host: "0.0.0.0", port: 0 },
      auth: { mode: "token", token: null },
    });
    await expect(startService({ config, env: env() })).rejects.toMatchObject({
      code: "INSECURE_BIND",
    });
  });

  it("refuses a non-loopback bind with no auth at all", async () => {
    const config = configWith({ listen: { host: "0.0.0.0", port: 0 } });
    await expect(startService({ config, env: env() })).rejects.toMatchObject({
      code: "INSECURE_BIND",
    });
  });

  it("passes the guard when a real token is set", async () => {
    const config = configWith({
      listen: { host: "0.0.0.0", port: 0 },
      auth: { mode: "token", token: "s3cret" },
    });
    // No model is configured, so startup fails past the guard - the point is the
    // failure is NO_MODEL, not INSECURE_BIND.
    await expect(startService({ config, env: env() })).rejects.toMatchObject({
      code: "NO_MODEL",
    });
  });

  it("does not apply to a loopback bind", async () => {
    const config = configWith({ listen: { host: "127.0.0.1", port: 0 } });
    await expect(startService({ config, env: env() })).rejects.toMatchObject({
      code: "NO_MODEL",
    });
  });
});
