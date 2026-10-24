/** Explicit report exports and replay use the actual owner home without loading a model. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ReportExportOptionsSchema } from "../commands/report-contract.js";
import { CommandError } from "../output/types.js";
import { readObject, RequestError, sendJson } from "./http-body.js";
import { RescoreOptionsSchema } from "../commands/rescore-contract.js";
import type { BrainJobs } from "./jobs.js";

export class BrainReports {
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly requireWrite: (request: IncomingMessage) => void,
    private readonly jobs: BrainJobs,
  ) {}
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<boolean> {
    const route = request.url?.split("?")[0];
    if (
      request.method !== "POST" ||
      (route !== "/__host/reports/export" && route !== "/__host/jobs/rescore")
    )
      return false;
    this.requireWrite(request);
    if (route === "/__host/jobs/rescore") {
      await this.rescore(request, response, signal);
      return true;
    }
    const options = ReportExportOptionsSchema.safeParse(await readObject(request, signal, 16384));
    if (!options.success) throw new RequestError(400, "Check the report export destination.");
    const { writeOwnerReport } = await import("../commands/report.js");
    signal.throwIfAborted();
    try {
      sendJson(response, 200, { ok: true, report: writeOwnerReport(options.data, this.env) });
    } catch (error) {
      if (!(error instanceof CommandError) || error.code !== "NO_RESULTS") throw error;
      sendJson(response, 200, { ok: false, code: "NO_RESULTS" });
    }
    return true;
  }
  private async rescore(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const options = RescoreOptionsSchema.safeParse(await readObject(request, signal, 16384));
    if (!options.success)
      throw new RequestError(400, "Check the archived run and replay controls.");
    const { prepareOwnerRescore } = await import("../commands/rescore.js");
    signal.throwIfAborted();
    try {
      const run = prepareOwnerRescore(options.data, this.env);
      const job = this.jobs.start(
        "benchmark",
        { modelId: null, catalogModelId: null, repo: null, quant: null },
        async (context) => {
          context.started();
          context.progress({ phase: "start", summary: "Rescoring saved benchmark transcripts" });
          return run(context.signal);
        },
        { benchmarkMode: "rescore" },
      );
      sendJson(response, 202, { ok: true, job });
    } catch (error) {
      if (
        !(error instanceof CommandError) ||
        (error.code !== "NO_ARCHIVE" && error.code !== "UNKNOWN_RUN")
      )
        throw error;
      sendJson(response, 200, { ok: false, code: error.code });
    }
  }
}
