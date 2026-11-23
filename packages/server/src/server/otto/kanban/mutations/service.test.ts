import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  type BoardMutationIntent,
  type EditableBoard,
  type Result,
} from "@getpaseo/plugin/otto/kanban";
import {
  BoardMutationService,
  type MutationPorts,
  type ProviderMutationResult,
} from "./service.js";
import { FileMutationStore } from "./store.js";

const parent = fileURLToPath(new URL("../../../../../../../.tmp/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected mutation fixture root");
    await rm(root, { recursive: true });
  }
});
function intent(): BoardMutationIntent {
  return {
    binding: { hostId: "host", projectId: "project" },
    operationId: "operation-00000001",
    boardId: "board",
    expectedSettingsRevision: "settings-1",
    expectedBoardRevision: "board-1",
    mutation: {
      kind: "create",
      title: "New card",
      description: "Private draft contents",
      columnId: "todo",
    },
  };
}
function board(): EditableBoard {
  return {
    board: {
      provider: "github",
      id: "board",
      title: "Board",
      url: null,
      revision: "board-1",
      capabilities: { read: true, create: true, link: true, move: true, edit: true, remove: true },
      columns: [{ id: "todo", title: "Todo" }],
      cards: [
        {
          id: "card",
          title: "Card",
          description: "",
          url: null,
          columnId: "todo",
          kind: "Issue",
          assignees: [],
          archived: false,
        },
      ],
    },
    fields: [
      {
        id: "priority",
        name: "Priority",
        kind: "choice",
        choices: [{ id: "high", label: "High" }],
      },
    ],
    cardFields: {
      card: [
        {
          fieldId: "priority",
          editable: true,
          display: "High",
          value: { kind: "choice", id: "high" },
        },
      ],
    },
    cardRevisions: { card: "card-1" },
    allowedMoves: { card: ["todo"] },
  };
}
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "kanban-mutation-"));
  roots.push(root);
  const state = {
    snapshot: board(),
    settingsRevision: "settings-1",
    reads: 0,
    writes: 0,
    checks: 0,
    failReadAfterWrite: false,
  };
  const effects = {
    execute: async (): Promise<ProviderMutationResult> => ({ status: "applied" }),
    check: async (): Promise<Result<true>> => ({ ok: true, value: true }),
  };
  const store = new FileMutationStore(root);
  const ports: MutationPorts = {
    hostId: "host",
    store,
    read: async () => {
      state.reads++;
      if (state.failReadAfterWrite && state.writes)
        return { ok: false, error: { code: "unavailable", message: "Refresh failed" } };
      return {
        ok: true,
        value: { settingsRevision: state.settingsRevision, snapshot: state.snapshot },
      };
    },
    checkSettings: async () => {
      state.checks++;
      return effects.check();
    },
    execute: async () => {
      state.writes++;
      return effects.execute();
    },
  };
  return { root, state, store, ports, effects, service: new BoardMutationService(ports) };
}
it("durably admits once, rereads truth and replays without creating another card after restart", async () => {
  const f = await fixture();
  const result = await f.service.execute(intent());
  expect(result).toEqual({
    status: "applied",
    operationId: intent().operationId,
    snapshot: f.state.snapshot,
  });
  expect(f.state.reads).toBe(2);
  expect(f.state.checks).toBe(1);
  const replay = await new BoardMutationService(f.ports).execute(intent());
  expect(replay.status).toBe("applied");
  expect(f.state.writes).toBe(1);
  const files = await readdir(f.root);
  expect(files).toHaveLength(1);
  const bytes = await readFile(path.join(f.root, files[0]!), "utf8");
  expect(bytes).not.toContain("Private draft contents");
  expect(JSON.parse(bytes).state).toBe("applied");
});
it("serializes identical concurrent intents and never performs duplicate writes", async () => {
  const f = await fixture();
  const outcomes = await Promise.all([f.service.execute(intent()), f.service.execute(intent())]);
  expect(outcomes.map((value) => value.status)).toEqual(["applied", "applied"]);
  expect(f.state.writes).toBe(1);
});
it("rejects operation ID reuse with different content", async () => {
  const f = await fixture();
  await f.service.execute(intent());
  const changed = {
    ...intent(),
    mutation: {
      ...intent().mutation,
      kind: "create" as const,
      title: "Different",
      description: "",
      columnId: null,
    },
  };
  expect(await f.service.execute(changed)).toMatchObject({
    status: "rejected",
    error: { code: "revision_conflict" },
  });
  expect(f.state.writes).toBe(1);
});
it.each(["admitted", "uncertain"] as const)(
  "never repeats a %s operation even after a host restart",
  async (state) => {
    const f = await fixture();
    await f.service.execute(intent());
    const record = await f.store.read(intent());
    if (!record) throw new Error("Expected durable record");
    await f.store.save(intent(), { ...record, state });
    expect(await new BoardMutationService(f.ports).execute(intent())).toMatchObject({
      status: "reconciliation_required",
    });
    expect(f.state.writes).toBe(1);
  },
);
it("preserves an unknown write outcome and never retries a throwing provider", async () => {
  const f = await fixture();
  f.effects.execute = async () => {
    throw new Error("Response lost after commit");
  };
  expect((await f.service.execute(intent())).status).toBe("reconciliation_required");
  expect((await f.service.execute(intent())).status).toBe("reconciliation_required");
  expect(f.state.writes).toBe(1);
  expect((await f.store.read(intent()))?.state).toBe("admitted");
});
it("returns uncertain if accepted write reconciliation fails, and a later replay only rereads", async () => {
  const f = await fixture();
  f.state.failReadAfterWrite = true;
  expect((await f.service.execute(intent())).status).toBe("reconciliation_required");
  f.state.failReadAfterWrite = false;
  expect((await f.service.execute(intent())).status).toBe("applied");
  expect(f.state.writes).toBe(1);
});
it("keeps a proven pre-write rejection as a rejection on replay", async () => {
  const f = await fixture();
  f.effects.execute = async () => ({
    status: "rejected",
    error: { code: "access_denied", message: "No write access" },
  });
  expect(await f.service.execute(intent())).toMatchObject({
    status: "rejected",
    error: { code: "access_denied" },
  });
  expect(await new BoardMutationService(f.ports).execute(intent())).toMatchObject({
    status: "rejected",
    error: { code: "access_denied" },
  });
  expect(f.state.writes).toBe(1);
});
it("refuses another host before reads, admission or provider effects", async () => {
  const f = await fixture();
  expect(
    await f.service.execute({ ...intent(), binding: { hostId: "other", projectId: "project" } }),
  ).toMatchObject({ status: "rejected", error: { code: "wrong_host" } });
  expect([f.state.reads, f.state.writes]).toEqual([0, 0]);
  expect(await readdir(f.root)).toEqual([]);
});
it.each(["settings", "board", "card"])(
  "rejects stale %s revisions before admission",
  async (kind) => {
    const f = await fixture();
    const input = intent();
    if (kind === "settings") input.expectedSettingsRevision = "old";
    if (kind === "board") input.expectedBoardRevision = "old";
    if (kind === "card")
      input.mutation = {
        kind: "move",
        cardId: "card",
        expectedCardRevision: "old",
        columnId: "todo",
      };
    expect(await f.service.execute(input)).toMatchObject({
      status: "rejected",
      error: { code: "revision_conflict" },
    });
    expect(f.state.writes).toBe(0);
    expect(await readdir(f.root)).toEqual([]);
  },
);
it("revalidates settings after admission without writing if the target changed", async () => {
  const f = await fixture();
  f.effects.check = async () => ({
    ok: false,
    error: { code: "revision_conflict", message: "Target changed" },
  });
  expect(await f.service.execute(intent())).toMatchObject({
    status: "rejected",
    error: { code: "revision_conflict" },
  });
  expect(f.state.writes).toBe(0);
  expect((await f.store.read(intent()))?.state).toBe("rejected");
});
it("leaves a corrupt admission record unchanged and never writes", async () => {
  const f = await fixture();
  await f.service.execute(intent());
  const files = await readdir(f.root);
  const file = path.join(f.root, files[0]!);
  await writeFile(file, "{corrupt");
  expect((await new BoardMutationService(f.ports).execute(intent())).status).toBe(
    "reconciliation_required",
  );
  expect(f.state.writes).toBe(1);
  expect(await readFile(file, "utf8")).toBe("{corrupt");
});
it("refuses inaccessible cards and invalid per-card fields or transitions", async () => {
  const f = await fixture();
  const input = intent();
  input.mutation = { kind: "remove", cardId: "missing", expectedCardRevision: "card-1" };
  expect(await f.service.execute(input)).toMatchObject({
    status: "rejected",
    error: { code: "not_found" },
  });
  input.mutation = {
    kind: "move",
    cardId: "card",
    expectedCardRevision: "card-1",
    columnId: "forbidden",
  };
  expect(await f.service.execute(input)).toMatchObject({
    status: "rejected",
    error: { code: "unsupported" },
  });
  input.mutation = {
    kind: "edit",
    cardId: "card",
    expectedCardRevision: "card-1",
    fieldId: "priority",
    value: { kind: "choice", id: "unknown" },
  };
  expect(await f.service.execute(input)).toMatchObject({
    status: "rejected",
    error: { code: "unsupported" },
  });
  expect(f.state.writes).toBe(0);
});
