import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/ci.yml", import.meta.url);

function jobBlocks(source) {
  const jobs = new Map();
  let currentJob;

  for (const line of source.split("\n")) {
    const jobMatch = /^  ([a-z0-9-]+):\s*$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs.set(currentJob, []);
      continue;
    }

    if (currentJob && (/^    \S/.test(line) || /^      \S/.test(line))) {
      jobs.get(currentJob).push(line);
    }
  }

  return jobs;
}

test("matrix jobs expand before change gating", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const gatedMatrixJobs = [...jobBlocks(workflow)]
    .filter(([, lines]) => {
      const hasMatrix = lines.some((line) => line.startsWith("      matrix:"));
      const unsafeJobCondition = lines.some(
        (line) => line.startsWith("    if:") && line.trim() !== "if: ${{ !cancelled() }}",
      );
      return hasMatrix && unsafeJobCondition;
    })
    .map(([jobId]) => jobId);

  assert.deepEqual(
    gatedMatrixJobs,
    [],
    "change-based job conditions skip a matrix before GitHub can emit its interpolated check names",
  );
});

test("playwright shard labels match the shard denominator", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const labelled = [...workflow.matchAll(/label: "shard (\d+)\/(\d+)", shard: (\d+)/g)];
  const denominators = [...workflow.matchAll(/--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/g)].map(
    ([, total]) => Number(total),
  );

  assert.ok(labelled.length > 0, "no sharded playwright matrix entries found");
  assert.deepEqual(
    [...new Set(denominators)],
    [labelled.length],
    "the --shard denominator disagrees with how many shards the matrix declares",
  );

  // The label is cosmetic and the `shard:` value is what Playwright receives, so
  // they drift silently: a matrix that says "shard 5/8" while passing shard 4
  // runs one slice twice and never runs the other. Both must agree with the row's
  // position, or a whole slice of the suite goes unrun under a green check.
  assert.deepEqual(
    labelled.map(([, index, total, shard]) => `${index}/${total}:${shard}`),
    labelled.map((_, i) => `${i + 1}/${labelled.length}:${i + 1}`),
    "playwright shard labels, shard numbers, and matrix order must line up",
  );
});

test("playwright's global timeout fires before the job cap kills the shard", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const playwright = jobBlocks(workflow).get("playwright");
  assert.ok(playwright, "no playwright job found");

  const jobCap = /timeout-minutes: (\d+)/.exec(playwright.join("\n"));
  const globalTimeout = /E2E_GLOBAL_TIMEOUT_MINUTES: "(\d+)"/.exec(playwright.join("\n"));
  assert.ok(jobCap, "the playwright job has no timeout-minutes");
  assert.ok(globalTimeout, "the playwright job does not set E2E_GLOBAL_TIMEOUT_MINUTES");

  // Whichever of the two fires first decides what you learn from an overrun. The
  // runner's cap SIGKILLs the shard and discards the report; Playwright's own
  // global timeout stops cleanly and still prints results. Keep them in that
  // order, with room for job setup, or an overrunning shard goes back to
  // reporting nothing but "cancelled".
  assert.ok(
    Number(globalTimeout[1]) < Number(jobCap[1]),
    `E2E_GLOBAL_TIMEOUT_MINUTES (${globalTimeout[1]}) must be below timeout-minutes (${jobCap[1]})`,
  );
});

test("change gating allows superseded workflow runs to cancel", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const cancellationBlockingJobs = [...jobBlocks(workflow)]
    .filter(([, lines]) => lines.some((line) => line.trim().startsWith("${{ always()")))
    .map(([jobId]) => jobId);

  assert.deepEqual(
    cancellationBlockingJobs,
    [],
    "always() keeps jobs alive after concurrency cancellation; use !cancelled() for fail-open gating",
  );
});

test("Android native CI compiles and tests the wake-word distribution", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const jobStart = workflow.indexOf("  android-native-tests:\n");
  const jobEnd = workflow.indexOf("\n  sdk-tests:\n", jobStart);
  assert.ok(jobStart >= 0 && jobEnd > jobStart, "no android-native-tests job found");
  const job = workflow.slice(jobStart, jobEnd);
  assert.match(job, /actions\/setup-java@/);
  assert.match(job, /gradle\/actions\/setup-gradle@/);
  assert.match(job, /:otto-code-expo-two-way-audio:testDebugUnitTest/);
  assert.match(job, /WakeWordHandoffBufferTest/);

  assert.match(workflow, /android_native:\n(?:.|\n)*packages\/expo-two-way-audio\/\*\*/);
});
