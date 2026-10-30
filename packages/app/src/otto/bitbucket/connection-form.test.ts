import { expect, it } from "vitest";
import {
  writeBitbucketConnections,
  type BitbucketConnections,
} from "@getpaseo/plugin/otto/bitbucket-connections";
import { openBitbucketConnectionForm } from "./connection-form";

function snapshot(revision = "first"): BitbucketConnections {
  return {
    revision,
    projectId: null,
    selectedId: null,
    hostDefaultId: null,
    projectOverrideId: null,
    connections: [],
  };
}
type Result = ReturnType<typeof writeBitbucketConnections.output.parse>;
function fixture() {
  const calls: ReturnType<typeof writeBitbucketConnections.input.parse>[] = [];
  let settle: (value: Result) => void = () => {
    throw new Error("No pending save");
  };
  const model = openBitbucketConnectionForm(
    "host",
    snapshot(),
    (input) => {
      calls.push(input);
      return new Promise<Result>((resolve) => {
        settle = resolve;
      });
    },
    async () => snapshot("reloaded"),
  );
  model.edit({ label: "Work", email: "work@example.test", replacement: "private-token" });
  return {
    model,
    calls,
    resolve(value: Result) {
      settle(value);
    },
  };
}
it("saves one coherent connection under the originating revision and clears the accepted secret", async () => {
  const f = fixture();
  const saved = f.model.save();
  expect(f.calls).toEqual([
    {
      hostId: "host",
      expectedRevision: "first",
      action: {
        kind: "save",
        label: "Work",
        email: "work@example.test",
        credential: { kind: "replace", value: "private-token" },
        select: true,
      },
    },
  ]);
  f.resolve({ ok: true, value: snapshot("second") });
  await saved;
  expect(f.model.getSnapshot()).toMatchObject({
    origin: { revision: "second" },
    draft: { replacement: "" },
    busy: false,
    editing: false,
  });
});
it("prevents duplicate saves while retaining a failed draft and revision", async () => {
  const f = fixture();
  const pending = f.model.save();
  await f.model.save();
  expect(f.calls).toHaveLength(1);
  f.resolve({ ok: false, error: { kind: "conflict", message: "Changed on host" } });
  await pending;
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: true,
    draft: { label: "Work", replacement: "private-token" },
    origin: { revision: "first" },
    error: "Changed on host",
  });
  await f.model.save();
  expect(f.calls).toHaveLength(1);
});
it("requires explicit reload and respects declining to discard", async () => {
  const f = fixture();
  await f.model.reload(async () => false);
  expect(f.model.getSnapshot().draft.label).toBe("Work");
  await f.model.reload(async () => true);
  expect(f.model.getSnapshot()).toMatchObject({
    origin: { revision: "reloaded" },
    draft: { replacement: "" },
  });
});
it("clears write-only text on hide and refuses to adopt a hidden write acknowledgement", async () => {
  const f = fixture();
  const saved = f.model.save();
  f.model.setActive(false);
  expect(f.model.getSnapshot().draft.replacement).toBe("");
  f.model.setActive(true);
  f.resolve({ ok: true, value: snapshot("second") });
  await saved;
  expect(f.model.getSnapshot()).toMatchObject({
    origin: { revision: "first" },
    blocked: true,
    busy: false,
  });
});
it("rejects blank replacement locally and never treats it as removal", async () => {
  const f = fixture();
  f.model.edit({ replacement: "" });
  await f.model.save();
  expect(f.calls).toHaveLength(0);
  expect(f.model.getSnapshot().error).toContain("API token");
});
