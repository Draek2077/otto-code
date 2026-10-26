import { expect, test, vi } from "vitest";
import type { ContextRefinementSet, ContextReport } from "@getpaseo/plugin/otto/context-management";
import {
  ContextCompactionModel,
  keptContextText,
  type ContextCompactionPort,
} from "./compaction-model";
import { ContextEdgeEdit } from "./edge-edit";

const set: ContextRefinementSet = {
  documents: [
    {
      nodeId: "root",
      label: "AGENTS.md",
      text: "ORIGINAL",
      revision: "root-origin",
      scope: "project",
      writable: true,
      readOnlyReason: null,
    },
  ],
  references: [
    { nodeId: "reference", label: "reference.md", revision: "ref-origin", characters: 20 },
  ],
  omittedReferences: 0,
};
const nodes: ContextReport["nodes"] = ["root", "reference", "second"].map((id) => ({
  id,
  label: id === "root" ? "AGENTS.md" : `${id}.md`,
  revision: "metadata",
  scope: "project",
  costClass: "fixed",
  characters: 10,
  estimatedTokens: 3,
  editable: true,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function fixture(value = set) {
  const read = vi.fn(async () => value);
  const propose = vi.fn<ContextCompactionPort["propose"]>(async (input) => ({
    files: input.documents.map((file) => ({
      nodeId: file.nodeId,
      base: file.text,
      proposal: "COMPACTED",
    })),
    inputCharacters: 28,
  }));
  const apply = vi.fn<ContextCompactionPort["apply"]>(async () => ({
    ok: true,
    files: [
      {
        nodeId: "root",
        label: "AGENTS.md",
        status: "changed",
        revision: "accepted",
        message: "Saved",
      },
    ],
  }));
  const model = new ContextCompactionModel(nodes, "root", { read, propose, apply });
  const release = model.activate();
  await Promise.resolve();
  const lane = new ContextEdgeEdit();
  lane.activate();
  return { model, read, propose, apply, release, lane };
}
test("opening a compaction reads the nominated set and never generates or writes", async () => {
  const f = await fixture();
  expect(f.read).toHaveBeenCalledWith(["root"], ["reference", "second"]);
  expect(f.propose).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.model.getSnapshot()).toMatchObject({
    loaded: true,
    busy: false,
    setChanged: false,
    documents: [{ working: "ORIGINAL", diff: null }],
  });
});
test("proposals are inert and hunks are dropped until explicitly kept; subsequent rounds preserve the original host revision", async () => {
  const f = await fixture();
  await f.model.generate();
  expect(f.model.changedFiles()).toEqual([]);
  const document = f.model.getSnapshot().documents[0]!;
  expect(keptContextText(document)).toBe("ORIGINAL");
  f.model.toggle("root", document.diff!.hunks[0]!.id);
  expect(f.model.changedFiles()).toEqual([
    { nodeId: "root", expectedRevision: "root-origin", text: "COMPACTED" },
  ]);
  await f.model.generate();
  expect(f.propose).toHaveBeenCalledTimes(1);
  f.model.reviewKeptResult();
  f.model.setInstruction("Tighten further without dropping any instruction.");
  await f.model.generate();
  expect(f.propose).toHaveBeenLastCalledWith(
    expect.objectContaining({
      documents: [{ nodeId: "root", expectedRevision: "root-origin", text: "COMPACTED" }],
    }),
  );
  expect(f.apply).not.toHaveBeenCalled();
});
test("explicitly widening the set requires a canonical reload and retained proposals survive a declined discard/read failure", async () => {
  const f = await fixture();
  await f.model.generate();
  f.model.setRole("second", "rewrite");
  expect(f.model.getSnapshot().setChanged).toBe(true);
  await f.model.generate();
  expect(f.propose).toHaveBeenCalledTimes(1);
  expect(await f.model.load(async () => false)).toBe(false);
  expect(f.read).toHaveBeenCalledTimes(1);
  f.read.mockRejectedValueOnce(Error("Host disconnected"));
  expect(await f.model.load(async () => true)).toBe(false);
  expect(f.model.getSnapshot()).toMatchObject({ setChanged: true, error: "Host disconnected" });
  expect(f.model.getSnapshot().documents[0]!.diff).not.toBeNull();
  expect(await f.model.load(async () => true)).toBe(true);
  expect(f.read).toHaveBeenLastCalledWith(["root", "second"], ["reference"]);
  expect(f.model.getSnapshot()).toMatchObject({
    setChanged: false,
    error: "",
    documents: [{ diff: null }],
  });
});
test("provider selections retain captured labels and only an explicit Generate supplies the preferred model", async () => {
  const f = await fixture();
  const selection = {
    provider: "openai-compatible",
    model: "opaque/model",
    providerLabel: "My local connection",
    modelLabel: "My selected model",
  };
  f.model.selectModel(selection);
  expect(f.model.getSnapshot().selection).toEqual(selection);
  expect(f.propose).not.toHaveBeenCalled();
  await f.model.generate();
  expect(f.propose).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: { provider: "openai-compatible", model: "opaque/model" },
      references: [{ nodeId: "reference", expectedRevision: "ref-origin" }],
    }),
  );
});
test("declined applies and hidden confirmations never dispatch a filesystem write", async () => {
  const f = await fixture();
  await f.model.generate();
  f.model.toggle("root", f.model.getSnapshot().documents[0]!.diff!.hunks[0]!.id);
  await f.model.apply(
    f.lane,
    async () => false,
    () => {},
  );
  expect(f.apply).not.toHaveBeenCalled();
  const yes = deferred<boolean>();
  const task = f.model.apply(
    f.lane,
    () => yes.promise,
    () => {},
  );
  f.release();
  f.model.activate();
  yes.resolve(true);
  await task;
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.model.changedFiles()[0]!.text).toBe("COMPACTED");
});
test("accepted applies serialize through the page lane, report outcomes and block replay until explicit reviewed reload", async () => {
  const f = await fixture({
    ...set,
    documents: [{ ...set.documents[0]!, scope: "host", label: "~/AGENTS.md" }],
  });
  await f.model.generate();
  f.model.toggle("root", f.model.getSnapshot().documents[0]!.diff!.hunks[0]!.id);
  const confirm = vi.fn(async () => true),
    changed = vi.fn();
  await f.model.apply(f.lane, confirm, changed);
  await f.model.apply(f.lane, confirm, changed);
  expect(confirm).toHaveBeenCalledWith(["~/AGENTS.md"]);
  expect(f.apply).toHaveBeenCalledExactlyOnceWith({
    documents: [{ nodeId: "root", expectedRevision: "root-origin", text: "COMPACTED" }],
    userApprovedGlobal: true,
  });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(f.model.getSnapshot()).toMatchObject({ blocked: true, outcomes: [{ status: "changed" }] });
  expect(f.lane.getSnapshot()).toMatchObject({ blocked: true, saved: true });
});
test("hidden generation and apply replies cannot replace a later activation or acknowledge uncertain writes", async () => {
  const f = await fixture(),
    proposal = deferred<Awaited<ReturnType<ContextCompactionPort["propose"]>>>();
  f.propose.mockReturnValueOnce(proposal.promise);
  const generating = f.model.generate();
  f.release();
  const hideAgain = f.model.activate();
  proposal.resolve({
    files: [{ nodeId: "root", base: "ORIGINAL", proposal: "HIDDEN" }],
    inputCharacters: 28,
  });
  await generating;
  expect(f.model.getSnapshot().documents[0]!.diff).toBeNull();
  await f.model.generate();
  f.model.toggle("root", f.model.getSnapshot().documents[0]!.diff!.hunks[0]!.id);
  const result = deferred<Awaited<ReturnType<ContextCompactionPort["apply"]>>>();
  f.apply.mockReturnValueOnce(result.promise);
  const changed = vi.fn(),
    task = f.model.apply(f.lane, async () => true, changed);
  await Promise.resolve();
  hideAgain();
  f.model.activate();
  result.resolve({
    ok: true,
    files: [
      {
        nodeId: "root",
        label: "AGENTS.md",
        revision: "hidden",
        status: "changed",
        message: "Saved",
      },
    ],
  });
  await task;
  expect(changed).not.toHaveBeenCalled();
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: true,
    outcomes: [],
    error: expect.stringContaining("may have changed"),
  });
  expect(f.model.getSnapshot().documents[0]!.file.revision).toBe("root-origin");
});
test("base mismatches and failed applies retain review text and cannot retry or adopt peer revisions", async () => {
  const f = await fixture();
  f.propose.mockResolvedValueOnce({
    files: [{ nodeId: "root", base: "FOREIGN", proposal: "BAD" }],
    inputCharacters: 1,
  });
  await f.model.generate();
  expect(f.model.getSnapshot()).toMatchObject({
    error: expect.stringContaining("base differs"),
    documents: [{ working: "ORIGINAL", diff: null }],
  });
  await f.model.generate();
  f.model.toggle("root", f.model.getSnapshot().documents[0]!.diff!.hunks[0]!.id);
  f.apply.mockResolvedValueOnce({ ok: false, message: "Peer revision changed" });
  await f.model.apply(
    f.lane,
    async () => true,
    () => {},
  );
  await f.model.apply(
    f.lane,
    async () => true,
    () => {},
  );
  expect(f.apply).toHaveBeenCalledTimes(1);
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: true,
    documents: [{ file: { revision: "root-origin" } }],
  });
  expect(f.model.changedFiles()[0]!.text).toBe("COMPACTED");
});
