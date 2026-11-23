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
import { withCommandSignal, withCommandHost, waitForCommandJob } from "./host-command.js";
import { selectedBrainCommandHost } from "./target.js";
import {
  RescoreOptionsSchema,
  RescoreRowsSchema,
  RescoreAdmissionSchema,
  type RescoreRow,
} from "./rescore-contract.js";
import { z } from "zod/v3";

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
  const controls = RescoreOptionsSchema.parse({ run: options.run, execute: options.execute });
  const data = selectedBrainCommandHost()
    ? await withCommandHost(async (port, signal) => {
        // COMPAT(brainRescore): added in v0.10.0; remove after 2027-04-24 when floor >= v0.10.0.
        if (
          !z
            .object({ rescore: z.literal(true) })
            .safeParse(await port.request("/__host/capabilities", signal)).success
        )
          throw new CommandError({
            code: "UPDATE_HOST",
            message: "Update the Brain owner to rescore saved benchmarks.",
          });
        const admitted = RescoreAdmissionSchema.parse(
          await port.request("/__host/jobs/rescore", signal, controls),
        );
        if (!admitted.ok) throw rescoreError(admitted.code);
        const job = await waitForCommandJob(port, admitted.job.id, signal);
        return RescoreRowsSchema.parse(job.result);
      })
    : await withCommandSignal(prepareOwnerRescore(controls, process.env));
  return { type: "list", data, schema };
}

function rescoreError(code: "NO_ARCHIVE" | "UNKNOWN_RUN"): CommandError {
  if (code === "UNKNOWN_RUN")
    return new CommandError({ code, message: "The archived run was not found in this Brain home" });
  return new CommandError({
    code,
    message: "no archived transcripts yet",
    details: "run `otto brain bench --model <name>` first",
  });
}

/** Preflight captures the owning home's target list; replay remains cancellable and read-only. */
export function prepareOwnerRescore(
  options: { run?: string; execute?: boolean },
  env: NodeJS.ProcessEnv,
) {
  const runs = archive.list(env);
  if (!runs.length) throw rescoreError("NO_ARCHIVE");
  if (options.run && !runs.includes(options.run)) throw rescoreError("UNKNOWN_RUN");
  const targets = options.run ? [options.run] : runs;
  const stored = results.loadAll(env);
  return async (signal: AbortSignal): Promise<RescoreRow[]> => {
    const rows: RescoreRow[] = [];
    for (const id of targets) {
      signal.throwIfAborted();
      rows.push(
        row(await rescoreRun(id, { execute: options.execute !== false, signal, env }), stored),
      );
    }
    return RescoreRowsSchema.parse(rows);
  };
}

export { addRescoreOptions } from "./options.js";
