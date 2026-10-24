import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeService } from "./knowledge-service.js";
import {
  KnowledgeBusyError,
  KnowledgeConflictError,
  runWithKnowledgeCleanup,
  replaceKnowledgeFile,
  withKnowledgeWrite,
  type KnowledgeReplacementPorts,
} from "./knowledge-files.js";
import { digest } from "./markdown-page.js";
import { KnowledgeStoreResolver, type KnowledgeLocation } from "./store-resolver.js";

const scratch = fileURLToPath(
  new URL("../../../../../../.tmp/knowledge-service-tests", import.meta.url),
);
const pending: string[] = [];
const id = "knowledge-unconfirmed-status-is-draft";
const target = { projectId: "project-a", kind: "requirement", id } as const;
const now = new Date("2026-10-23T12:00:00.000Z");
const frozenFixture = fileURLToPath(
  new URL("./fixtures/otto-0.9-requirement.txt", import.meta.url),
);

afterEach(async () => {
  for (const root of pending.splice(0)) {
    if (!root.startsWith(`${scratch}${path.sep}`))
      throw new Error("Fixture escaped scratch directory");
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(
  location: KnowledgeLocation = "repository",
  replacement?: KnowledgeReplacementPorts,
) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "case-"));
  pending.push(root);
  const projectRoot = path.join(root, "repo");
  const home = path.join(root, "host");
  await mkdir(projectRoot);
  await mkdir(home);
  const resolver = new KnowledgeStoreResolver({
    ottoHome: home,
    resolveProject: async () => ({
      projectId: "project-a",
      rootPath: projectRoot,
      knowledgeLocation: location,
      knowledgeDirectoryName: "retained-name-0123abcd",
    }),
    defaultLocation: () => "repository",
  });
  const store = await resolver.resolve("project-a");
  const directory = path.join(store.base, "knowledge/requirements");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${id}.md`);
  const raw = await readFile(frozenFixture, "utf8");
  await writeFile(file, raw);
  const service = new KnowledgeService({ resolver, now: () => now, replacement });
  return { root, projectRoot, store, file, raw, resolver, service };
}

describe.each(["repository", "host"] as const)("Knowledge service in %s storage", (location) => {
  it("preserves fenced Markdown examples containing record delimiters", async () => {
    const { service } = await fixture(location);
    const statement = [
      "A literal record example:",
      "",
      "````markdown",
      "<!-- compiled_truth -->",
      "",
      "## Timeline",
      "",
      "```json",
      '{ "example": true }',
      "```",
      "````",
      "",
      "~~~text",
      "## Timeline",
      "",
      "This is example text, not provenance.",
      "~~~",
      "",
      "## Timeline",
      "",
      "These dates are explanatory prose inside the current understanding.",
    ].join("\n");
    const draft = await service.createDraft({
      projectId: "project-a",
      kind: "decision",
      id: "record-format-example",
      title: "Record format example",
      statement,
    });
    expect(draft.statement).toBe(statement);
    const appended = await service.appendEvidence({
      projectId: "project-a",
      kind: "decision",
      id: draft.metadata.id,
      expectedRevision: draft.revision,
      text: "Example checked against the format.",
    });
    expect(appended.statement).toBe(statement);
    expect(appended.timeline).toContain('summary: "Example checked against the format."');
    expect(appended.timeline).not.toContain("This is example text");
  });

  it("reads frozen 0.9 canonical Markdown without migration and catalogs no bodies", async () => {
    const { service, file, raw } = await fixture(location);
    const page = await service.read(target);
    expect(page.metadata.status).toBe("confirmed");
    expect(page.statement).toBe(
      "The Knowledge UI labels review status as Draft, Confirmed, and History.",
    );
    expect(page.revision).toBe(digest(raw));
    const catalog = await service.catalog("project-a");
    expect(catalog).toEqual([
      {
        id,
        kind: "requirement",
        title: "Unconfirmed Knowledge entries use Draft status",
        status: "confirmed",
        tags: ["project-knowledge", "ui-copy", "terminology"],
        updatedAt: "2026-09-06T14:59:44.588Z",
        revision: digest(raw),
      },
    ]);
    expect(await readFile(file, "utf8")).toBe(raw);
  });

  it("creates only drafts, keeps human roots/policy intact and never reuses an identity", async () => {
    const { service, store } = await fixture(location);
    const policy = path.join(store.base, "KNOWLEDGE.md");
    const rootFile = path.join(store.base, "knowledge/background.md");
    await writeFile(policy, "My project policy\n");
    await writeFile(rootFile, "# Background\n\nHuman-authored facts.\n");
    const input = {
      projectId: "project-a",
      kind: "decision",
      id: "new-decision",
      title: "A decision",
      statement: "Unreviewed conclusion",
    } as const;
    const created = await service.createDraft(input);
    expect(created.metadata.status).toBe("proposed");
    expect((await service.catalog("project-a")).map((page) => page.id)).toEqual([id]);
    expect((await service.catalog("project-a", true)).map((page) => page.id)).toContain(
      "new-decision",
    );
    await expect(service.createDraft({ ...input, kind: "finding" })).rejects.toBeInstanceOf(
      KnowledgeConflictError,
    );
    expect(await readFile(policy, "utf8")).toBe("My project policy\n");
    expect((await service.readRoot({ projectId: "project-a", slug: "background" }))?.body).toBe(
      "# Background\n\nHuman-authored facts.\n",
    );
    expect(await service.readRoot({ projectId: "project-a", slug: "flow" })).toBeNull();
  });

  it("demotes changed confirmed truth while retaining unknown fields and history", async () => {
    const probe = replacementProbe(`${location}-truth`);
    const { service, file, raw } = await fixture(location, probe.ports);
    const extended =
      raw.replace(
        'kind: "requirement"',
        'future_setting: { nested: [1, 2] }\nkind: "requirement"',
      ) +
      '- time: "2026-10-01T00:00:00.000Z"\n  kind: "future_event"\n  summary: "Retain future evidence"\n  future_key: { nested: true }\n';
    await writeFile(file, extended);
    const before = await service.read(target);
    probe.setExpectedRevision(before.revision);
    const after = await service.updateTruth({
      ...target,
      expectedRevision: before.revision,
      statement: "A revised conclusion",
      reason: "User corrected the requirement",
    });
    expect(after.metadata.status).toBe("proposed");
    expect(after.metadata.future_setting).toEqual({ nested: [1, 2] });
    expect(after.timeline).toContain(before.timeline.trimEnd());
    expect(after.timeline).toContain('summary: "User corrected the requirement"');
    expect(await service.catalog("project-a")).toEqual([]);
  });

  it("appends evidence without demotion and rejects timestamp-identical stale writers", async () => {
    const { service, resolver, file } = await fixture(location);
    const second = new KnowledgeService({ resolver, now: () => now });
    const original = await service.read(target);
    const before = await service.appendEvidence({
      ...target,
      expectedRevision: original.revision,
      text: "Initial evidence at the same timestamp",
    });
    const outcomes = await Promise.allSettled([
      service.appendEvidence({ ...target, expectedRevision: before.revision, text: "Evidence A" }),
      second.appendEvidence({ ...target, expectedRevision: before.revision, text: "Evidence B" }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      KnowledgeConflictError,
    );
    const after = await service.read(target);
    expect(after.metadata.status).toBe("confirmed");
    expect(after.metadata.updated_at).toBe(before.metadata.updated_at);
    expect(after.timeline).toContain(before.timeline.trimEnd());
    expect(after.revision).not.toBe(before.revision);
    expect(await readdir(path.dirname(file))).toEqual([`${id}.md`]);
  });

  it("observes external edits on the next read and refuses to overwrite a stale selection", async () => {
    const { service, file, raw } = await fixture(location);
    const before = await service.read(target);
    const edited = raw.replace(
      "The Knowledge UI labels",
      "The externally edited Knowledge UI labels",
    );
    await writeFile(file, edited);
    await expect(
      service.updateTruth({
        ...target,
        expectedRevision: before.revision,
        statement: "Stale draft",
        reason: "Reason",
      }),
    ).rejects.toBeInstanceOf(KnowledgeConflictError);
    expect((await service.read(target)).statement).toContain("externally edited");
    expect(await readFile(file, "utf8")).toBe(edited);
  });

  it("preserves malformed pages and unsupported legacy formats without implicit repair", async () => {
    const { service, file, raw } = await fixture(location);
    for (const corrupt of [
      raw.replace('status: "confirmed"', 'status: "confirmed"\nstatus: "proposed"'),
      raw + "- broken: [\n",
      raw.replace("<!-- compiled_truth -->", "## Current truth"),
    ]) {
      await writeFile(file, corrupt);
      await expect(service.catalog("project-a")).rejects.toThrow();
      await expect(
        service.appendEvidence({ ...target, expectedRevision: digest(corrupt), text: "Evidence" }),
      ).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe(corrupt);
    }
  });
});

function replacementProbe(label: string, injectedError?: Error) {
  let opened: FileHandle | undefined;
  let attempts = 0;
  let expectedRevision: string | undefined;
  const diagnosticFile = path.join(scratch, `../f04-rename-${label}.json`);
  const ports: KnowledgeReplacementPorts = {
    openStagedFile: async (file) => {
      opened = await open(file, "wx", 0o600);
      return opened;
    },
    renameFile: async (source, targetFile) => {
      const before = {
        node: process.versions.node,
        uv: process.versions.uv,
        stagedFd: opened?.fd,
        awaitedClose: opened?.fd === -1,
        expectedRevision,
        source: await fileSnapshot(source),
        target: await fileSnapshot(targetFile),
      };
      await writeFile(diagnosticFile, JSON.stringify({ before, attempts }, null, 2));
      attempts += 1;
      try {
        if (injectedError) throw injectedError;
        await rename(source, targetFile);
      } catch (error) {
        await writeFile(
          diagnosticFile,
          JSON.stringify(
            {
              before,
              attempts,
              error: errorFields(error),
              afterSource: await fileSnapshot(source),
              afterTarget: await fileSnapshot(targetFile),
            },
            null,
            2,
          ),
        );
        throw error;
      }
      await writeFile(
        diagnosticFile,
        JSON.stringify(
          {
            before,
            attempts,
            succeeded: true,
            afterTarget: await fileSnapshot(targetFile),
          },
          null,
          2,
        ),
      );
    },
  };
  return {
    ports,
    diagnosticFile,
    attempts: () => attempts,
    setExpectedRevision: (revision: string) => {
      expectedRevision = revision;
    },
  };
}

async function fileSnapshot(file: string) {
  const info = await lstat(file);
  return {
    path: file,
    pathLength: file.length,
    mode: info.mode,
    nlink: info.nlink,
    uid: info.uid,
    gid: info.gid,
    size: info.size,
    isFile: info.isFile(),
    isSymbolicLink: info.isSymbolicLink(),
    digest: digest(await readFile(file, "utf8")),
  };
}

function errorFields(error: unknown) {
  if (!(error instanceof Error)) return { value: String(error) };
  return Object.fromEntries(
    ["name", "message", "code", "errno", "syscall", "path", "dest"].map((key) => [
      key,
      Reflect.get(error, key),
    ]),
  );
}

it("diagnoses one fresh atomic replacement with the staging handle closed", async () => {
  const { store, file, raw } = await fixture();
  const probe = replacementProbe("fresh");
  probe.setExpectedRevision(digest(raw));
  const body = raw.replace("The Knowledge UI labels", "The replacement Knowledge UI labels");
  await withKnowledgeWrite(store, () =>
    replaceKnowledgeFile({
      store,
      file,
      expectedRevision: digest(raw),
      body,
      replacement: probe.ports,
    }),
  );
  expect(probe.attempts()).toBe(1);
  expect(await readFile(file, "utf8")).toBe(body);
  const diagnostics = JSON.parse(await readFile(probe.diagnosticFile, "utf8"));
  expect(diagnostics.before).toMatchObject({ stagedFd: -1, awaitedClose: true });
});

it("preserves the original page on injected EPERM without retrying replacement", async () => {
  const { store, file, raw } = await fixture();
  const denial = Object.assign(new Error("Injected rename denial"), { code: "EPERM" });
  const probe = replacementProbe("injected", denial);
  probe.setExpectedRevision(digest(raw));
  await expect(
    withKnowledgeWrite(store, () =>
      replaceKnowledgeFile({
        store,
        file,
        expectedRevision: digest(raw),
        body: "Replacement that must not commit",
        replacement: probe.ports,
      }),
    ),
  ).rejects.toBe(denial);
  expect(probe.attempts()).toBe(1);
  expect(await readFile(file, "utf8")).toBe(raw);
  expect(await readdir(path.dirname(file))).toEqual([`${id}.md`]);
  expect(await readdir(path.join(store.base, "knowledge"))).toEqual(["requirements"]);
  const diagnostics = JSON.parse(await readFile(probe.diagnosticFile, "utf8"));
  expect(diagnostics.before).toMatchObject({ stagedFd: -1, awaitedClose: true });
  expect(diagnostics.afterTarget.digest).toBe(digest(raw));
});

it("does not take over or delete a lock left by another writer", async () => {
  const { service, store } = await fixture();
  const before = await service.read(target);
  const lock = path.join(store.base, "knowledge/.write-lock");
  await mkdir(lock);
  await expect(
    service.appendEvidence({ ...target, expectedRevision: before.revision, text: "Evidence" }),
  ).rejects.toBeInstanceOf(KnowledgeBusyError);
  expect(await readdir(lock)).toEqual([]);
});

it("refuses page traversal and directory junctions outside the owning store", async () => {
  const { service, store, root } = await fixture();
  await expect(service.read({ ...target, id: "../../outside" })).rejects.toThrow("path segment");
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(store.base, "knowledge/decisions"), "junction");
  await expect(
    service.createDraft({
      projectId: "project-a",
      kind: "decision",
      id: "safe-id",
      title: "Title",
      statement: "Facts",
    }),
  ).rejects.toThrow("symbolic links");
  expect(await readdir(outside)).toEqual([]);
});

describe("Knowledge resource cleanup", () => {
  it("returns the operation result after exactly one cleanup", async () => {
    const steps: string[] = [];
    const result = await runWithKnowledgeCleanup({
      operation: async () => {
        steps.push("write");
        return "saved";
      },
      cleanup: async () => {
        steps.push("cleanup");
      },
    });
    expect(result).toBe("saved");
    expect(steps).toEqual(["write", "cleanup"]);
  });

  it("retains the original operation error when cleanup succeeds", async () => {
    const primaryError = new KnowledgeConflictError();
    const steps: string[] = [];
    await expect(
      runWithKnowledgeCleanup({
        operation: async () => {
          throw primaryError;
        },
        cleanup: async () => {
          steps.push("cleanup");
        },
      }),
    ).rejects.toBe(primaryError);
    expect(steps).toEqual(["cleanup"]);
  });

  it("reports cleanup failure after an otherwise successful operation", async () => {
    const cleanupError = new Error("Cannot remove temporary file");
    await expect(
      runWithKnowledgeCleanup({
        operation: async () => "saved",
        cleanup: async () => {
          throw cleanupError;
        },
      }),
    ).rejects.toBe(cleanupError);
  });

  it("preserves simultaneous failures in order with the operation as cause", async () => {
    const primaryError = new KnowledgeConflictError();
    const cleanupError = new Error("Cannot remove temporary file");
    const result = runWithKnowledgeCleanup({
      operation: async () => {
        throw primaryError;
      },
      cleanup: async () => {
        throw cleanupError;
      },
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({
      cause: primaryError,
      errors: [primaryError, cleanupError],
    });
  });
});
