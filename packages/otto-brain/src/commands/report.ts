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

interface ReportOutput {
  file: string;
  count: number;
  columns: results.TaskColumn[];
  models: Array<{
    id: string | null;
    displayName: string;
    overall: number;
    tasks: Array<{ id: string; category: string; score: number }>;
  }>;
}
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
  const records = results.latestPerConfig();
  if (!records.length)
    throw new CommandError({
      code: "NO_RESULTS",
      message: "no results yet",
      details: "run `otto brain bench --model <name>` first",
    });
  const written = report.write(options.out);
  return {
    type: "single",
    schema,
    data: {
      ...written,
      columns: results.taskColumns(records),
      models: records.map((record) => ({
        id: record.model.id,
        displayName: record.model.displayName,
        overall: record.overall,
        tasks: record.tasks.map(({ id, category, score }) => ({ id, category, score })),
      })),
    },
  };
}

export { addReportOptions } from "./options.js";
