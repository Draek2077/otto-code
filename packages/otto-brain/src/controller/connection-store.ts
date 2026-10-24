/** Daemon-owned connection intent, separate from the selected Brain owner's config. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod/v3";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../config/private-files.js";
import { remoteBrainClient } from "../service/remote-client.js";

const RemoteSchema = z
  .object({
    host: z.string().max(1024).default(""),
    port: z.number().int().min(1).max(65535).default(1234),
    secure: z.boolean().default(false),
    certFingerprint: z.string().max(256).nullable().default(null),
    authToken: z.string().max(16384).nullable().default(null),
  })
  .passthrough();
const ConnectionSchema = z
  .object({
    enabled: z.boolean().default(false),
    autoStart: z.boolean().default(false),
    mode: z.enum(["local", "remote"]).default("local"),
    remote: RemoteSchema.default({}),
  })
  .passthrough();
const CredentialSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
  z
    .object({
      action: z.literal("replace"),
      value: z
        .string()
        .min(1)
        .max(16384)
        .refine((value) =>
          [...value].every((letter) => letter.charCodeAt(0) > 32 && letter.charCodeAt(0) !== 127),
        ),
    })
    .strict(),
]);
const SaveSchema = z
  .object({
    expectedRevision: z.string().min(1).max(256),
    patch: z
      .object({
        enabled: z.boolean().optional(),
        autoStart: z.boolean().optional(),
        mode: z.enum(["local", "remote"]).optional(),
        remote: z
          .object({
            host: z.string().max(1024).optional(),
            port: z.number().int().min(1).max(65535).optional(),
            secure: z.boolean().optional(),
            certFingerprint: z.string().max(256).nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    credential: CredentialSchema,
  })
  .strict();
export type BrainConnectionSave = z.infer<typeof SaveSchema>;
export type BrainConnectionIntent = z.infer<typeof ConnectionSchema>;

export class BrainConnectionError extends Error {
  constructor(
    readonly kind: "validation" | "conflict" | "unavailable" | "unknown",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

function bytes(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function digest(value: string | null): string {
  return createHash("sha256")
    .update(value === null ? "missing" : `stored:${value}`)
    .digest("hex");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BrainConnectionError(
      "unavailable",
      "Preserved Otto configuration needs repair; it was left unchanged",
    );
  return value as Record<string, unknown>;
}
function attempt<T>(run: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Never creates files on read, resolves a home, starts a listener or applies autostart. */
export class BrainConnectionStore {
  constructor(readonly file: string) {
    if (!path.isAbsolute(file))
      throw new Error("Brain connection storage requires the daemon's absolute file path");
  }
  private load() {
    try {
      const original = bytes(this.file);
      const document = original === null ? {} : record(JSON.parse(original));
      const connection = ConnectionSchema.parse(document.brain === undefined ? {} : document.brain);
      return { document, connection, revision: digest(original) };
    } catch (error) {
      if (error instanceof BrainConnectionError) throw error;
      throw new BrainConnectionError(
        "unavailable",
        "Preserved Brain connection settings could not be read",
        { cause: error },
      );
    }
  }
  read() {
    const { connection, revision } = this.load();
    const { authToken, host, port, secure, certFingerprint } = connection.remote;
    return {
      version: 1 as const,
      revision,
      config: {
        enabled: connection.enabled,
        autoStart: connection.autoStart,
        mode: connection.mode,
        remote: { host, port, secure, certFingerprint },
      },
      credential: {
        stored: Boolean(authToken),
        effectiveSource: authToken ? ("stored" as const) : ("none" as const),
      },
    };
  }
  /** Private daemon composition only. Never return this to plugin/app snapshots. */
  resolve(): BrainConnectionIntent {
    return this.load().connection;
  }

  save(input: unknown) {
    const parsed = SaveSchema.safeParse(input);
    if (!parsed.success)
      throw new BrainConnectionError("validation", "Check the Brain connection fields");
    const request = parsed.data;
    ensurePrivateDirectory(path.dirname(this.file));
    const lock = `${this.file}.brain.lock`;
    const claim = JSON.stringify({ pid: process.pid, id: randomUUID() });
    try {
      writeFileSync(lock, claim, { flag: "wx", mode: 0o600 });
    } catch (error) {
      throw new BrainConnectionError(
        "unavailable",
        "Brain connection settings are locked by another or interrupted writer",
        { cause: error },
      );
    }
    const result = attempt(() => this.write(request));
    const cleanup = attempt(() => {
      if (readFileSync(lock, "utf8") !== claim) throw new Error("Brain connection claim changed");
      unlinkSync(lock);
    });
    if (!result.ok && !cleanup.ok)
      throw new AggregateError(
        [result.error, cleanup.error],
        "Brain connection write and cleanup failed",
        { cause: result.error },
      );
    if (!result.ok) throw result.error;
    if (!cleanup.ok)
      throw new BrainConnectionError(
        "unknown",
        "Reload Brain connection settings to check whether the save completed",
        { cause: cleanup.error },
      );
    return result.value;
  }
  private write(request: BrainConnectionSave) {
    const current = this.load();
    if (current.revision !== request.expectedRevision)
      throw new BrainConnectionError(
        "conflict",
        "Brain connection settings changed; reload before saving",
      );
    const remote = { ...current.connection.remote, ...request.patch.remote };
    if (request.credential.action === "replace") remote.authToken = request.credential.value;
    if (request.credential.action === "remove") remote.authToken = null;
    const connection = ConnectionSchema.parse({ ...current.connection, ...request.patch, remote });
    if (connection.mode === "remote") {
      try {
        remoteBrainClient(connection.remote);
      } catch (error) {
        throw new BrainConnectionError(
          "validation",
          "Use a valid Remote Brain hostname, port and HTTPS fingerprint",
          { cause: error },
        );
      }
    }
    if (digest(bytes(this.file)) !== request.expectedRevision)
      throw new BrainConnectionError(
        "conflict",
        "Brain connection settings changed; reload before saving",
      );
    try {
      writePrivateFileAtomicSync(
        this.file,
        `${JSON.stringify({ ...current.document, brain: connection }, null, 2)}\n`,
      );
      return this.read();
    } catch (error) {
      throw new BrainConnectionError(
        "unknown",
        "Reload Brain connection settings to check whether the save completed",
        { cause: error },
      );
    }
  }
}
