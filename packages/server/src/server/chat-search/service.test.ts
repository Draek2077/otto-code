import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import pino from "pino";
import { ChatSearchService } from "./service.js";
import type { SearchChat } from "./types.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";

const homes: string[] = [];
const services: ChatSearchService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
const chat: SearchChat = {
  provider: "claude",
  id: "chat1",
  title: "Research",
  workspaceId: "w1",
  projectId: "p1",
  projectName: "Project",
  archived: false,
};
const rows: AgentTimelineRow[] = [
  {
    seq: 1,
    timestamp: "2026-09-24T00:00:00Z",
    item: { type: "user_message", text: "The orchard contains apricots" },
  },
];
async function setup(
  home?: string,
  list = async () => [chat],
  overrides: Partial<ConstructorParameters<typeof ChatSearchService>[0]> = {},
) {
  if (!home) {
    home = await mkdtemp(join(tmpdir(), "otto-chat-search-"));
    homes.push(home);
  }
  const service = new ChatSearchService({
    ottoHome: home,
    logger: pino({ level: "silent" }),
    list,
    snapshot: () => null,
    backfill: async () => rows,
    ...overrides,
  });
  services.push(service);
  return { service, home };
}
test.each(["corrupt", "incompatible"])(
  "repairs a %s index from retained never-opened chat sources after restart",
  async (damage) => {
    const { service, home } = await setup();
    await service.reconcile();
    const first = await service.search({ query: "apricots" });
    expect(first.hits).toHaveLength(1);
    expect(first.coverage).toEqual({ total: 1, indexed: 1, pending: 0, unavailable: 0 });
    await service.close();
    services.pop();
    const indexPath = join(home, "chat-search", "index.sqlite");
    if (damage === "corrupt") {
      await writeFile(indexPath, "broken index");
    } else {
      const moduleName = "node:sqlite";
      const { DatabaseSync } = await import(moduleName);
      const database = new DatabaseSync(indexPath);
      database.exec("PRAGMA user_version=999");
      database.close();
    }
    const reopened = (await setup(home)).service;
    await reopened.reconcile();
    expect((await reopened.search({ query: "apricots" })).hits[0].messageKey).toBe(
      first.hits[0].messageKey,
    );
  },
);

test("detects provider edits even when a completed chat was never opened", async () => {
  let revision = "one";
  let history = rows;
  let reads = 0;
  const { service } = await setup(undefined, undefined, {
    revision: async () => revision,
    backfill: async () => {
      reads++;
      return history;
    },
  });
  await service.reconcile();
  await service.reconcile();
  expect(reads).toBe(1);
  revision = "two";
  history = [{ ...rows[0], item: { type: "user_message", text: "Pears now" } }];
  await service.reconcile();
  expect((await service.search({ query: "apricots" })).hits).toEqual([]);
  expect((await service.search({ query: "pears" })).hits).toHaveLength(1);
  expect(reads).toBe(2);
});

test("repairs missing and valid-JSON-but-corrupt sources without retaining stale hits", async () => {
  const { service, home } = await setup();
  await service.reconcile();
  const directory = join(home, "chat-search", "sources");
  const [file] = await readdir(directory);
  const path = join(directory, file);
  const source = JSON.parse(await readFile(path, "utf8"));
  source.messages[0].text = "Corrupted source text";
  await writeFile(path, JSON.stringify(source));
  expect((await service.search({ query: "apricots" })).hits).toEqual([]);
  await service.reconcile();
  expect((await service.search({ query: "apricots" })).hits).toHaveLength(1);
  await rm(path);
  expect((await service.search({ query: "apricots" })).coverage.pending).toBe(1);
  await service.reconcile();
  expect((await service.search({ query: "apricots" })).coverage.indexed).toBe(1);
});

test("an in-flight provider read cannot resurrect a deleted chat", async () => {
  const entered = Promise.withResolvers<void>();
  const history = Promise.withResolvers<AgentTimelineRow[]>();
  let chats = [chat];
  const { service } = await setup(undefined, async () => chats, {
    backfill: async () => {
      entered.resolve();
      return history.promise;
    },
  });
  const reconciliation = service.reconcile();
  await entered.promise;
  await service.delete(chat.id);
  chats = [];
  history.resolve(rows);
  await reconciliation;
  expect(await service.search({ query: "apricots" })).toEqual({
    hits: [],
    hasMore: false,
    coverage: { total: 0, indexed: 0, pending: 0, unavailable: 0 },
  });
});

test("an in-flight provider read cannot overwrite a newer live replacement", async () => {
  const entered = Promise.withResolvers<void>();
  const history = Promise.withResolvers<AgentTimelineRow[]>();
  const { service } = await setup(undefined, undefined, {
    backfill: async () => {
      entered.resolve();
      return history.promise;
    },
  });
  const reconciliation = service.reconcile();
  await entered.promise;
  service.schedule(chat.id);
  await service.capture(
    chat.id,
    [{ ...rows[0], item: { type: "user_message", text: "Rewound to pears" } }],
    true,
  );
  history.resolve(rows);
  await reconciliation;
  expect((await service.search({ query: "apricots" })).hits).toEqual([]);
  expect((await service.search({ query: "pears" })).hits).toHaveLength(1);
});

test("reports unavailable history instead of a complete empty index and treats query syntax literally", async () => {
  const { service } = await setup(undefined, undefined, { backfill: async () => null });
  await service.reconcile();
  expect((await service.search({ query: '" OR * - ( )' })).coverage).toEqual({
    total: 1,
    indexed: 0,
    pending: 0,
    unavailable: 1,
  });
  await service.capture(chat.id, rows, true);
  expect((await service.search({ query: "apri*" })).hits).toHaveLength(1);
});
test("replaces edits, applies scope moves and prevents deleted registry rows leaking", async () => {
  let chats = [chat];
  const { service } = await setup(undefined, async () => chats);
  await service.reconcile();
  await service.capture(
    chat.id,
    [{ ...rows[0], item: { type: "assistant_message", text: "Peaches replaced the apricots" } }],
    true,
  );
  expect((await service.search({ query: "orchard" })).hits).toEqual([]);
  chats = [{ ...chat, projectId: "p2", archived: true }];
  expect((await service.search({ query: "peaches", projectId: "p1" })).hits).toEqual([]);
  expect((await service.search({ query: "peaches", archive: "archived" })).hits).toHaveLength(1);
  chats = [];
  expect((await service.search({ query: "peaches" })).hits).toEqual([]);
});

test("repairs a lost live source even when its provider has no offline history", async () => {
  const { service, home } = await setup(undefined, undefined, {
    snapshot: () => ({ rows, complete: true, busy: true }),
    backfill: async () => null,
  });
  await service.reconcile();
  const directory = join(home, "chat-search", "sources");
  const [file] = await readdir(directory);
  await rm(join(directory, file));
  await service.reconcile();
  expect((await service.search({ query: "apricots" })).coverage.indexed).toBe(1);
});

test("shutdown cancels a stalled provider read without waiting for provider cooperation", async () => {
  const entered = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  const { service } = await setup(undefined, undefined, {
    backfill: async (_id, suppliedSignal) => {
      signal = suppliedSignal;
      entered.resolve();
      return new Promise(() => {});
    },
  });
  const reconciliation = service.reconcile();
  await entered.promise;
  await service.close();
  await reconciliation;
  expect(signal?.aborted).toBe(true);
});

test("a failed registry read does not delete indexed sources", async () => {
  let fail = false;
  const { service } = await setup(undefined, async () => {
    if (fail) throw new Error("Registry unavailable");
    return [chat];
  });
  await service.reconcile();
  fail = true;
  await expect(service.reconcile()).rejects.toThrow("Registry unavailable");
  fail = false;
  expect((await service.search({ query: "apricots" })).hits).toHaveLength(1);
});
