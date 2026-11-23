/** Explicit external endpoint work executes on the selected owner, not its viewer. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrainRuntimeContext } from "./serve.js";
import type { BrainJobs } from "./jobs.js";
import { EndpointBenchmarkRequestSchema, parseBenchmarkEndpoint } from "./benchmark-options.js";
import {
  runOwnedBenchmark,
  publicBenchmarkReport,
  type BenchmarkRunPorts,
} from "./benchmark-run.js";
import { readObject, RequestError, sendJson } from "./http-body.js";
import { CommandError } from "../output/types.js";
import { publishJobProgress } from "./job-progress.js";

export class EndpointBenchmarks {
  constructor(
    private readonly owner: BrainRuntimeContext,
    private readonly jobs: BrainJobs,
    private readonly requireWrite: (request: IncomingMessage) => void,
    private readonly ports: Omit<BenchmarkRunPorts, "env"> = {},
  ) {}
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (request.method !== "POST" || request.url !== "/__host/jobs/benchmark-endpoint")
      return false;
    this.requireWrite(request);
    const input = EndpointBenchmarkRequestSchema.safeParse(
      await readObject(request, signal, 16384),
    );
    if (!input.success) throw new RequestError(400, "Check the endpoint benchmark controls.");
    let endpoint;
    try {
      endpoint = parseBenchmarkEndpoint(input.data.endpoint, this.owner.config.listen.port);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      throw new RequestError(400, error.message, { cause: error });
    }
    signal.throwIfAborted();
    const modelName = endpoint.host.includes(":")
      ? `[${endpoint.host}]:${endpoint.port}`
      : `${endpoint.host}:${endpoint.port}`;
    const job = this.jobs.start(
      "benchmark",
      {
        modelId: null,
        catalogModelId: null,
        repo: null,
        quant: null,
      },
      async (context) => {
        context.started();
        const report = await runOwnedBenchmark(
          input.data.options,
          {
            ...endpoint,
            signal: context.signal,
            onProgress: (event) => publishJobProgress(context, event),
          },
          { ...this.ports, env: this.owner.env },
        );
        context.signal.throwIfAborted();
        return { modelName, report: publicBenchmarkReport(report), profile: null };
      },
    );
    sendJson(response, 202, { job });
    return true;
  }
}
