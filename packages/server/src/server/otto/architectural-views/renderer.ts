import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ViewKind } from "@getpaseo/plugin/otto/architectural-views";
import { terminateWithTreeKill } from "../../../utils/tree-kill.js";
import { cleanupArtifactOperation, readBounded, safeDirectory } from "../artifacts/files.js";
import { artifactPreview } from "../artifacts/content.js";
import { ArchitecturalViewError, specificationText, viewDigest } from "./specification.js";

const receiptSchema = z.object({ ok: z.boolean() }).passthrough();
const diagnosticsSchema = z
  .array(z.object({ code: z.string(), message: z.string() }).passthrough())
  .max(128);
function renderFailure(
  receipt: z.infer<typeof receiptSchema>,
  directory: string,
  projectRoot: string,
): string {
  const parsed = diagnosticsSchema.safeParse(receipt.diagnostics);
  if (!parsed.success || !parsed.data.length)
    return "The specification failed View validation. Check the diagram contract and geometry.";
  const issues = parsed.data.slice(0, 5).map((issue) => {
    const message = issue.message
      .replaceAll(directory, "<view>")
      .replaceAll(projectRoot, "<project>");
    return `${issue.code.slice(0, 100)}: ${message.slice(0, 500)}`;
  });
  return issues.join("\n");
}
export interface ViewRenderInput {
  diagramType: ViewKind;
  specification: unknown;
  projectRoot: string;
  signal?: AbortSignal;
}
export interface ViewRenderOutput {
  html: string;
  receipt: z.infer<typeof receiptSchema>;
  specificationSha256: string;
}
export function archifyRuntimeDirectory(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = viewRuntimeCandidates(here);
  const found = candidates.find((directory) => existsSync(path.join(directory, "bin/archify.mjs")));
  const required = [
    "assets/template.html",
    "renderers/shared/generated-validators.mjs",
    "schemas/common.schema.json",
    ...["architecture", "workflow", "sequence", "dataflow", "lifecycle"].map(
      (kind) => `schemas/${kind}.schema.json`,
    ),
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ];
  if (!found || required.some((file) => !existsSync(path.join(found, file))))
    throw new ArchitecturalViewError(
      "unavailable",
      "The host's View renderer is missing. Reinstall or update this host.",
    );
  return found;
}
/** Renderer children use physical files, including Electron's unpacked payload. */
export function viewRuntimeCandidates(here: string): string[] {
  const shipped = path.join(here, "vendor/archify");
  const asar = `${path.sep}app.asar${path.sep}`;
  if (shipped.includes(asar))
    return [shipped.replace(asar, `${path.sep}app.asar.unpacked${path.sep}`)];
  return [shipped, path.resolve(here, "../../../../../../vendor/archify/archify")];
}
interface ProcessOutput {
  stdout: string;
  exitCode: number | null;
}
function runRenderer(input: {
  args: string[];
  cwd: string;
  signal: AbortSignal;
}): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: input.cwd,
      TMP: input.cwd,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: "--max-old-space-size=256",
    };
    const child = spawn(process.execPath, input.args, {
      cwd: input.cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bytes = 0;
    let stdout = "";
    let failure: Error | null = null;
    let stopping: Promise<void> | null = null;
    const stop = () => {
      stopping ??= stopRenderer(child).catch((error: unknown) => {
        failure =
          error instanceof Error
            ? error
            : new ArchitecturalViewError("unknown", "Renderer shutdown could not be confirmed.");
      });
    };
    const abort = () => {
      failure = new ArchitecturalViewError(
        "unavailable",
        "View rendering was canceled or exceeded its deadline.",
      );
      stop();
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes <= 262144) stdout += chunk;
      else {
        failure = new ArchitecturalViewError(
          "invalid",
          "The renderer exceeded its diagnostic budget.",
        );
        stop();
      }
    });
    // Drain diagnostics without retaining private paths or arbitrary source text.
    child.stderr.resume();
    child.once("error", reject);
    child.once("close", (exitCode) => {
      input.signal.removeEventListener("abort", abort);
      void Promise.resolve(stopping).then(() => {
        if (failure) return reject(failure);
        return resolve({ stdout, exitCode });
      }, reject);
    });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();
  });
}
async function stopRenderer(child: ChildProcess): Promise<void> {
  const outcome = await terminateWithTreeKill(child, {
    gracefulTimeoutMs: 1000,
    forceTimeoutMs: 2000,
  });
  if (outcome === "kill-timeout")
    throw new ArchitecturalViewError(
      "unavailable",
      "The host has not confirmed renderer shutdown.",
    );
}

/** Construction is inert. No upstream open/preview/browser command is exposed. */
export class ArchitecturalViewRenderer {
  private closed = false;
  private readonly active = new Map<AbortController, Promise<unknown>>();
  constructor(private readonly storage: { boundary: string; scratchRoot: string }) {}

  available(): boolean {
    try {
      archifyRuntimeDirectory();
      return !this.closed;
    } catch (error) {
      if (error instanceof ArchitecturalViewError) return false;
      throw error;
    }
  }
  render(input: ViewRenderInput): Promise<ViewRenderOutput> {
    if (this.closed)
      return Promise.reject(
        new ArchitecturalViewError("unavailable", "The host is shutting down."),
      );
    if (this.active.size >= 2)
      return Promise.reject(
        new ArchitecturalViewError(
          "busy",
          "Two Views are already rendering. Try again when they finish.",
        ),
      );
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 30000);
    const work = this.perform(input, controller.signal).finally(() => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      this.active.delete(controller);
    });
    this.active.set(controller, work);
    return work;
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active.keys()) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(this.active.values()),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ArchitecturalViewError("unavailable", "Renderer shutdown remains unconfirmed."),
              ),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async perform(input: ViewRenderInput, signal: AbortSignal): Promise<ViewRenderOutput> {
    const specification = specificationText(input.diagramType, input.specification);
    const runtime = archifyRuntimeDirectory();
    await safeDirectory(this.storage.boundary, this.storage.scratchRoot, true);
    const directory = await mkdtemp(path.join(this.storage.scratchRoot, "render-"));
    return cleanupArtifactOperation(
      async () => {
        const source = path.join(directory, "source.json");
        const output = path.join(directory, "view.html");
        await writeFile(source, specification, { mode: 0o600 });
        if (signal.aborted)
          throw new ArchitecturalViewError("unavailable", "View rendering was canceled.");
        const args = [
          path.join(runtime, "bin/archify.mjs"),
          "deliver",
          input.diagramType,
          source,
          output,
          "--quality",
          "showcase",
          "--json",
        ];
        if (input.diagramType === "architecture") args.push("--repo-root", input.projectRoot);
        const result = await runRenderer({ args, cwd: directory, signal });
        let raw: unknown;
        try {
          raw = JSON.parse(result.stdout);
        } catch (cause) {
          throw new ArchitecturalViewError(
            "invalid",
            "The renderer did not accept this specification. Check its typed contract.",
            { cause },
          );
        }
        const receipt = receiptSchema.parse(raw);
        if (result.exitCode !== 0 || !receipt.ok)
          throw new ArchitecturalViewError(
            "invalid",
            renderFailure(receipt, directory, input.projectRoot),
          );
        const html = await readBounded(output, 8388608);
        if (!html)
          throw new ArchitecturalViewError("invalid", "The renderer did not produce a View.");
        return {
          html: artifactPreview(html, { maxBytes: 8388608 }),
          receipt,
          specificationSha256: viewDigest(specification),
        };
      },
      async () => {
        const relative = path.relative(
          path.resolve(this.storage.scratchRoot),
          path.resolve(directory),
        );
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
          throw new ArchitecturalViewError(
            "unknown",
            "Renderer scratch ownership changed; inspect the host.",
          );
        await rm(directory, { recursive: true, force: true });
      },
    );
  }
}
