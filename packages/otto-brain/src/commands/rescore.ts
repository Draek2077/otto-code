/**
 * `otto brain rescore` - re-grade archived benchmark transcripts with the current
 * scorer, no GPU used. Surfaces scorer changes against what was recorded live.
 */
import type { Command } from "commander";

import { CommandError } from "../output/types.js";
import { rescoreRun } from "../bench/rescore.js";
import * as archive from "../ops/archive.js";
import * as results from "../ops/results.js";

export function addRescoreOptions(cmd: Command): Command {
  return cmd
    .description("Re-grade archived runs with the current scorer (no GPU)")
    .option("--run <id>", "rescore a single archived run")
    .option("--no-execute", "syntax-check generated code but do not run it");
}

export async function runRescoreCommand(
  options: { run?: string; execute?: boolean },
  _command: Command,
): Promise<void> {
  const runs = archive.list();
  if (!runs.length) {
    throw new CommandError({
      code: "NO_ARCHIVE",
      message: "no archived transcripts yet",
      details: "benchmark runs are archived automatically from now on",
    });
  }

  process.stdout.write(
    `\n${runs.length} archived run(s), ${(archive.size() / 1024 ** 2).toFixed(1)} MB\n\n`,
  );
  const execute = options.execute !== false;
  const stored = results.loadAll();
  const targets = options.run ? [options.run] : runs;

  let changed = 0;
  for (const id of targets) {
    const result = await rescoreRun(id, { execute });
    const record =
      stored.find((r) => r.archiveId === id) ||
      stored.find((r) => id.includes(results.slugify(r.model.displayName)));

    process.stdout.write(`  ${id}\n`);
    for (const task of result.tasks) {
      if (task.score === null) {
        process.stdout.write(`    ${task.taskId.padEnd(16)} ${task.summary}\n`);
        continue;
      }
      const before = record?.tasks.find((t) => t.id === task.taskId);
      const now = `${(task.score * 100).toFixed(0)}%`;
      const then = before ? `${(before.score * 100).toFixed(0)}%` : "-";
      const moved = before && Math.abs(before.score - task.score) > 0.005;
      if (moved) changed += 1;
      process.stdout.write(
        `    ${task.taskId.padEnd(16)} was ${then.padStart(5)}  now ${now.padStart(5)}` +
          `${moved ? "   <- CHANGED" : ""}   ${task.summary}\n`,
      );
    }
    process.stdout.write("\n");
  }

  process.stdout.write(
    `  re-graded from stored transcripts, ${changed} task result(s) changed, no GPU used\n\n`,
  );
}
