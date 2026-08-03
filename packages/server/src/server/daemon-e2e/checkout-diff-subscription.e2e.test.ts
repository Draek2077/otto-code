import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { removeTempDir } from "../../test-utils/remove-temp-dir.js";
import { tmpdir } from "os";
import path from "path";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import type { SessionOutboundMessage } from "../messages.js";

type CheckoutDiffUpdatePayload = Extract<
  SessionOutboundMessage,
  { type: "checkout_diff_update" }
>["payload"];

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-checkout-diff-"));
}

function initGitRepo(cwd: string): void {
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd, stdio: "pipe" });
}

function commitFile(cwd: string, fileName: string, content: string): void {
  const filePath = path.join(cwd, fileName);
  writeFileSync(filePath, content);
  execSync(`git add "${fileName}"`, { cwd, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "Initial commit"', {
    cwd,
    stdio: "pipe",
  });
}

async function waitForCheckoutDiffUpdate(
  ctx: DaemonTestContext,
  subscriptionId: string,
  predicate: (payload: CheckoutDiffUpdatePayload) => boolean,
  timeoutMs = 15000,
): Promise<CheckoutDiffUpdatePayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for checkout_diff_update (${subscriptionId})`));
    }, timeoutMs);

    const unsubscribe = ctx.client.on("checkout_diff_update", (message) => {
      if (message.type !== "checkout_diff_update") {
        return;
      }
      if (message.payload.subscriptionId !== subscriptionId) {
        return;
      }
      if (!predicate(message.payload)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(message.payload);
    });
  });
}

let ctx: DaemonTestContext;

beforeEach(async () => {
  ctx = await createDaemonTestContext();
});

afterEach(async () => {
  await ctx.cleanup();
}, 60000);

test("pushes file-level checkout diff updates with deterministic path order", async () => {
  const cwd = tmpCwd();

  try {
    initGitRepo(cwd);
    commitFile(cwd, "base.txt", "base\n");

    const subscriptionId = "checkout-diff-e2e-subscription";
    const initial = await ctx.client.subscribeCheckoutDiff(
      cwd,
      { mode: "uncommitted" },
      { subscriptionId },
    );

    expect(initial.error).toBeNull();
    expect(initial.files).toEqual([]);

    writeFileSync(path.join(cwd, "zeta.txt"), "zeta\n");
    writeFileSync(path.join(cwd, "alpha.txt"), "alpha\n");

    const update = await waitForCheckoutDiffUpdate(ctx, subscriptionId, (payload) => {
      const paths = new Set(payload.files.map((file) => file.path));
      return paths.has("alpha.txt") && paths.has("zeta.txt");
    });

    expect(update.error).toBeNull();
    expect(update.files.map((file) => file.path)).toEqual(["alpha.txt", "zeta.txt"]);

    ctx.client.unsubscribeCheckoutDiff(subscriptionId);
  } finally {
    removeTempDir(cwd);
  }
}, 60000);

test("pushes updates when subscribed from a subdirectory and files change outside it", async () => {
  const cwd = tmpCwd();

  try {
    initGitRepo(cwd);
    commitFile(cwd, "base.txt", "base\n");

    const nestedDir = path.join(cwd, "nested", "dir");
    mkdirSync(nestedDir, { recursive: true });

    const subscriptionId = "checkout-diff-subdir-e2e-subscription";
    const initial = await ctx.client.subscribeCheckoutDiff(
      nestedDir,
      { mode: "uncommitted" },
      { subscriptionId },
    );

    expect(initial.error).toBeNull();
    expect(initial.files).toEqual([]);

    writeFileSync(path.join(cwd, "outside-subdir.txt"), "changed outside\n");

    const update = await waitForCheckoutDiffUpdate(ctx, subscriptionId, (payload) =>
      payload.files.some((file) => file.path === "outside-subdir.txt"),
    );

    expect(update.error).toBeNull();
    expect(update.files.some((file) => file.path === "outside-subdir.txt")).toBe(true);

    ctx.client.unsubscribeCheckoutDiff(subscriptionId);
  } finally {
    removeTempDir(cwd);
  }
}, 60000);

// Regression guard for a silent merge drop. The server-side producer for
// `diffTooLarge` was lost by the v0.2.5 merge (5e3cc1def), which took the
// pre-#2488 checkout-git.ts wholesale. The consumer (checkout-diff-manager.ts),
// the protocol field, and the whole app UI (diff-too-large-state.tsx plus 8
// locales) all survived, so nothing failed to compile and the feature went
// dead in silence. Only an assertion on the producer catches that class of
// loss; keep this test pointed at the daemon's own output.
test("keeps the socket usable after rejecting an oversized structured diff", async () => {
  const cwd = tmpCwd();

  try {
    initGitRepo(cwd);
    // The rejection is keyed off TOTAL_DIFF_MAX_BYTES (2MB) with a separate 1MB
    // per-file cap, so the fixture has to clear 2MB in aggregate while keeping
    // every file under 1MB. Two ~900KB files totalled ~1.8MB and sat UNDER the
    // limit, so this asserted the too-large branch while never reaching it.
    // Four files leaves the margin on the correct side of both caps.
    const largeFiles = ["large-a.js", "large-b.js", "large-c.js", "large-d.js"];
    for (const file of largeFiles) {
      commitFile(cwd, file, "const value = 0;\n");
    }
    const denseExpression = `const value = ${"a+".repeat(450_000)}a;\n`;
    for (const file of largeFiles) {
      writeFileSync(path.join(cwd, file), denseExpression);
    }

    const initial = await ctx.client.subscribeCheckoutDiff(
      cwd,
      { mode: "uncommitted" },
      { subscriptionId: "oversized-checkout-diff" },
    );

    // Assert on a small projection, never on `initial` itself. When this
    // expectation fails the daemon has just built the very payload the guard
    // exists to prevent, and letting the matcher pretty-print it dumped ~934k
    // lines (26MB of "[Object],", one per highlight token) into the run log,
    // which is 99% of the file and buries every other failure in the suite.
    expect({
      cwd: initial.cwd,
      fileCount: initial.files.length,
      diffTooLarge: initial.diffTooLarge,
      errorCode: initial.error?.code ?? null,
    }).toEqual({
      cwd,
      fileCount: 0,
      diffTooLarge: true,
      errorCode: "UNKNOWN",
    });

    const status = await ctx.client.getCheckoutStatus(cwd);
    expect(status).toMatchObject({ cwd, isGit: true });
  } finally {
    removeTempDir(cwd);
  }
}, 120000);
