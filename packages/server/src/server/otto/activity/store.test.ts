import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, expect, it } from "vitest";
import {
  activityMethods,
  ActivitySummarySchema,
  UsageLogPageSchema,
} from "@getpaseo/protocol/otto/activity";
import { ActivityStore } from "./store.js";
import { openCodeActivityUsage } from "./opencode-usage.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), "otto-activity-"));
  directories.push(home);
  const create = () => new ActivityStore(home, pino({ enabled: false }));
  return {
    create,
    store: create(),
    counts: path.join(home, "activity-stats.json"),
    log: path.join(home, "usage-log.json"),
  };
}

it("keeps the 0.9 all-time totals and applies the local 30-day detail window", async () => {
  const { counts, log, store } = await fixture();
  await writeFile(
    counts,
    JSON.stringify({
      version: 1,
      allTime: { messagesSent: 9, tokensSent: 1230, outsideThisClient: 7 },
      daily: { "2020-01-01": { messagesSent: 9 } },
    }),
  );
  const base = { kind: "chat", provider: "claude", tokensIn: 2, tokensOut: 3 };
  await writeFile(
    log,
    JSON.stringify({
      version: 1,
      events: [
        { ...base, id: "expired", at: 0 },
        { ...base, id: "retained", at: Date.now(), rounds: 4 },
      ],
    }),
  );
  const summary = ActivitySummarySchema.parse(await store.invoke(activityMethods.summary, {}));
  const page = UsageLogPageSchema.parse(await store.invoke(activityMethods.log, {}));
  expect(summary).toEqual({
    today: {},
    yesterday: {},
    last7Days: {},
    last30Days: {},
    allTime: { messagesSent: 9, tokensSent: 1230, outsideThisClient: 7 },
  });
  expect(page.events.map(({ id, rounds }) => [id, rounds])).toEqual([["retained", 4]]);
  await store.flush();
  expect(
    JSON.parse(await readFile(log, "utf8")).events.map(({ id }: { id: string }) => id),
  ).toEqual(["retained"]);
});

it("books one turn to both the ledger and summary and counts tool status changes once", async () => {
  const { create, store } = await fixture();
  store.incrementOnce("toolsCalled", "a", "tool-call");
  store.incrementOnce("toolsCalled", "a", "tool-call");
  store.record({
    agentId: "a",
    provider: "claude",
    model: "example",
    kind: "chat",
    usage: {
      inputTokens: 31,
      cachedInputTokens: 13,
      cacheCreationInputTokens: 9,
      outputTokens: 8,
      totalCostUsd: 0.005,
    },
  });
  await store.flush();
  const current = create();
  const summary = ActivitySummarySchema.parse(await current.invoke(activityMethods.summary, {}));
  const page = UsageLogPageSchema.parse(await current.invoke(activityMethods.log, {}));
  expect(summary.today).toEqual({
    toolsCalled: 1,
    tokensSent: 53,
    tokensReceived: 8,
    costMicroUsd: 5000,
    claudeTokensIn: 53,
    claudeTokensOut: 8,
    mainChatTokensIn: 53,
    mainChatTokensOut: 8,
    mainChatCostMicroUsd: 5000,
  });
  expect(page.events).toEqual([
    {
      id: expect.any(String),
      at: expect.any(Number),
      kind: "chat",
      provider: "claude",
      model: "example",
      agentId: "a",
      tokensIn: 53,
      cachedTokensIn: 13,
      tokensOut: 8,
      costMicroUsd: 5000,
    },
  ]);
  await current.invoke(activityMethods.reset, {});
  const reopened = create();
  expect(await reopened.invoke(activityMethods.log, {})).toEqual({ events: [], next: null });
  expect(
    ActivitySummarySchema.parse(await reopened.invoke(activityMethods.summary, {})).allTime,
  ).toEqual({});
});

it("books only the difference in OpenCode session totals and keeps generation separate", async () => {
  const { store } = await fixture();
  const base = {
    cost: 1,
    tokens: { input: 40, output: 30, reasoning: 0, cache: { read: 800, write: 7 } },
  };
  const end = {
    cost: 1.125,
    tokens: { input: 55, output: 37, reasoning: 0, cache: { read: 820, write: 10 } },
  };
  store.record({
    provider: "opencode",
    kind: "generation",
    subtype: "PR description",
    usage: openCodeActivityUsage(base, end),
  });
  await store.flush();
  const summary = ActivitySummarySchema.parse(await store.invoke(activityMethods.summary, {}));
  const page = UsageLogPageSchema.parse(await store.invoke(activityMethods.log, {}));
  expect(summary.today).toEqual({
    tokensSent: 38,
    tokensReceived: 7,
    costMicroUsd: 125000,
    generationsTokensIn: 38,
    generationsTokensOut: 7,
    generationsCostMicroUsd: 125000,
  });
  expect(page.events).toMatchObject([
    {
      kind: "generation",
      subtype: "PR description",
      tokensIn: 38,
      cachedTokensIn: 20,
      tokensOut: 7,
    },
  ]);
});

it("paginates distinct rows with the same timestamp exactly once", async () => {
  const { log, store } = await fixture();
  const at = Date.now();
  const ids = Array.from({ length: 102 }, (_, index) => String(index).padStart(3, "0"));
  await writeFile(
    log,
    JSON.stringify({
      version: 1,
      events: ids.map((id) => ({ id, at, kind: "chat", provider: "claude" })),
    }),
  );
  const first = UsageLogPageSchema.parse(await store.invoke(activityMethods.log, {}));
  const second = UsageLogPageSchema.parse(
    await store.invoke(activityMethods.log, { before: first.next }),
  );
  expect([...first.events, ...second.events].map(({ id }) => id)).toEqual(ids);
  expect(second.next).toBeNull();
});

it("preserves a damaged legacy store during writes and reset", async () => {
  const { counts, store } = await fixture();
  await writeFile(counts, "{old broken");
  store.increment("agentsCreated");
  await expect(store.flush()).rejects.toThrow("The original files are preserved");
  await expect(store.invoke(activityMethods.reset, {})).rejects.toThrow(
    "The original files are preserved",
  );
  expect(await readFile(counts, "utf8")).toBe("{old broken");
});
