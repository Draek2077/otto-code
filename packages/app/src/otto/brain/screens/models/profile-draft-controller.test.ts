import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrainProfile,
  BrainProfilePatch,
  BrainProfileRead,
  BrainProfileSaved,
} from "../contracts/models";
import { ProfileDraftController, profileDraftToOverrides } from "./profile-draft-controller";

// Only the host port is deferred. These fixtures drive the same controller that
// the graphical editor uses, without React, a renderer, a transport, or a model.
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred reply has not been initialized");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Deferred reply has not been initialized");
  };
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function readProfile(
  revision = "opaque/origin",
  values: Partial<BrainProfile> = {},
): BrainProfileRead {
  return {
    revision,
    profile: {
      contextSize: 4096,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      flashAttention: true,
      gpuLayers: 999,
      vision: false,
      enabledComponents: [],
      reasoningBudget: 0,
      preserveReasoning: null,
      temperature: 0.8,
      parallelSlots: 1,
      cachedChats: 0,
      contextMultiplier: 1,
      calibrationRequired: false,
      hostingProfileId: "prompt-a",
      hostingProfileMode: "custom",
      ...values,
    },
    fields: [
      {
        key: "contextSize",
        label: "Context",
        kind: "number",
        available: true,
        options: [],
        optionLabels: [],
      },
      {
        key: "temperature",
        label: "Temperature",
        kind: "number",
        available: true,
        options: [],
        optionLabels: [],
      },
      {
        key: "preserveReasoning",
        label: "Preserve reasoning",
        kind: "cycle",
        available: true,
        options: ["default", "on", "off"],
        optionLabels: ["Default", "On", "Off"],
        optionValues: [null, true, false],
      },
    ],
    warnings: [],
    calibration: null,
    requiresRestart: false,
    hostingProfiles: [],
    familyHostingProfileId: null,
  };
}

function savedProfile(revision: string, values: Partial<BrainProfile> = {}): BrainProfileSaved {
  return {
    ...readProfile(revision, values),
    budget: null,
    maxContextThatFits: 8192,
    adjustments: [],
  };
}

const cleanupActivations: Array<() => void> = [];

function createEditor() {
  const reads: Array<{ modelId: string; reply: ReturnType<typeof deferred<BrainProfileRead>> }> =
    [];
  const writes: Array<{
    modelId: string;
    patch: BrainProfilePatch;
    expectedRevision: string;
    reply: ReturnType<typeof deferred<BrainProfileSaved>>;
  }> = [];
  const applied: Array<{ kind: string; revision: string }> = [];
  const controller = new ProfileDraftController(
    "actual-model-id",
    {
      readProfile(modelId) {
        const reply = deferred<BrainProfileRead>();
        reads.push({ modelId, reply });
        return reply.promise;
      },
      saveProfile(modelId, patch, expectedRevision) {
        const reply = deferred<BrainProfileSaved>();
        writes.push({ modelId, patch, expectedRevision, reply });
        return reply.promise;
      },
    },
    (event) => applied.push({ kind: event.kind, revision: event.result.revision }),
  );
  const activate = () => {
    const cleanup = controller.activate();
    cleanupActivations.push(cleanup);
    return cleanup;
  };
  controller.setWritable(true);
  return { controller, reads, writes, applied, activate };
}

async function loadedEditor() {
  const editor = createEditor();
  const deactivate = editor.activate();
  editor.reads[0].reply.resolve(readProfile());
  await editor.reads[0].reply.promise;
  return { ...editor, deactivate };
}

async function conflictedEditor() {
  const editor = await loadedEditor();
  editor.controller.edit({ contextSize: 9000 });
  const saving = editor.controller.save();
  editor.writes[0].reply.reject(new Error("Profile revision conflict"));
  await saving;
  return editor;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const cleanup of cleanupActivations.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("graphical Brain profile CAS and autosave", () => {
  it("debounces the last edit, submits its opaque origin, and stops once the draft is accepted", async () => {
    const { controller, writes, reads } = await loadedEditor();
    controller.edit({ contextSize: 6000 });
    await vi.advanceTimersByTimeAsync(200);
    controller.edit({ contextSize: 9000 });
    await vi.advanceTimersByTimeAsync(249);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads.map((request) => request.modelId)).toEqual(["actual-model-id"]);
    expect(writes).toHaveLength(1);
    expect(await controller.save({ familyHostingProfileId: "blocked-during-autosave" })).toBe(null);
    expect(writes[0]).toMatchObject({
      modelId: "actual-model-id",
      expectedRevision: "opaque/origin",
      patch: {
        contextSize: 9000,
        temperature: 0.8,
        preserveReasoning: null,
        enabledComponents: [],
      },
    });
    expect(writes[0].patch).not.toHaveProperty("hostingProfileMode");
    expect(writes[0].patch).not.toHaveProperty("hostingProfileId");
    writes[0].reply.resolve(savedProfile("opaque/accepted", { contextSize: 8192 }));
    await writes[0].reply.promise;
    expect(controller.getSnapshot()).toMatchObject({
      draft: { contextSize: 8192 },
      dirty: false,
      saving: false,
      profile: { revision: "opaque/accepted" },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(1);
  });

  it("shares one immediate writer across template, family-default, and autosave actions", async () => {
    const { controller, writes } = await loadedEditor();
    controller.edit({ contextSize: 9000 });
    const template = {
      id: "prompt-b",
      name: "Prompt B",
      family: "test-family",
      description: "",
      template: "test template",
      systemPromptAddendum: null,
      templateKwargs: {},
    };
    const first = controller.save({ hostingProfile: template });
    expect(await controller.save({ familyHostingProfileId: "prompt-b" })).toBe(null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(1);
    expect(writes[0].patch.hostingProfile).toEqual(template);
    expect(controller.getSnapshot().saving).toBe(true);
    writes[0].reply.resolve(
      savedProfile("opaque/second", {
        contextSize: 9000,
        hostingProfileId: "prompt-b",
      }),
    );
    await first;
    const second = controller.save({ familyHostingProfileId: "prompt-b" });
    expect(writes).toHaveLength(2);
    expect(writes[1].expectedRevision).toBe("opaque/second");
    expect(writes[1].patch.familyHostingProfileId).toBe("prompt-b");
    writes[1].reply.resolve(savedProfile("opaque/third", { contextSize: 9000 }));
    await second;
    expect(controller.getSnapshot().saving).toBe(false);
  });

  it("preserves newer field and component edits while accepting normalization and the next revision", async () => {
    const { controller, writes } = await loadedEditor();
    controller.edit({ contextSize: 9000 });
    controller.toggleComponent("vision", true);
    const first = controller.save();
    controller.edit({ temperature: 0.3 });
    controller.toggleComponent("vision", false);
    writes[0].reply.resolve(
      savedProfile("normalized/revision", {
        contextSize: 8192,
        enabledComponents: ["vision"],
      }),
    );
    await first;
    expect(controller.getSnapshot()).toMatchObject({
      draft: { contextSize: 8192, temperature: 0.3 },
      enabledComponents: [],
      dirty: true,
      profile: { revision: "normalized/revision" },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      expectedRevision: "normalized/revision",
      patch: { contextSize: 8192, temperature: 0.3, enabledComponents: [] },
    });
    writes[1].reply.resolve(
      savedProfile("final/revision", { contextSize: 8192, temperature: 0.3 }),
    );
    await writes[1].reply.promise;
    expect(controller.getSnapshot().dirty).toBe(false);
  });

  it("keeps a newer value of the submitted field and a new template choice during acknowledgment", async () => {
    const { controller, writes } = await loadedEditor();
    controller.edit({ contextSize: 9000 });
    const saving = controller.save();
    controller.edit({ contextSize: 12000, hostingProfileMode: "off", hostingProfileId: null });
    writes[0].reply.resolve(
      savedProfile("normalized/with-newer-edits", {
        contextSize: 8192,
        temperature: 0.75,
      }),
    );
    await saving;
    expect(controller.getSnapshot()).toMatchObject({
      draft: {
        contextSize: 12000,
        temperature: 0.75,
        hostingProfileMode: "off",
        hostingProfileId: null,
      },
      dirty: true,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      expectedRevision: "normalized/with-newer-edits",
      patch: { contextSize: 12000, hostingProfileMode: "off", hostingProfileId: null },
    });
    writes[1].reply.resolve(
      savedProfile("final/newer-edits", {
        contextSize: 12000,
        temperature: 0.75,
        hostingProfileMode: "off",
        hostingProfileId: null,
      }),
    );
    await writes[1].reply.promise;
    expect(controller.getSnapshot().dirty).toBe(false);
  });

  it.each(["Profile revision conflict", "Host disconnected"])(
    "%s keeps the draft and origin without automatically retrying or adopting a peer revision",
    async (message) => {
      const { controller, writes, reads, applied, deactivate, activate } = await loadedEditor();
      controller.edit({ contextSize: 9000 });
      const saving = controller.save();
      controller.edit({ temperature: 0.3 });
      writes[0].reply.reject(new Error(message));
      await saving;
      controller.noteExternalChange();
      deactivate();
      activate();
      controller.edit({ contextSize: 12000 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await controller.save({ familyHostingProfileId: "peer-profile" })).toBe(null);
      expect(writes).toHaveLength(1);
      expect(reads).toHaveLength(1);
      expect(applied).toEqual([{ kind: "read", revision: "opaque/origin" }]);
      expect(controller.getSnapshot()).toMatchObject({
        draft: { contextSize: 12000, temperature: 0.3 },
        dirty: true,
        saveBlocked: true,
        saving: false,
        profile: { revision: "opaque/origin" },
        error: `Changes were not saved. ${message} Your draft has been kept. Reload the saved profile to continue saving.`,
      });
    },
  );

  it("only a confirmed reload replaces a blocked draft and supplies the next save's origin", async () => {
    const { controller, reads, writes } = await conflictedEditor();
    const confirmation = deferred<boolean>();
    let confirmedActions = 0;
    const reloading = controller.reload(
      () => confirmation.promise,
      () => {
        confirmedActions++;
      },
    );
    expect(reads).toHaveLength(1);
    expect(controller.getSnapshot().draft.contextSize).toBe(9000);
    confirmation.resolve(true);
    await confirmation.promise;
    expect(confirmedActions).toBe(1);
    expect(reads).toHaveLength(2);
    expect(controller.getSnapshot().loading).toBe(true);
    expect(await controller.save({ familyHostingProfileId: "too-early" })).toBe(null);
    expect(writes).toHaveLength(1);
    reads[1].reply.resolve(readProfile("peer/opaque/revision", { contextSize: 16384 }));
    expect(await reloading).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      draft: { contextSize: 16384 },
      dirty: false,
      saveBlocked: false,
      error: null,
      externalChange: false,
      profile: { revision: "peer/opaque/revision" },
    });
    controller.edit({ temperature: 0.4 });
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toHaveLength(2);
    expect(writes[1].expectedRevision).toBe("peer/opaque/revision");
    writes[1].reply.resolve(savedProfile("after-reload", { contextSize: 16384, temperature: 0.4 }));
    await writes[1].reply.promise;
  });

  it("declining reload keeps the conflict draft and does not read or unblock writes", async () => {
    const { controller, reads, writes } = await conflictedEditor();
    expect(await controller.reload(() => Promise.resolve(false))).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      draft: { contextSize: 9000 },
      dirty: true,
      saveBlocked: true,
      profile: { revision: "opaque/origin" },
    });
  });

  it("a failed explicit reload retains the dirty draft and its blocked original revision", async () => {
    const { controller, reads, writes } = await conflictedEditor();
    const reloading = controller.reload(() => Promise.resolve(true));
    await Promise.resolve();
    reads[1].reply.reject(new Error("Cannot read this host"));
    expect(await reloading).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      draft: { contextSize: 9000 },
      dirty: true,
      error: "Cannot read this host",
      saveBlocked: true,
      profile: { revision: "opaque/origin" },
    });
  });

  it("external change notices never reload or rebase an existing draft", async () => {
    const { controller, reads, writes } = await loadedEditor();
    controller.edit({ hostingProfileMode: "off", hostingProfileId: null });
    controller.noteExternalChange();
    await vi.advanceTimersByTimeAsync(250);
    expect(reads).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      expectedRevision: "opaque/origin",
      patch: { hostingProfileMode: "off", hostingProfileId: null },
    });
    writes[0].reply.resolve(
      savedProfile("after-off", { hostingProfileMode: "off", hostingProfileId: null }),
    );
    await writes[0].reply.promise;
    expect(controller.getSnapshot().externalChange).toBe(true);
  });

  it("keeps a read-only draft local and resumes debounce only when writing is permitted", async () => {
    const { controller, writes } = await loadedEditor();
    controller.edit({ temperature: 0.4 });
    controller.setWritable(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await controller.save()).toBe(null);
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot().dirty).toBe(true);
    controller.setWritable(true);
    await vi.advanceTimersByTimeAsync(249);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toHaveLength(1);
    writes[0].reply.resolve(savedProfile("writable", { temperature: 0.4 }));
    await writes[0].reply.promise;
  });
});

describe("profile activation authority", () => {
  it("starts no requests before activation and cancels an unsent autosave on hide or unmount", async () => {
    const editor = createEditor();
    await vi.advanceTimersByTimeAsync(2000);
    expect(editor.reads).toHaveLength(0);
    expect(editor.writes).toHaveLength(0);
    const deactivate = editor.activate();
    editor.reads[0].reply.resolve(readProfile());
    await editor.reads[0].reply.promise;
    editor.controller.edit({ temperature: 0.4 });
    deactivate();
    await vi.advanceTimersByTimeAsync(2000);
    expect(editor.writes).toHaveLength(0);
    expect(editor.controller.getSnapshot().dirty).toBe(true);
    editor.activate();
    await vi.advanceTimersByTimeAsync(250);
    expect(editor.reads).toHaveLength(1);
    expect(editor.writes).toHaveLength(1);
    editor.writes[0].reply.resolve(savedProfile("resumed", { temperature: 0.4 }));
    await editor.writes[0].reply.promise;
  });

  it.each(["success", "failure"] as const)(
    "ignores an initial read's late %s without releasing a newer activation's read",
    async (outcome) => {
      const { controller, reads, writes, applied, activate } = createEditor();
      const oldCleanup = activate();
      oldCleanup();
      activate();
      expect(reads).toHaveLength(2);
      if (outcome === "success") reads[0].reply.resolve(readProfile("stale/initial"));
      else reads[0].reply.reject(new Error("Stale read failure"));
      await Promise.resolve();
      oldCleanup();
      expect(controller.getSnapshot()).toMatchObject({ profile: null, loading: true, error: null });
      expect(applied).toEqual([]);
      expect(await controller.save()).toBe(null);
      expect(writes).toHaveLength(0);
      reads[1].reply.resolve(readProfile("current/initial"));
      await reads[1].reply.promise;
      expect(controller.getSnapshot()).toMatchObject({
        loading: false,
        profile: { revision: "current/initial" },
      });
      expect(applied).toEqual([{ kind: "read", revision: "current/initial" }]);
    },
  );

  it("does not apply an explicit reload response after hide and reactivation", async () => {
    const { controller, reads, applied, deactivate, activate } = await loadedEditor();
    controller.setWritable(false);
    controller.edit({ temperature: 0.3 });
    const reloading = controller.reload(() => Promise.resolve(true));
    await Promise.resolve();
    expect(reads).toHaveLength(2);
    deactivate();
    activate();
    reads[1].reply.resolve(readProfile("stale/reload", { temperature: 0.9 }));
    expect(await reloading).toBe(false);
    expect(reads).toHaveLength(2);
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      draft: { temperature: 0.3 },
      dirty: true,
      profile: { revision: "opaque/origin" },
    });
    expect(applied).toEqual([{ kind: "read", revision: "opaque/origin" }]);
  });

  it("a reload confirmation cannot outlive the activation that opened its dialog", async () => {
    const { controller, reads, deactivate, activate } = await loadedEditor();
    const confirmation = deferred<boolean>();
    let dialogClosures = 0;
    const reloading = controller.reload(
      () => confirmation.promise,
      () => {
        dialogClosures++;
      },
    );
    deactivate();
    activate();
    confirmation.resolve(true);
    expect(await reloading).toBe(false);
    expect(reads).toHaveLength(1);
    expect(dialogClosures).toBe(0);
  });

  it("a template deletion confirmation cannot start a write after hide and reactivation", async () => {
    const { controller, writes, deactivate, activate } = await loadedEditor();
    const confirmation = deferred<boolean>();
    const deleting = controller.save(
      { deleteHostingProfileId: "prompt-a" },
      () => confirmation.promise,
    );
    deactivate();
    activate();
    confirmation.resolve(true);
    expect(await deleting).toBe(null);
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      dirty: false,
      saveBlocked: false,
      profile: { revision: "opaque/origin" },
    });
  });

  it.each(["success", "failure"] as const)(
    "a hidden in-flight write's late %s requires reload and never applies its revision or callback",
    async (outcome) => {
      const { controller, reads, writes, applied, deactivate, activate } = await loadedEditor();
      controller.edit({ contextSize: 9000 });
      const saving = controller.save();
      deactivate();
      activate();
      expect(controller.getSnapshot()).toMatchObject({
        saving: true,
        dirty: true,
        saveBlocked: true,
        externalChange: true,
      });
      expect(await controller.save({ familyHostingProfileId: "another" })).toBe(null);
      expect(await controller.reload(() => Promise.resolve(true))).toBe(false);
      expect(reads).toHaveLength(1);
      if (outcome === "success") {
        writes[0].reply.resolve(savedProfile("hidden/acknowledgment", { contextSize: 8192 }));
      } else {
        writes[0].reply.reject(new Error("Hidden write failure"));
      }
      expect(await saving).toBe(null);
      await vi.advanceTimersByTimeAsync(2000);
      expect(writes).toHaveLength(1);
      expect(applied).toEqual([{ kind: "read", revision: "opaque/origin" }]);
      expect(controller.getSnapshot()).toMatchObject({
        saving: false,
        dirty: true,
        saveBlocked: true,
        draft: { contextSize: 9000 },
        profile: { revision: "opaque/origin" },
        error: null,
      });
      const reloading = controller.reload(() => Promise.resolve(true));
      await Promise.resolve();
      reads[1].reply.resolve(readProfile("explicit/host-truth", { contextSize: 8192 }));
      expect(await reloading).toBe(true);
      expect(controller.getSnapshot()).toMatchObject({
        dirty: false,
        saveBlocked: false,
        externalChange: false,
        profile: { revision: "explicit/host-truth" },
      });
    },
  );

  it("unmounted save replies do not publish accepted metadata or invoke UI callbacks", async () => {
    const { controller, writes, applied, deactivate } = await loadedEditor();
    controller.edit({ contextSize: 9000 });
    const saving = controller.save();
    deactivate();
    writes[0].reply.resolve(savedProfile("unmounted/acknowledgment", { contextSize: 8192 }));
    expect(await saving).toBe(null);
    expect(applied).toEqual([{ kind: "read", revision: "opaque/origin" }]);
    expect(controller.getSnapshot()).toMatchObject({
      draft: { contextSize: 9000 },
      dirty: true,
      saveBlocked: true,
      profile: { revision: "opaque/origin" },
    });
  });
});

it("keeps budget overrides numeric/boolean, omitting null and prompt/template choices", () => {
  expect(
    profileDraftToOverrides({
      contextSize: 8192,
      temperature: 0,
      flashAttention: false,
      preserveReasoning: null,
      cacheTypeK: "q8_0",
      hostingProfileMode: "custom",
      hostingProfileId: "prompt-a",
    }),
  ).toEqual({ contextSize: 8192, temperature: 0, flashAttention: false, cacheTypeK: "q8_0" });
});
