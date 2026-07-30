/**
 * `otto brain report` — write the HTML comparison report and print a per-model
 * score table (newest run per model+config).
 */
import type { Command } from "commander";

import { CommandError } from "../output/types.js";
import * as report from "../ops/report.js";
import * as results from "../ops/results.js";

export function addReportOptions(cmd: Command): Command {
  return cmd
    .description("Write the HTML comparison report")
    .option("--out <path>", "output HTML path");
}

export async function runReportCommand(
  options: { out?: string },
  _command: Command,
): Promise<void> {
  const records = results.latestPerConfig();
  if (!records.length) {
    throw new CommandError({
      code: "NO_RESULTS",
      message: "no results yet",
      details: "run `otto brain bench --model <name>` first",
    });
  }

  const { file, count } = report.write(options.out);
  process.stdout.write(`\nwrote ${file}\n  ${count} run(s) charted, newest per model+config\n\n`);

  const columns = results.taskColumns(records);
  const pad = (s: string, n: number): string => String(s).padEnd(n);
  process.stdout.write(
    `  ${pad("model", 40)}${columns.map((c) => c.category.slice(0, 8).padStart(9)).join("")}${"overall".padStart(9)}\n`,
  );
  for (const record of records) {
    const cells = columns
      .map((c) => {
        const task = record.tasks.find((t) => t.id === c.id);
        return `${task ? `${(task.score * 100).toFixed(0)}%` : "-"}`.padStart(9);
      })
      .join("");
    process.stdout.write(
      `  ${pad(record.model.displayName.slice(0, 39), 40)}${cells}${`${(record.overall * 100).toFixed(0)}%`.padStart(9)}\n`,
    );
  }
  process.stdout.write("\n");
}
