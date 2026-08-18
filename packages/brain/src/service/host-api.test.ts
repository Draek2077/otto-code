import { describe, expect, it } from "vitest";
import http from "node:http";

import {
  applyHostingProfilePatch,
  buildInventoryRow,
  createHostApi,
  type HostApiDeps,
} from "./host-api.js";
import type { Supervisor } from "./supervisor.js";
import type { Scheduler } from "./scheduler.js";
import { forModel } from "../config/profiles.js";
import { ProfilesStoreSchema, type ProfilesStore } from "../config/schema.js";
import type { RankedModel } from "../ops/results.js";
import type { GpuInfo, Model } from "../types.js";
import { GIB } from "../vram.js";

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "vendor/model-Q5_K_M.gguf",
    displayName: "Test Model",
    modelPath: "/models/vendor/model-Q5_K_M.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q5_K_M",
    sizeBytes: 8 * GIB,
    origin: "managed",
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: {
      arch: "qwen3",
      contextLength: 32768,
      blockCount: 48,
      headCountKv: 8,
      keyLength: 128,
      valueLength: 128,
      reasoning: true,
    },
    ...overrides,
  };
}

/** Only the fields `buildInventoryRow` reads; it never touches the child process. */
function fakeSupervisor(state: string, model: Model | null): Supervisor {
  return { state, model } as unknown as Supervisor;
}

const GPU: GpuInfo = {
  name: "NVIDIA GeForce RTX 4090",
  totalBytes: 24 * GIB,
  usedBytes: 2 * GIB,
  freeBytes: 22 * GIB,
  driver: "560.00",
  computeCapability: "8.9",
};

function build(params: {
  model?: Model;
  store?: ProfilesStore;
  gpu?: GpuInfo | null;
  ranking?: RankedModel[];
  supervisor?: Supervisor;
  scheduler?: Scheduler | null;
  runtimeBuild?: number | null;
}) {
  const model = params.model ?? makeModel();
  return buildInventoryRow({
    model,
    store: params.store ?? ProfilesStoreSchema.parse({}),
    defaults: undefined,
    gpu: params.gpu === undefined ? GPU : params.gpu,
    ranking: params.ranking ?? [],
    supervisor: params.supervisor ?? fakeSupervisor("stopped", null),
    scheduler: params.scheduler,
    runtimeBuild: params.runtimeBuild,
  });
}

describe("buildInventoryRow", () => {
  it("reports loading, unloading, active, and queued model lifecycle states", () => {
    const model = makeModel();
    expect(build({ model, supervisor: fakeSupervisor("starting", model) }).state).toBe("loading");
    expect(build({ model, supervisor: fakeSupervisor("stopping", model) }).state).toBe("unloading");

    const active = {
      stats: () => ({
        queued: 0,
        waiting: {},
        waitingModelIds: {},
        lastTurn: model.id,
        active: { modelId: model.id, kind: "benchmark" as const },
      }),
    } as unknown as Scheduler;
    expect(
      build({ model, supervisor: fakeSupervisor("ready", model), scheduler: active }).state,
    ).toBe("active");

    const queued = {
      stats: () => ({
        queued: 1,
        waiting: { [model.displayName]: 1 },
        waitingModelIds: { [model.id]: 1 },
        lastTurn: null,
        active: null,
      }),
    } as unknown as Scheduler;
    expect(build({ model, scheduler: queued }).state).toBe("queued");
  });

  it("carries the scan row and the GGUF metadata the Models tab shows", () => {
    const row = build({});
    expect(row.id).toBe("vendor/model-Q5_K_M.gguf");
    expect(row.displayName).toBe("Test Model");
    expect(row.family).toBeNull();
    expect(row.quant).toBe("Q5_K_M");
    expect(row.arch).toBe("qwen3");
    expect(row.blockCount).toBe(48);
    expect(row.headCountKv).toBe(8);
    expect(row.contextLength).toBe(32768);
    expect(row.origin).toBe("managed");
  });

  it("carries the curated family identity to the Models tab", () => {
    expect(build({ model: makeModel({ family: "qwen" }) }).family).toBe("qwen");
  });

  it("reports the capability flags the TUI badges V, M and R", () => {
    const plain = build({});
    expect(plain.hasProjector).toBe(false);
    expect(plain.reasoning).toBe(true);
    expect(plain.mtp).toBe(false);

    const rich = build({
      model: makeModel({
        mmprojPath: "/models/vendor/mmproj.gguf",
        mmprojBytes: 512 * 1024 * 1024,
        features: { mtp: true, imatrix: false, distilled: true },
      }),
    });
    expect(rich.hasProjector).toBe(true);
    expect(rich.mtp).toBe(true);
    expect(rich.distilled).toBe(true);
  });

  it("shows vision capability for a bundle before its projector is downloaded", () => {
    const row = build({
      model: makeModel({
        components: [
          {
            id: "vision-projector",
            label: "Image understanding",
            description: "Reads images.",
            role: "vision_projector",
            path: null,
            bytes: 1024,
            required: false,
            defaultDownload: true,
            defaultLoad: false,
            available: false,
          },
        ],
      }),
    });
    expect(row.hasProjector).toBe(true);
  });

  it("marks components unavailable when the active runtime is too old", () => {
    const row = build({
      runtimeBuild: 10264,
      model: makeModel({
        components: [
          {
            id: "draft",
            label: "Draft model",
            description: "Accelerates decoding.",
            role: "speculative_drafter",
            path: "/models/draft.gguf",
            bytes: 1024,
            required: false,
            defaultDownload: false,
            defaultLoad: false,
            available: true,
            minRuntimeBuild: 10265,
          },
        ],
      }),
    });

    expect(row.components?.[0]).toMatchObject({
      available: false,
      unavailableReason: expect.stringMatching(/requires llama\.cpp build b10265/i),
    });
  });

  it("computes a VRAM budget and a max context when a GPU is present", () => {
    const row = build({});
    expect(row.budget).not.toBeNull();
    expect(row.budget?.weightsBytes).toBe(8 * GIB);
    expect(row.budget?.totalBytes).toBeGreaterThan(8 * GIB);
    expect(row.maxContextThatFits).toBeGreaterThan(0);
  });

  it("leaves the budget null with no GPU rather than inventing one", () => {
    const row = build({ gpu: null });
    expect(row.budget).toBeNull();
    expect(row.maxContextThatFits).toBeNull();
  });

  it("joins the benchmark score by id", () => {
    const ranking: RankedModel[] = [
      {
        id: "vendor/model-Q5_K_M.gguf",
        displayName: "Test Model",
        overall: 0.72,
        runs: 3,
        std: 2.1,
        grade: "B",
        rank: 1,
      },
    ];
    expect(build({ ranking }).score?.overall).toBe(0.72);
  });

  it("joins the benchmark score by display name when the id differs", () => {
    const ranking: RankedModel[] = [
      { id: null, displayName: "Test Model", overall: 0.5, runs: 1, std: 0, grade: "C" },
    ];
    expect(build({ ranking }).score?.grade).toBe("C");
  });

  it("leaves the score null for an unbenchmarked model", () => {
    const ranking: RankedModel[] = [
      { id: "other", displayName: "Other", overall: 0.9, runs: 2, std: 1, grade: "A" },
    ];
    expect(build({ ranking }).score).toBeNull();
  });

  it("reports the load state only for the model the supervisor holds", () => {
    const model = makeModel();
    const other = makeModel({ id: "vendor/other.gguf", displayName: "Other" });
    expect(build({ model, supervisor: fakeSupervisor("ready", model) }).state).toBe("loaded");
    expect(build({ model, supervisor: fakeSupervisor("starting", model) }).state).toBe("loading");
    expect(build({ model, supervisor: fakeSupervisor("ready", other) }).state).toBe("not-loaded");
    // A crashed supervisor still names its model; that is not "loaded".
    expect(build({ model, supervisor: fakeSupervisor("failed", model) }).state).toBe("not-loaded");
  });

  it("surfaces the blocking warning for a profile that cannot start", () => {
    const model = makeModel();
    const store = ProfilesStoreSchema.parse({});
    store.profiles[model.id] = {
      modelId: model.id,
      modelPath: model.modelPath,
      mmprojPath: null,
      contextSize: 8192,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      flashAttention: false,
      gpuLayers: 999,
      vision: false,
      reasoningBudget: 1536,
      reasoningBudgetMessage: "",
      parallelSlots: 1,
      batchSize: null,
      ubatchSize: null,
      extraArgs: [],
    };
    const row = build({ model, store });
    expect(row.profile.flashAttention).toBe(false);
    expect(row.warnings.some((w) => w.blocksStart)).toBe(true);
  });
});

describe("applyHostingProfilePatch", () => {
  const template = "{% for m in messages %}{{ m.content }}{% endfor %}";

  function hostingProfile(overrides: Record<string, unknown> = {}) {
    return {
      id: "hp1",
      name: "Coding",
      family: "qwen",
      description: "",
      template,
      systemPromptAddendum: null,
      templateKwargs: {},
      ...overrides,
    };
  }

  function setup(storeInput: Record<string, unknown> = {}, model = makeModel({ family: "qwen" })) {
    const store = ProfilesStoreSchema.parse(storeInput);
    return { store, model, profile: forModel(store, model) };
  }

  it("selects a custom profile and clears the id again when switched off", () => {
    const { store, model, profile } = setup({ hostingProfiles: { hp1: hostingProfile() } });

    applyHostingProfilePatch(store, model, profile, { hostingProfileId: "hp1" });
    expect(profile).toMatchObject({ hostingProfileMode: "custom", hostingProfileId: "hp1" });

    applyHostingProfilePatch(store, model, profile, {
      hostingProfileId: null,
      hostingProfileMode: "off",
    });
    expect(profile).toMatchObject({ hostingProfileMode: "off", hostingProfileId: null });
  });

  it("drops a stale id whenever the mode is not custom", () => {
    const { store, model, profile } = setup({ hostingProfiles: { hp1: hostingProfile() } });
    profile.hostingProfileId = "hp1";
    profile.hostingProfileMode = "custom";

    applyHostingProfilePatch(store, model, profile, { hostingProfileMode: "inherit" });

    // The invariant `forModel`'s legacy migration relies on: an id means custom.
    expect(profile.hostingProfileId).toBeNull();
  });

  it("files a family default under generic for a model with no family", () => {
    const generic = hostingProfile({ id: "hp2", family: "generic" });
    const { store, model, profile } = setup(
      { hostingProfiles: { hp2: generic } },
      makeModel({ family: undefined }),
    );

    applyHostingProfilePatch(store, model, profile, { familyHostingProfileId: "hp2" });

    expect(store.familyHostingProfileIds.generic).toBe("hp2");
  });

  it("clears the family default when sent null", () => {
    const { store, model, profile } = setup({
      hostingProfiles: { hp1: hostingProfile() },
      familyHostingProfileIds: { qwen: "hp1" },
    });

    applyHostingProfilePatch(store, model, profile, { familyHostingProfileId: null });

    expect(store.familyHostingProfileIds.qwen).toBeNull();
  });

  it("auto-selects a newly created profile but not an edited one", () => {
    const { store, model, profile } = setup({
      hostingProfiles: { hp1: hostingProfile() },
      familyHostingProfileIds: { qwen: "hp1" },
    });
    profile.hostingProfileMode = "inherit";

    applyHostingProfilePatch(store, model, profile, {
      hostingProfile: hostingProfile({ id: "hp1", name: "Coding v2" }),
    });
    expect(store.hostingProfiles.hp1.name).toBe("Coding v2");
    expect(profile.hostingProfileMode).toBe("inherit", "editing must not hijack the selection");

    applyHostingProfilePatch(store, model, profile, {
      hostingProfile: hostingProfile({ id: "", name: "Brand new" }),
    });
    expect(profile.hostingProfileMode).toBe("custom");
    expect(store.hostingProfiles[profile.hostingProfileId!].name).toBe("Brand new");
  });

  it("resets every model that used a deleted profile, mode included", () => {
    const { store, model, profile } = setup({
      profiles: {
        other: { contextSize: 4096, hostingProfileId: "hp1", hostingProfileMode: "custom" },
      },
      hostingProfiles: { hp1: hostingProfile() },
      familyHostingProfileIds: { qwen: "hp1" },
    });
    profile.hostingProfileId = "hp1";
    profile.hostingProfileMode = "custom";

    const deleted: string[] = [];
    applyHostingProfilePatch(store, model, profile, { deleteHostingProfileId: "hp1" }, (id) =>
      deleted.push(id),
    );

    expect(store.hostingProfiles.hp1).toBeUndefined();
    expect(deleted).toEqual(["hp1"]);
    expect(store.familyHostingProfileIds.qwen).toBeNull();
    expect(profile).toMatchObject({ hostingProfileMode: "off", hostingProfileId: null });
    // A leftover `custom` with no id makes the next save of that model fail.
    expect(store.profiles.other).toMatchObject({
      hostingProfileMode: "off",
      hostingProfileId: null,
    });
  });

  it("names the field that is wrong instead of blaming length", () => {
    const { store, model, profile } = setup();
    const attempt = (overrides: Record<string, unknown>) => () =>
      applyHostingProfilePatch(store, model, profile, {
        hostingProfile: hostingProfile({ id: "", ...overrides }),
      });

    expect(attempt({ name: "  " })).toThrow(/needs a name/);
    expect(attempt({ template: null })).toThrow(/needs a Jinja chat template/);
    expect(attempt({ name: "x".repeat(200) })).toThrow(/characters or fewer/);
    expect(attempt({ systemPromptAddendum: "x".repeat(200_000) })).toThrow(
      /system prompt is too long/,
    );
    expect(attempt({ family: "llama" })).toThrow(/family must match/);
  });

  it("refuses a selection that does not exist", () => {
    const { store, model, profile } = setup();
    expect(() =>
      applyHostingProfilePatch(store, model, profile, { hostingProfileId: "ghost" }),
    ).toThrow(/does not exist/);
    expect(() =>
      applyHostingProfilePatch(store, model, profile, { hostingProfileMode: "custom" }),
    ).toThrow(/select a custom profile/);
  });

  it("validates update ids and refuses product-owned records", () => {
    const { store, model, profile } = setup({
      hostingProfiles: {
        hp1: hostingProfile(),
        "qwen-sharp-v21.3": hostingProfile({ id: "qwen-sharp-v21.3" }),
      },
    });
    const attempt = (id: string) => () =>
      applyHostingProfilePatch(store, model, profile, { hostingProfile: hostingProfile({ id }) });

    expect(attempt("unsafe/id")).toThrow(/only letters, numbers, underscores, or hyphens/i);
    expect(attempt("x".repeat(81))).toThrow(/80 characters or fewer/i);
    expect(attempt("missing")).toThrow(/does not exist/i);
    expect(attempt("qwen-sharp-v21.3")).toThrow(/built-in hosting profiles cannot be edited/i);
  });

  it("caps created hosting profiles", () => {
    const hostingProfiles = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => {
        const id = `hp${index}`;
        return [id, hostingProfile({ id })];
      }),
    );
    const { store, model, profile } = setup({ hostingProfiles });

    expect(() =>
      applyHostingProfilePatch(store, model, profile, {
        hostingProfile: hostingProfile({ id: "", name: "One too many" }),
      }),
    ).toThrow(/hosting profile limit of 100 reached/i);
  });
});

describe("requiresRestart (pendingReloadModelIds)", () => {
  /**
   * The one link the static trace never closed: whether an edit to the
   * currently resident model earns the reload badge. The desktop app reads
   * `requiresRestart` from the profile-POST reply to decide whether the
   * button says "Reload", so a sampler edit that lands on the loaded model
   * must come back `true` — and it must persist in the store so a later
   * GET (a re-opened detail pane) still reports it until the model is
   * actually reloaded.
   */
  function harness(residentModel: Model | null) {
    const model = makeModel();
    const other = makeModel({ id: "vendor/other.gguf", displayName: "Other" });
    const supervisor = {
      state: "ready",
      model: residentModel,
      runtime: null,
      paths: { root: "" },
    } as unknown as Supervisor;
    const store = ProfilesStoreSchema.parse({});
    const deps: HostApiDeps = {
      supervisor,
      getCatalog: () => [model, other],
      rescan: () => [model, other],
      getProfilesStore: () => store,
      saveProfiles: () => {},
      getProfileDefaults: () => undefined,
      queryGpuInfo: async () => GPU,
      getRanking: () => [],
      loadModel: async () => {},
      getAllowWrite: () => true,
      getModelsDir: () => null,
      sampleResources: async () =>
        ({
          cpu: null,
          cpuCount: 1,
          loadAverage: null,
          ramUsedBytes: 0,
          ramTotalBytes: 0,
          gpu: null,
          slots: null,
        }) as never,
    };
    const api = createHostApi(deps);
    const server = http.createServer((req, res) => {
      if (api.handle(req, res)) return;
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
    let base = "";
    const setProfile = async (id: string, patch: Record<string, unknown>) => {
      const res = await fetch(`${base}/__host/model/profile?id=${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const getProfile = async (id: string) => {
      const res = await fetch(`${base}/__host/model/profile?id=${encodeURIComponent(id)}`);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    return {
      model,
      other,
      supervisor,
      store,
      setProfile,
      getProfile,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
      start: () =>
        new Promise<void>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
            resolve();
          });
        }),
    };
  }

  it("returns true for a sampler edit on the resident model and persists it", async () => {
    const h = harness(makeModel());
    await h.start();
    try {
      const res = await h.setProfile(h.model.id, { temperature: 0.9 });
      expect(res.status).toBe(200);
      // The reply the desktop app reads to flip the button to "Reload".
      expect(res.body.requiresRestart).toBe(true);
      // And it survives: the store now carries the pending reload.
      expect(h.store.pendingReloadModelIds[h.model.id]).toBe(true);
      // The sampler value itself round-trips into the saved profile.
      expect(h.store.profiles[h.model.id]?.temperature).toBe(0.9);
    } finally {
      await h.close();
    }
  });

  it("keeps reporting the pending reload on GET until the model is reloaded", async () => {
    const h = harness(makeModel());
    await h.start();
    try {
      await h.setProfile(h.model.id, { topK: 50 });
      // A re-opened detail pane (GET) must still show the badge.
      expect((await h.getProfile(h.model.id)).body.requiresRestart).toBe(true);
      // Reloading the model is what clears it — the only other clear site is
      // service start. Simulate the serve.ts load success here.
      delete h.store.pendingReloadModelIds[h.model.id];
      expect((await h.getProfile(h.model.id)).body.requiresRestart).toBe(false);
    } finally {
      await h.close();
    }
  });

  it("does not earn a reload badge for an edit to an unloaded model", async () => {
    const h = harness(makeModel());
    await h.start();
    try {
      const res = await h.setProfile(h.other.id, { temperature: 0.9 });
      expect(res.status).toBe(200);
      expect(res.body.requiresRestart).toBe(false);
      expect(h.store.pendingReloadModelIds[h.other.id]).toBeUndefined();
      // The resident model was not touched either.
      expect(h.store.pendingReloadModelIds[h.model.id]).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("does not flag the resident model when nothing is loaded", async () => {
    const h = harness(null);
    await h.start();
    try {
      const res = await h.setProfile(h.model.id, { temperature: 0.9 });
      expect(res.status).toBe(200);
      expect(res.body.requiresRestart).toBe(false);
      expect(h.store.pendingReloadModelIds[h.model.id]).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("flags the resident model on any profile edit, not just samplers", async () => {
    const h = harness(makeModel());
    await h.start();
    try {
      const res = await h.setProfile(h.model.id, { contextSize: 16384 });
      expect(res.status).toBe(200);
      expect(res.body.requiresRestart).toBe(true);
      expect(h.store.pendingReloadModelIds[h.model.id]).toBe(true);
    } finally {
      await h.close();
    }
  });
});
