// "00-" prefix is intentional: this file must sort before every other spec.
// Sessions history is daemon-global — any agent created by a prior spec hides the empty state.
// If the beforeAll probe below fails, a spec sorted before this file is creating agents.
import { test } from "./fixtures";
import { connectSeedClient } from "./helpers/seed-client";
import { expectSessionsEmptyState, openSessions } from "./helpers/archive-tab";
import { moneyShot } from "./helpers/evidence";

test.describe("Sessions screen empty state", () => {
  // This is the first browser test in the shard (the "00-" prefix forces it to
  // sort first so the daemon still has no agent history). Being first, it alone
  // pays the full cold-start cost: the initial Metro web-bundle serve plus the
  // app's first hydration and daemon connect. Locally that single test takes
  // ~30-35s while later, warm tests finish in <10s; on slower CI runners the
  // cold path tips past the default 60s test timeout and the test times out
  // mid-body (during openSessions / the empty-state wait). Give the cold first
  // test extra headroom — later tests keep the default because the app is warm.
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    const client = await connectSeedClient();
    try {
      const history = await client.fetchAgentHistory({ page: { limit: 1 } });
      if (history.entries.length > 0) {
        throw new Error(
          `Sessions empty-state precondition failed: daemon already has ${history.entries.length} agent(s). ` +
            `Either a spec that sorts before 00-sessions-empty.spec.ts created agents, ` +
            `or the daemon has stale history from a previous run.`,
        );
      }
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  test("shows empty placeholder when there is no session history", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "sessions-empty-" });
    await workspace.navigateTo();
    await openSessions(page);
    await expectSessionsEmptyState(page);
    await moneyShot(page, "Sessions shows the empty placeholder, not a session list");
  });
});
