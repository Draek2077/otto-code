import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ChatSearchService } from "./service.js";
import { projectSearchMessages } from "./messages.js";
import type { SearchChat } from "./types.js";
import type { AgentTimelineRow } from "../../../agent/agent-timeline-store-types.js";

const recent: SearchChat = {
  id: "recent",
  title: "Untitled",
  provider: "mock",
  workspaceId: "workspace-a",
  projectId: "project-a",
  projectName: "First",
  archived: false,
};
const legacy: SearchChat = {
  id: "legacy",
  title: "Old chat",
  provider: "codex",
  workspaceId: "workspace-b",
  projectId: "project-b",
  projectName: "Second",
  archived: true,
};
function row(text: string): AgentTimelineRow {
  return { seq: 4, timestamp: "2026-11-10T00:00:00Z", item: { type: "user_message", text } };
}

async function withSearch(
  run: (input: { home: string; service: ChatSearchService; chats: SearchChat[] }) => Promise<void>,
) {
  const home = await mkdtemp(join(tmpdir(), "otto-chat-search-test-"));
  const chats = [recent, legacy];
  const service = new ChatSearchService({
    home,
    logger: createTestLogger(),
    snapshot: () => null,
    list: async () => chats,
  });
  try {
    await run({ home, service, chats });
  } finally {
    await service.close();
    await rm(home, { recursive: true, force: true });
  }
}

test("searches current and frozen-format sources with canonical host project, archive and visibility scope", async () => {
  await withSearch(async ({ home, service, chats }) => {
    const sources = join(home, "chat-search", "sources");
    await mkdir(sources, { recursive: true });
    const messages = projectSearchMessages([row("legacy key lime pie")]);
    const revision = createHash("sha256")
      .update(JSON.stringify({ complete: true, messages }))
      .digest("hex");
    const name = `${createHash("sha256").update(legacy.id).digest("hex")}.json`;
    const source = join(sources, name);
    const frozen = JSON.stringify({
      version: 1,
      agentId: legacy.id,
      revision,
      complete: true,
      messages,
    });
    await writeFile(source, frozen);
    await service.capture(recent.id, { rows: [row("current key lime tart")], complete: true });
    const all = await service.search({ query: "key lime" }, () => true);
    expect(all.hits.map(({ id }) => id).sort()).toEqual(["legacy", "recent"]);
    expect(all.coverage).toEqual({ total: 2, indexed: 2, pending: 0, unavailable: 0 });

    const archived = await service.search(
      { query: "lim", archive: "archived", projectId: "project-b" },
      () => true,
    );
    expect(archived.hits).toMatchObject([{ id: "legacy", messageKey: messages[0].key }]);
    expect((await service.search({ query: "lime" }, (id) => id !== "codex")).hits).toMatchObject([
      { id: "recent" },
    ]);
    expect(await readFile(source, "utf8")).toBe(frozen);

    await service.capture(legacy.id, { rows: [row("partial source")], complete: false });
    expect(
      (await service.search({ query: "lime", archive: "archived" }, () => true)).hits,
    ).toMatchObject([{ id: "legacy" }]);
    await service.capture(legacy.id, { rows: [row("reopened lime transcript")], complete: true });
    expect(
      (await service.search({ query: "reopened", archive: "archived" }, () => true)).hits,
    ).toMatchObject([{ id: "legacy" }]);
    expect(await readFile(source, "utf8")).toBe(frozen);

    // The derived index cannot surface a row whose durable ownership disappeared.
    chats.pop();
    expect((await service.search({ query: "lime" }, () => true)).hits).toMatchObject([
      { id: "recent" },
    ]);
    expect(await readFile(source, "utf8")).toBe(frozen);
  });
});

test("replaces stale keys on rewrite and clears only the intentionally removed source", async () => {
  await withSearch(async ({ service }) => {
    await service.capture(recent.id, { rows: [row("sunflower index fixture")], complete: true });
    expect((await service.search({ query: "sunflower" }, () => true)).hits).toHaveLength(1);
    await service.capture(recent.id, { rows: [row("chamomile revision")], complete: true });
    expect((await service.search({ query: "sunflower" }, () => true)).hits).toEqual([]);
    expect((await service.search({ query: "chamomile" }, () => true)).hits).toHaveLength(1);
    await service.forget(recent.id);
    const deleted = await service.search({ query: "chamomile" }, () => true);
    expect(deleted.hits).toEqual([]);
    expect(deleted.coverage).toMatchObject({ indexed: 0, unavailable: 2 });
  });
});
