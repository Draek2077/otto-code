import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ArchifyQualityProfile = "standard" | "showcase";

export interface DeliverArchitectureFileInput {
  specificationPath: string;
  htmlPath: string;
  quality?: ArchifyQualityProfile;
}

export interface DeliveredArchitectureDocument {
  htmlPath: string;
  specificationPath: string;
  receipt: ArchifyDeliveryReceipt;
}

export interface ArchifyDeliveryReceipt {
  ok: boolean;
  [key: string]: unknown;
}

export class ArchifyDeliveryError extends Error {
  readonly receipt: ArchifyDeliveryReceipt | null;
  readonly stderr: string;

  constructor(message: string, receipt: ArchifyDeliveryReceipt | null, stderr: string) {
    super(message);
    this.name = "ArchifyDeliveryError";
    this.receipt = receipt;
    this.stderr = stderr;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReceipt(stdout: string): ArchifyDeliveryReceipt | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isRecord(parsed) && typeof parsed.ok === "boolean"
      ? (parsed as ArchifyDeliveryReceipt)
      : null;
  } catch {
    return null;
  }
}

function resolveArchifyCliPath(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const packagedCliPath = join(moduleDirectory, "vendor", "archify", "bin", "archify.mjs");
  if (existsSync(packagedCliPath)) return packagedCliPath;

  const sourceCliPath = resolve(
    moduleDirectory,
    "..",
    "..",
    "..",
    "..",
    "..",
    "vendor",
    "archify",
    "archify",
    "bin",
    "archify.mjs",
  );
  if (existsSync(sourceCliPath)) return sourceCliPath;

  throw new Error("The vendored Archify renderer is unavailable.");
}

async function runArchifyDeliver(
  cliPath: string,
  specificationPath: string,
  htmlPath: string,
  quality: ArchifyQualityProfile,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "deliver",
        "architecture",
        specificationPath,
        htmlPath,
        "--quality",
        quality,
        "--json",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolveRun({ stdout, stderr, exitCode });
    });
  });
}

/**
 * Daemon-owned entry point for the deterministic Architecture renderer.
 * The caller owns both paths through a managed Knowledge store; this adapter
 * never opens a local server or an OS browser.
 */
export class ArchifyRenderer {
  async deliverArchitectureFile(
    input: DeliverArchitectureFileInput,
  ): Promise<DeliveredArchitectureDocument> {
    if (!isAbsolute(input.specificationPath) || !isAbsolute(input.htmlPath)) {
      throw new Error("Architectural View paths must be absolute.");
    }
    if (extname(input.specificationPath).toLowerCase() !== ".json") {
      throw new Error("Architectural View specifications must be JSON files.");
    }
    if (extname(input.htmlPath).toLowerCase() !== ".html") {
      throw new Error("Architectural View output must be an HTML file.");
    }

    const specificationPath = resolve(input.specificationPath);
    const htmlPath = resolve(input.htmlPath);

    const result = await runArchifyDeliver(
      resolveArchifyCliPath(),
      specificationPath,
      htmlPath,
      input.quality ?? "showcase",
    );
    const receipt = parseReceipt(result.stdout);
    if (result.exitCode !== 0 || receipt?.ok !== true) {
      throw new ArchifyDeliveryError(
        receipt
          ? "Archify rejected the architecture document."
          : "Archify did not return a valid receipt.",
        receipt,
        result.stderr,
      );
    }

    await readFile(htmlPath, "utf8");
    return { htmlPath, specificationPath, receipt };
  }
}
