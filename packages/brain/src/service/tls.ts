/**
 * Supplies the TLS keypair for the brain's HTTPS listener and keeps it fresh,
 * so the brain can be exposed over HTTPS with no relay in front. Ported and
 * generalized from otto-brain-relay's `cert.js`.
 *
 * Modes (resolved from `config.tls`):
 *  - `files`       - read the cert/key paths you provide; no renewal.
 *  - `self-signed` - generate a local keypair on first run, cached under
 *                    `certDir`; regenerated when it nears expiry. Clients must
 *                    trust it (or pass `-k`); there is no chain of trust.
 *  - `tailscale`   - issue/renew a real Let's Encrypt cert for this machine's
 *                    MagicDNS name via `tailscaled`, so tailnet clients see no
 *                    warnings. Renewal is hot: `renewed` fires with the new
 *                    { cert, key } and the server swaps its secure context
 *                    without dropping connections.
 */
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import path from "node:path";

import generateSelfSigned from "selfsigned";

import type { BrainConfig } from "../config/schema.js";
import type { BrainPaths } from "../config/paths.js";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../config/private-files.js";
import { DEFAULT_TAILSCALE_EXE, dnsName, issueCert } from "./tailscale.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Self-signed certs live ~2 years; regenerated well before expiry by the check loop.
const SELF_SIGNED_DAYS = 825;

export interface SecurePair {
  cert: Buffer;
  key: Buffer;
}

export interface CertInfo {
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  certFile: string;
  keyFile: string;
}

/** Minimal logger sink; only `warn`/`info` are used. */
export interface TlsLogger {
  info?(message: string): void;
  warn?(message: string): void;
}

/** Concrete, fully-resolved options - no nulls, no auto-detection left to do. */
export interface CertManagerOptions {
  mode: "files" | "self-signed" | "tailscale";
  certFile: string;
  keyFile: string;
  hostname: string;
  certDir: string;
  renewBeforeDays: number;
  checkIntervalMs: number;
  tailscaleExe: string;
  logger?: TlsLogger;
}

/**
 * Resolve `config.tls` into concrete CertManager options, or `null` when TLS is
 * off. For `tailscale` mode with no configured hostname, this auto-detects the
 * MagicDNS name from `tailscaled` (the one async step, done here so the manager
 * itself is synchronous to construct).
 */
export async function resolveTlsOptions(
  config: BrainConfig,
  paths: BrainPaths,
): Promise<CertManagerOptions | null> {
  const tls = config.tls;
  if (tls.mode === "off") return null;

  const certDir = tls.certDir ?? path.join(paths.root, "certs");
  const tailscaleExe = tls.tailscaleExe ?? DEFAULT_TAILSCALE_EXE;

  if (tls.mode === "files") {
    if (!tls.certFile || !tls.keyFile) {
      throw new Error("tls.mode=files requires tls.certFile and tls.keyFile");
    }
    return {
      mode: "files",
      certFile: path.resolve(tls.certFile),
      keyFile: path.resolve(tls.keyFile),
      hostname: tls.hostname ?? "localhost",
      certDir,
      renewBeforeDays: tls.renewBeforeDays,
      checkIntervalMs: tls.checkIntervalMs,
      tailscaleExe,
    };
  }

  const hostname =
    tls.hostname ?? (tls.mode === "tailscale" ? await dnsName(tailscaleExe) : "localhost");
  return {
    mode: tls.mode,
    certFile: path.join(certDir, `${hostname}.crt`),
    keyFile: path.join(certDir, `${hostname}.key`),
    hostname,
    certDir,
    renewBeforeDays: tls.renewBeforeDays,
    checkIntervalMs: tls.checkIntervalMs,
    tailscaleExe,
  };
}

export class CertManager extends EventEmitter {
  private readonly options: CertManagerOptions;
  private readonly logger: TlsLogger;
  private timer: NodeJS.Timeout | null = null;
  private current: { cert: Buffer; key: Buffer; info: CertInfo } | null = null;

  constructor(options: CertManagerOptions) {
    super();
    this.options = options;
    this.logger = options.logger ?? {};
  }

  /** Issue/generate if needed, then load and return the keypair. */
  async load(): Promise<SecurePair> {
    if (this.options.mode !== "files") await this.ensureFresh();
    return this.read();
  }

  /** Begin periodic expiry checks (renewing modes only). */
  start(): void {
    if (this.options.mode === "files" || this.timer) return;
    this.timer = setInterval(() => {
      this.check().catch((error: unknown) =>
        this.logger.warn?.(`cert renewal check failed: ${errorMessage(error)}`),
      );
    }, this.options.checkIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get info(): CertInfo | null {
    return this.current?.info ?? null;
  }

  /** Days until the loaded cert expires, or null if none is loaded. */
  get daysRemaining(): number | null {
    if (!this.current) return null;
    return Math.floor((this.current.info.validTo.getTime() - Date.now()) / DAY_MS);
  }

  /** Issue (tailscale) or generate (self-signed) when missing or near expiry. */
  private async ensureFresh(): Promise<boolean> {
    ensurePrivateDirectory(this.options.certDir);

    const existing = this.inspect();
    if (existing && existing.daysRemaining > this.options.renewBeforeDays) return false;

    const reason = existing
      ? `expires in ${existing.daysRemaining}d (threshold ${this.options.renewBeforeDays}d)`
      : "no cert on disk";

    if (this.options.mode === "tailscale") {
      this.logger.info?.(`requesting TLS certificate from tailscaled (${reason})...`);
      await issueCert(
        this.options.tailscaleExe,
        this.options.hostname,
        this.options.certFile,
        this.options.keyFile,
      );
      return true;
    }

    // self-signed
    this.logger.info?.(
      `generating a self-signed certificate for ${this.options.hostname} (${reason})`,
    );
    const pair = generateSelfSigned.generate(
      [{ name: "commonName", value: this.options.hostname }],
      {
        days: SELF_SIGNED_DAYS,
        keySize: 2048,
        algorithm: "sha256",
        extensions: [
          { name: "basicConstraints", cA: false },
          {
            name: "subjectAltName",
            altNames: buildAltNames(this.options.hostname),
          },
        ],
      },
    );
    writePrivateFileAtomicSync(this.options.certFile, pair.cert);
    writePrivateFileAtomicSync(this.options.keyFile, pair.private);
    return true;
  }

  private read(): SecurePair {
    const cert = readFileSync(this.options.certFile);
    const key = readFileSync(this.options.keyFile);
    const parsed = new X509Certificate(cert);
    this.current = {
      cert,
      key,
      info: {
        subject: parsed.subject,
        issuer: parsed.issuer.split("\n").find((l) => l.startsWith("CN=")) ?? parsed.issuer,
        validFrom: new Date(parsed.validFrom),
        validTo: new Date(parsed.validTo),
        certFile: this.options.certFile,
        keyFile: this.options.keyFile,
      },
    };
    return { cert, key };
  }

  /** Inspect the on-disk cert's expiry without loading it as current. */
  private inspect(): { validTo: Date; daysRemaining: number } | null {
    try {
      if (!existsSync(this.options.certFile) || !existsSync(this.options.keyFile)) return null;
      const parsed = new X509Certificate(readFileSync(this.options.certFile));
      const validTo = new Date(parsed.validTo);
      return { validTo, daysRemaining: Math.floor((validTo.getTime() - Date.now()) / DAY_MS) };
    } catch (error) {
      this.logger.warn?.(
        `could not read existing certificate, will re-issue: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  private async check(): Promise<void> {
    const before = this.current?.info.validTo.getTime();
    const reissued = await this.ensureFresh();
    if (!reissued) return;

    const { cert, key } = this.read();
    if (this.current && this.current.info.validTo.getTime() === before) return;

    this.logger.info?.(
      `certificate renewed - now valid until ${this.current?.info.validTo.toISOString()}`,
    );
    this.emit("renewed", { cert, key });
  }
}

function buildAltNames(hostname: string): SelfSignedAltName[] {
  const names: SelfSignedAltName[] = [
    { type: 2, value: hostname },
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    { type: 7, ip: "::1" },
  ];
  // Deduplicate when the hostname is itself "localhost".
  return names.filter(
    (n, i) =>
      i === names.findIndex((m) => m.type === n.type && m.value === n.value && m.ip === n.ip),
  );
}

interface SelfSignedAltName {
  type: number;
  value?: string;
  ip?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
