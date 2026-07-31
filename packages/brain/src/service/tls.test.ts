import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { resolveBrainPaths } from "../config/paths.js";
import { BrainConfigSchema, type BrainConfig } from "../config/schema.js";
import { CertManager, resolveTlsOptions, type CertManagerOptions } from "./tls.js";
import { extractToken } from "./serve.js";

const tmpDirs: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-tls-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function configWith(tls: Partial<BrainConfig["tls"]>): BrainConfig {
  return BrainConfigSchema.parse({ tls });
}

describe("resolveTlsOptions", () => {
  it("returns null when TLS is off", async () => {
    const paths = resolveBrainPaths({ OTTO_HOME: makeTmp() });
    expect(await resolveTlsOptions(configWith({ mode: "off" }), paths)).toBeNull();
  });

  it("resolves files mode to absolute cert/key paths", async () => {
    const paths = resolveBrainPaths({ OTTO_HOME: makeTmp() });
    const opts = await resolveTlsOptions(
      configWith({ mode: "files", certFile: "cert.pem", keyFile: "key.pem" }),
      paths,
    );
    expect(opts?.mode).toBe("files");
    expect(path.isAbsolute(opts?.certFile ?? "")).toBe(true);
    expect(path.isAbsolute(opts?.keyFile ?? "")).toBe(true);
  });

  it("rejects files mode without cert/key paths", async () => {
    const paths = resolveBrainPaths({ OTTO_HOME: makeTmp() });
    await expect(resolveTlsOptions(configWith({ mode: "files" }), paths)).rejects.toThrow(
      /requires tls.certFile and tls.keyFile/,
    );
  });

  it("defaults the cert cache dir under the brain home for self-signed", async () => {
    const home = makeTmp();
    const paths = resolveBrainPaths({ OTTO_HOME: home });
    const opts = await resolveTlsOptions(configWith({ mode: "self-signed" }), paths);
    expect(opts?.certDir).toBe(path.join(paths.root, "certs"));
    // hostname defaults to localhost; file names derive from it.
    expect(opts?.hostname).toBe("localhost");
    expect(opts?.certFile).toBe(path.join(paths.root, "certs", "localhost.crt"));
  });
});

describe("CertManager self-signed", () => {
  function options(certDir: string): CertManagerOptions {
    return {
      mode: "self-signed",
      hostname: "localhost",
      certDir,
      certFile: path.join(certDir, "localhost.crt"),
      keyFile: path.join(certDir, "localhost.key"),
      renewBeforeDays: 21,
      checkIntervalMs: 60_000,
      tailscaleExe: "tailscale",
    };
  }

  it("generates a valid keypair on first load and caches it", async () => {
    const certDir = path.join(makeTmp(), "certs");
    const mgr = new CertManager(options(certDir));
    const pair = await mgr.load();

    expect(pair.cert.length).toBeGreaterThan(0);
    expect(pair.key.length).toBeGreaterThan(0);
    expect(existsSync(path.join(certDir, "localhost.crt"))).toBe(true);

    const parsed = new X509Certificate(pair.cert);
    expect(parsed.subject).toContain("localhost");
    expect(mgr.daysRemaining).toBeGreaterThan(0);
  });

  it("reuses the cached cert rather than regenerating on the next load", async () => {
    const certDir = path.join(makeTmp(), "certs");
    const mgr = new CertManager(options(certDir));
    await mgr.load();
    const first = readFileSync(path.join(certDir, "localhost.crt"));
    await new CertManager(options(certDir)).load();
    const second = readFileSync(path.join(certDir, "localhost.crt"));
    expect(second.equals(first)).toBe(true);
  });
});

describe("extractToken", () => {
  const asReq = (headers: http.IncomingHttpHeaders): http.IncomingMessage =>
    ({ headers }) as http.IncomingMessage;

  it("reads an Authorization Bearer token", () => {
    expect(extractToken(asReq({ authorization: "Bearer sk-abc" }))).toBe("sk-abc");
  });

  it("reads an x-api-key header (OpenAI/Anthropic convention)", () => {
    expect(extractToken(asReq({ "x-api-key": "key-123" }))).toBe("key-123");
  });

  it("reads the brain's own x-otto-brain-token header", () => {
    expect(extractToken(asReq({ "x-otto-brain-token": "tok-9" }))).toBe("tok-9");
  });

  it("returns null when no credential is present", () => {
    expect(extractToken(asReq({}))).toBeNull();
  });
});
