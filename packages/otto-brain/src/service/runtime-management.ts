/** Runtime identities and destinations are issued by this host, never by a client. */
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod/v3";
import type { Runtime } from "../types.js";
import type { InstallProgress, RuntimeVariant } from "../runtime/managed.js";
import type { BrainJobs } from "./jobs.js";
import { RequestError, readObject, sendJson } from "./http-body.js";

export interface RuntimeCandidate {
  id: string;
  build: string;
  variant: RuntimeVariant | "auto";
}
export interface RuntimeManagementPorts {
  variants: RuntimeVariant[];
  jobs: BrainJobs;
  list(): Runtime[];
  selected(): Runtime | null;
  selectionRevision(): string;
  select(runtime: Runtime | null, expectedRevision?: string): boolean;
  assertUnused(runtime: Runtime): void;
  remove(runtime: Runtime): void;
  latest(signal: AbortSignal): Promise<string>;
  install(
    build: string,
    variant: RuntimeCandidate["variant"],
    progress: (event: InstallProgress) => void,
    signal: AbortSignal,
  ): Promise<Runtime>;
  diagnose?(runtime: Runtime, signal: AbortSignal): Promise<string | null>;
  changed(): void;
  requireWrite(request: IncomingMessage): void;
}
export function runtimeIdentity(runtime: Runtime): string {
  return `runtime/${createHash("sha256").update(runtime.exe).digest("hex")}`;
}
const ROUTES = new Set([
  "GET /__host/runtimes",
  "POST /__host/runtime/candidate",
  "POST /__host/runtime/select",
  "POST /__host/runtime/remove",
  "POST /__host/jobs/runtime-install",
]);
const VariantSchema = z.enum(["auto", "cuda", "metal", "vulkan", "cpu"]);

export class RuntimeManagement {
  private readonly candidates = new Map<string, RuntimeCandidate>();
  private readonly installing = new Map<string, string>();
  constructor(private readonly ports: RuntimeManagementPorts) {
    if (ports.variants.length) this.offer("latest", "auto");
  }

  list() {
    const selected = this.ports.selected();
    const installed = this.runtimes();
    return {
      runtimes: installed.map((runtime) => ({
        id: runtimeIdentity(runtime),
        label: runtime.label,
        displayName: runtime.displayName ?? runtime.label,
        version: runtime.version,
        source: runtime.source,
        dir: runtime.dir,
        selected: runtime.exe === selected?.exe,
      })),
      candidates: [...this.candidates.values()].map((candidate) => ({
        id: candidate.id,
        build: candidate.build,
        variant: candidate.variant,
      })),
    };
  }

  offer(build: string, variant: RuntimeCandidate["variant"] = "auto"): RuntimeCandidate {
    if (build !== "latest" && !/^b[1-9]\d{0,8}$/.test(build))
      throw new RequestError(400, "Choose an official llama.cpp build tag or latest");
    if (
      !this.ports.variants.length ||
      (variant !== "auto" && !this.ports.variants.includes(variant))
    )
      throw new RequestError(400, "This runtime variant is not available on the host");
    const existing = [...this.candidates.values()].find(
      (candidate) => candidate.build === build && candidate.variant === variant,
    );
    if (existing) return { ...existing };
    if (this.candidates.size >= 64) throw new RequestError(409, "Too many runtime install choices");
    const candidate = { id: `candidate/${randomUUID()}`, build, variant };
    this.candidates.set(candidate.id, candidate);
    return { ...candidate };
  }

  private installed(id: string): Runtime {
    const runtime = this.runtimes().find((entry) => runtimeIdentity(entry) === id);
    if (!runtime) throw new RequestError(404, "Brain runtime not found");
    return runtime;
  }

  select(id: string | null) {
    const runtime = id === null ? null : this.installed(id);
    if (!this.ports.select(runtime))
      throw new RequestError(409, "Runtime selection changed; refresh before selecting it");
    this.ports.changed();
    return { ok: true };
  }

  remove(id: string) {
    const runtime = this.installed(id);
    if (runtime.source !== "managed")
      throw new RequestError(409, "Only Otto-managed runtimes can be removed");
    if (this.ports.selected()?.exe === runtime.exe)
      throw new RequestError(409, "Select another runtime before removing this one");
    this.ports.assertUnused(runtime);
    this.ports.remove(runtime);
    this.ports.changed();
    return { ok: true };
  }

  install(id: string) {
    const candidate = this.candidates.get(id);
    if (!candidate) throw new RequestError(404, "Brain runtime install choice not found");
    if (this.installing.has(id))
      throw new RequestError(409, "This runtime is already being installed");
    const selectionRevision = this.ports.selectionRevision();
    const job = this.ports.jobs.start(
      "runtime-install",
      { modelId: null, catalogModelId: null, repo: null, quant: null },
      async (context) => {
        context.started();
        try {
          const build =
            candidate.build === "latest"
              ? await this.ports.latest(context.signal)
              : candidate.build;
          context.signal.throwIfAborted();
          const runtime = await this.ports.install(
            build,
            candidate.variant,
            (event) =>
              context.progress({
                phase: event.phase,
                receivedBytes: event.receivedBytes ?? null,
                totalBytes: event.totalBytes ?? null,
              }),
            context.signal,
          );
          context.signal.throwIfAborted();
          const warning = (await this.ports.diagnose?.(runtime, context.signal)) ?? null;
          context.signal.throwIfAborted();
          // Update-to-latest restores automatic host selection, without restarting a resident.
          const selectionApplied =
            candidate.build === "latest" && this.ports.select(null, selectionRevision);
          this.ports.changed();
          return {
            runtimeId: runtimeIdentity(runtime),
            version: runtime.version,
            selectionApplied,
            warning,
          };
        } finally {
          this.installing.delete(id);
        }
      },
    );
    this.installing.set(id, job.id);
    return { job };
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<boolean> {
    const route = `${request.method} ${request.url?.split("?")[0]}`;
    if (!ROUTES.has(route)) return false;
    if (route === "GET /__host/runtimes") {
      sendJson(response, 200, this.list());
      return true;
    }
    this.ports.requireWrite(request);
    const body = await readObject(request, signal, 4096);
    if (route === "POST /__host/runtime/candidate") {
      if (typeof body.build !== "string")
        throw new RequestError(400, "A runtime build is required");
      const variant = VariantSchema.safeParse(body.variant ?? "auto");
      if (!variant.success) throw new RequestError(400, "Invalid runtime variant");
      sendJson(response, 200, this.offer(body.build, variant.data));
      return true;
    }
    if (route === "POST /__host/runtime/select" && body.runtimeId === null)
      sendJson(response, 200, this.select(null));
    else {
      if (typeof body.runtimeId !== "string")
        throw new RequestError(400, "A host-issued runtime id is required");
      sendJson(
        response,
        route === "POST /__host/jobs/runtime-install" ? 202 : 200,
        this.mutate(route, body.runtimeId),
      );
    }
    return true;
  }

  private mutate(route: string, id: string) {
    if (route === "POST /__host/runtime/select") return this.select(id);
    if (route === "POST /__host/runtime/remove") return this.remove(id);
    return this.install(id);
  }

  private runtimes(): Runtime[] {
    const installed = [...this.ports.list()];
    const selected = this.ports.selected();
    if (selected && !installed.some((runtime) => runtime.exe === selected.exe))
      installed.push(selected);
    return installed;
  }
}
