/** Explicit offline re-grading; saved measurements and transcripts are never rewritten. */
import type { Command } from "commander";
import {
  CommandError,
  type AnyCommandResult,
  type OutputSchema,
  type OutputOptions,
} from "../output/types.js";
import { rescoreRun, type RescoreRunResult } from "../bench/rescore.js";
import * as archive from "../ops/archive.js";
import * as results from "../ops/results.js";
import { withCommandSignal } from "./host-command.js";

interface RescoreTask {
  taskId: string;
  before: number | null;
  score: number | null;
  changed: boolean;
  summary: string;
}
interface RescoreRow {
  archiveId: string;
  changed: number;
  tasks: RescoreTask[];
}
function row(result: RescoreRunResult, stored: results.RunRecord[]): RescoreRow {
  const record =
    stored.find((entry) => entry.archiveId === result.archiveId) ??
    stored.find((entry) => result.archiveId.includes(results.slugify(entry.model.displayName)));
  const tasks = result.tasks.map((task) => {
    const before = record?.tasks.find((entry) => entry.id === task.taskId)?.score ?? null;
    return {
      taskId: task.taskId,
      before,
      score: task.score,
      changed: before !== null && task.score !== null && Math.abs(before - task.score) > 0.005,
      summary: task.summary,
    };
  });
  return {
    archiveId: result.archiveId,
    changed: tasks.filter((task) => task.changed).length,
    tasks,
  };
}
function renderRescore(data: RescoreRow | RescoreRow[], options: OutputOptions): string {
  const rows = Array.isArray(data) ? data : [data];
  const lines: string[] = options.noHeaders
    ? []
    : [`${rows.length} archived run(s), re-graded from stored transcripts`, ""];
  for (const run of rows) {
    lines.push(run.archiveId);
    for (const task of run.tasks) {
      if (task.score === null) {
        lines.push(`  ${task.taskId.padEnd(16)} ${task.summary}`);
        continue;
      }
      const before = task.before === null ? "-" : `${(task.before * 100).toFixed(0)}%`;
      lines.push(
        `  ${task.taskId.padEnd(16)} was ${before.padStart(5)}  now ${`${(task.score * 100).toFixed(0)}%`.padStart(5)}${task.changed ? "   <- CHANGED" : ""}   ${task.summary}`,
      );
    }
  }
  lines.push(
    "",
    `${rows.reduce((count, run) => count + run.changed, 0)} task result(s) changed, no GPU used`,
  );
  return lines.join("\n");
}
const schema: OutputSchema<RescoreRow> = {
  idField: "archiveId",
  columns: [
    { header: "ARCHIVE", field: "archiveId" },
    { header: "CHANGED", field: "changed" },
  ],
  renderHuman: renderRescore,
};

export async function runRescoreCommand(
  options: { run?: string; execute?: boolean },
  _command: Command,
): Promise<AnyCommandResult<RescoreRow>> {
  const runs = archive.list();
  if (!runs.length)
    throw new CommandError({
      code: "NO_ARCHIVE",
      message: "no archived transcripts yet",
      details: "run `otto brain bench --model <name>` first",
    });
  if (options.run && !runs.includes(options.run))
    throw new CommandError({
      code: "UNKNOWN_RUN",
      message: "The archived run was not found in this Brain home",
    });
  const targets = options.run ? [options.run] : runs;
  const stored = results.loadAll();
  const data = await withCommandSignal(async (signal) => {
    const rows: RescoreRow[] = [];
    for (const id of targets) {
      signal.throwIfAborted();
      rows.push(row(await rescoreRun(id, { execute: options.execute !== false, signal }), stored));
    }
    return rows;
  });
  return { type: "list", data, schema };
}

export { addRescoreOptions } from "./options.js";
