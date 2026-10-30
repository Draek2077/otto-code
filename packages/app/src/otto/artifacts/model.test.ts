import { expect, test } from "vitest";
import { ArtifactDraft, ArtifactCreateDraft } from "./model";
import { ArtifactStorageForm } from "./storage-model";
import type { ArtifactDocument } from "@getpaseo/plugin/otto/artifacts";
const document = (revision = "original"): ArtifactDocument => ({
  lock: null,
  artifact: {
    id: "report",
    name: "Report",
    description: "Original",
    projectId: "project",
    location: "repository",
    revision,
    status: "ready",
    starred: false,
    createdAt: "now",
    updatedAt: "now",
    error: null,
    repairAvailable: true,
    previewAvailable: true,
    hasData: true,
    source: null,
    provider: null,
    model: null,
  },
  html: "<html></html>",
  data: '{"value":1}',
  runs: [],
  path: "/host/project/report.html",
  transcript: "Done",
});
const command = {
  type: "metadata" as const,
  name: "Edited",
  description: "Original",
  starred: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  return { promise, resolve, reject };
}
test("a newer external revision never rebases a dirty draft before explicit reload", async () => {
  const draft = new ArtifactDraft(document());
  draft.activate();
  draft.edit("name", "Edited");
  draft.external(document("peer"));
  const revisions: string[] = [];
  await draft.execute(command, {
    confirm: async () => true,
    write: async (_command, revision) => {
      revisions.push(revision);
      return document("accepted");
    },
  });
  expect(revisions).toEqual(["original"]);
  expect(draft.getSnapshot().document.artifact.revision).toBe("accepted");
  expect(draft.getSnapshot().dirty).toBe(false);
});
test("failed and unknown writes retain values and block another submission", async () => {
  const draft = new ArtifactDraft(document());
  draft.activate();
  draft.edit("name", "Keep this");
  let attempts = 0;
  const ports = {
    confirm: async () => true,
    write: async () => {
      attempts++;
      throw new Error("disconnect");
    },
  };
  expect(await draft.execute(command, ports)).toBe(false);
  expect(await draft.execute(command, ports)).toBe(false);
  expect(attempts).toBe(1);
  expect(draft.getSnapshot().fields.name).toBe("Keep this");
  expect(draft.getSnapshot().blocked).toBe(true);
});
test("double submission is serialized and a hidden reply never adopts a new revision", async () => {
  const draft = new ArtifactDraft(document()),
    hide = draft.activate(),
    pending = deferred<ArtifactDocument | null>();
  let writes = 0;
  const ports = {
    confirm: async () => true,
    write: async () => {
      writes++;
      return pending.promise;
    },
  };
  const first = draft.execute(command, ports);
  expect(await draft.execute(command, ports)).toBe(false);
  await Promise.resolve();
  hide();
  draft.activate();
  pending.resolve(document("late"));
  expect(await first).toBe(false);
  expect(writes).toBe(1);
  expect(draft.getSnapshot().document.artifact.revision).toBe("original");
  expect(draft.getSnapshot().blocked).toBe(true);
});
test("declined reload preserves draft; confirmed reload acknowledges current origin", async () => {
  const draft = new ArtifactDraft(document());
  draft.activate();
  draft.edit("json", '{"value":2}');
  let reads = 0;
  const read = async () => {
    reads++;
    return document("peer");
  };
  expect(await draft.reload(read, async () => false)).toBe(false);
  expect(reads).toBe(0);
  expect(draft.getSnapshot().dirty).toBe(true);
  expect(await draft.reload(read, async () => true)).toBe(true);
  expect(reads).toBe(1);
  expect(draft.getSnapshot().document.artifact.revision).toBe("peer");
  expect(draft.getSnapshot().dirty).toBe(false);
});
test("hiding during a confirmation grants no write authority after reactivation", async () => {
  const draft = new ArtifactDraft(document()),
    hide = draft.activate(),
    confirmation = deferred<boolean>();
  let writes = 0;
  const execution = draft.execute(command, {
    confirm: () => confirmation.promise,
    write: async () => {
      writes++;
      return document("bad");
    },
  });
  hide();
  draft.activate();
  confirmation.resolve(true);
  expect(await execution).toBe(false);
  expect(writes).toBe(0);
});
test("clean active consumers follow live generation status without touching dirty fields", () => {
  const draft = new ArtifactDraft(document());
  draft.activate();
  draft.external(document("completed"));
  expect(draft.getSnapshot().document.artifact.revision).toBe("completed");
  draft.edit("instruction", "New task");
  draft.external(document("next"));
  expect(draft.getSnapshot().fields.instruction).toBe("New task");
  expect(draft.getSnapshot().document.artifact.revision).toBe("completed");
});
test("reload confirmation is serialized and late hidden reads cannot acknowledge a new revision", async () => {
  const draft = new ArtifactDraft(document()),
    hide = draft.activate(),
    confirmation = deferred<boolean>(),
    read = deferred<ArtifactDocument>();
  draft.edit("name", "Keep");
  const pending = draft.reload(
    () => read.promise,
    () => confirmation.promise,
  );
  expect(
    await draft.reload(
      async () => document("wrong"),
      async () => true,
    ),
  ).toBe(false);
  confirmation.resolve(true);
  await Promise.resolve();
  hide();
  draft.activate();
  read.resolve(document("late"));
  expect(await pending).toBe(false);
  expect(draft.getSnapshot().document.artifact.revision).toBe("original");
});
test("known invalid JSON is editable and never sent to the host", async () => {
  const draft = new ArtifactDraft(document());
  draft.activate();
  let writes = 0;
  expect(
    await draft.execute(
      { type: "data", json: "{broken" },
      {
        confirm: async () => true,
        write: async () => {
          writes++;
          return null;
        },
      },
    ),
  ).toBe(false);
  expect(writes).toBe(0);
  expect(draft.getSnapshot().blocked).toBe(false);
});
test("creation owns one immediate lane and retains a hidden accepted identity instead of duplicating it", async () => {
  const scope = { hostId: "host", target: { kind: "project" as const, id: "project" } },
    draft = new ArtifactCreateDraft(scope),
    hide = draft.activate(),
    ack = deferred<ArtifactDocument["artifact"]>();
  let writes = 0;
  draft.edit("name", "Report");
  draft.edit("description", "Build a report");
  const create = async () => {
    writes++;
    return ack.promise;
  };
  const pending = draft.submit(create);
  expect(await draft.submit(create)).toBeNull();
  hide();
  draft.activate();
  ack.resolve(document().artifact);
  expect(await pending).toBeNull();
  expect(writes).toBe(1);
  expect(draft.getSnapshot().created?.id).toBe("report");
  expect(draft.getSnapshot().blocked).toBe(true);
});
test("storage uses its captured origin and retains a selection after a conflicted save", async () => {
  const model = new ArtifactStorageForm({ value: "repository", revision: "origin" });
  model.activate();
  model.select("host");
  let writes = 0;
  const save = async (seed: { value: string; revision: string }) => {
    writes++;
    expect(seed).toEqual({ value: "host", revision: "origin" });
    throw new Error("conflict");
  };
  await model.save(save);
  await model.save(save);
  expect(writes).toBe(1);
  expect(model.getSnapshot().value).toBe("host");
  expect(model.getSnapshot().blocked).toBe(true);
  await model.reload(
    async () => ({ value: "repository", revision: "peer" }),
    async () => false,
  );
  expect(model.getSnapshot().revision).toBe("origin");
  await model.reload(
    async () => ({ value: "repository", revision: "peer" }),
    async () => true,
  );
  expect(model.getSnapshot().revision).toBe("peer");
  expect(model.getSnapshot().blocked).toBe(false);
});
test("saving metadata preserves an unrelated JSON draft and live status never rebases that draft", async () => {
  const draft = new ArtifactDraft(document());
  draft.activate();
  draft.edit("json", '{"local":true}');
  await draft.execute(command, { confirm: async () => true, write: async () => document("saved") });
  expect(draft.getSnapshot().fields.json).toBe('{"local":true}');
  expect(draft.getSnapshot().dirty).toBe(true);
  const latest = document("peer");
  latest.artifact.status = "error";
  draft.external(latest);
  expect(draft.getSnapshot().latest.artifact.status).toBe("error");
  expect(draft.getSnapshot().document.artifact.revision).toBe("saved");
});
