/** Explicit offline HTML export from the owning home's saved benchmark history. */
import type { Command } from "commander";
import {
  CommandError,
  type AnyCommandResult,
  type OutputSchema,
  type OutputOptions,
} from "../output/types.js";
import * as report from "../ops/report.js";
import * as results from "../ops/results.js";
import { z } from "zod/v3";
import { selectedBrainCommandHost } from "./target.js";
import { withCommandHost } from "./host-command.js";
import {
  ReportExportReplySchema,
  ReportOutputSchema,
  ReportExportOptionsSchema,
  type ReportOutput,
} from "./report-contract.js";
function renderReport(data: ReportOutput | ReportOutput[], options: OutputOptions): string {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value) return "";
  const pad = (text: string, length: number) => text.padEnd(length);
  const lines = [
    `wrote ${value.file}`,
    `${value.count} run(s) charted, newest per model+config`,
    "",
  ];
  if (!options.noHeaders)
    lines.push(
      `  ${pad("model", 40)}${value.columns.map((column) => column.category.slice(0, 8).padStart(9)).join("")}${"overall".padStart(9)}`,
    );
  for (const model of value.models) {
    const cells = value.columns.map((column) => {
      const task = model.tasks.find((entry) => entry.id === column.id);
      return (task ? `${(task.score * 100).toFixed(0)}%` : "-").padStart(9);
    });
    lines.push(
      `  ${pad(model.displayName.slice(0, 39), 40)}${cells.join("")}${`${(model.overall * 100).toFixed(0)}%`.padStart(9)}`,
    );
  }
  return lines.join("\n");
}
const schema: OutputSchema<ReportOutput> = {
  idField: "file",
  columns: [{ header: "REPORT", field: "file" }],
  renderHuman: renderReport,
};

export async function runReportCommand(
  options: { out?: string },
  _command: Command,
): Promise<AnyCommandResult<ReportOutput>> {
  const data = selectedBrainCommandHost()
    ? await withCommandHost(async (port, signal) => {
        // COMPAT(brainReports): added in v0.10.0; remove after 2027-04-24 when floor >= v0.10.0.
        if (
          !z
            .object({ reports: z.literal(true) })
            .safeParse(await port.request("/__host/capabilities", signal)).success
        )
          throw new CommandError({
            code: "UPDATE_HOST",
            message: "Update the Brain owner to export its reports.",
          });
        const reply = ReportExportReplySchema.parse(
          await port.request(
            "/__host/reports/export",
            signal,
            ReportExportOptionsSchema.parse({ out: options.out }),
          ),
        );
        if (!reply.ok) throw noResults();
        return reply.report;
      })
    : writeOwnerReport(options, process.env);
  return { type: "single", schema, data };
}
function noResults(): CommandError {
  return new CommandError({
    code: "NO_RESULTS",
    message: "no results yet",
    details: "run `otto brain bench --model <name>` first",
  });
}

/** The explicit owner operation receives its environment; it never consults a client's scope. */
export function writeOwnerReport(options: { out?: string }, env: NodeJS.ProcessEnv): ReportOutput {
  const records = results.latestPerConfig(results.loadAll(env));
  if (!records.length) throw noResults();
  const projection = ReportOutputSchema.omit({ file: true }).parse({
    count: records.length,
    columns: results.taskColumns(records),
    models: records.map((record) => ({
      id: record.model.id ?? null,
      displayName: record.model.displayName,
      overall: record.overall,
      tasks: record.tasks.map(({ id, category, score }) => ({ id, category, score })),
    })),
  });
  const written = report.write(options.out, env);
  return { ...projection, ...written };
}

export { addReportOptions } from "./options.js";
