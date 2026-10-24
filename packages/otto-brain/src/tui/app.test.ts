import { describe, expect, it } from "vitest";
import { App } from "./app.js";
import { MemoryScreen, MemoryTuiHost, modelRow, settle } from "../../test-tui.js";

function setup() {
  const host = new MemoryTuiHost();
  const screen = new MemoryScreen();
  let keyListener: ((key: string) => void) | null = null;
  const app = new App({
    host,
    screen,
    keys: (listener) => {
      keyListener = listener;
      return () => {
        keyListener = null;
      };
    },
  });
  const finished = app.run();
  return { host, screen, app, finished, keysAttached: () => keyListener !== null };
}

describe("original Brain terminal presentation over the owning host", () => {
  it("opens the model/configuration/budget/status workspace without a runtime", async () => {
    const fixture = setup();
    expect(fixture.screen.text).toContain("Otto Brain");
    for (const label of ["Models", "Configuration", "VRAM budget", "Status", "not installed"])
      expect(fixture.screen.text).toContain(label);
    expect(fixture.host.actions).toEqual([]);
    expect(fixture.host.retained).toBe(1);
    fixture.app.shutdown();
    await fixture.finished;
    expect(fixture.host.retained).toBe(0);
    expect(fixture.host.listeners.size).toBe(0);
    expect(fixture.screen.resizes.size).toBe(0);
    expect(fixture.keysAttached()).toBe(false);
  });

  it("preserves model navigation, filter spaces, and configuration decimal editing", async () => {
    const { app, host, finished } = setup();
    const second = modelRow("second model");
    host.current.models.push(second);
    host.publish();
    app.onKey("/");
    for (const key of ["s", "e", "c", "o", "n", "d", "space", "m"]) app.onKey(key);
    app.onKey("enter");
    expect(app.model?.id).toBe(second.model.id);
    app.onKey("tab");
    app.onKey("down");
    app.onKey("enter");
    for (const key of ["0", ".", "9", "5", "enter"]) app.onKey(key);
    await settle();
    expect(host.actions[0]).toMatchObject({
      type: "profile.save",
      modelId: second.model.id,
      patch: { temperature: 0.95 },
    });
    app.shutdown();
    await finished;
  });

  it("keeps model selection across reordered snapshots and profile identity on removal", async () => {
    const { app, host, finished } = setup();
    host.current.models.push(modelRow("zzz"));
    host.publish();
    app.onKey("down");
    app.onKey("tab");
    app.onKey("enter");
    app.onKey("9");
    const selected = app.model?.id;
    host.current.models.reverse();
    host.publish();
    expect(app.model?.id).toBe(selected);
    host.current.models = host.current.models.filter((entry) => entry.model.id !== selected);
    host.publish();
    app.onKey("enter");
    await settle();
    expect(host.actions).toEqual([]);
    app.shutdown();
    await finished;
  });

  it("delegates start, stop, fit, calibration, sweep, and benchmark without running an engine", async () => {
    const { app, host, finished } = setup();
    for (const key of ["s", "x", "m", "c", "w", "b", "r"]) {
      app.onKey(key);
      await settle();
    }
    expect(host.actions.map((action) => action.type)).toEqual([
      "model.load",
      "model.unload",
      "profile.fit",
      "job.start",
      "job.start",
      "job.start",
    ]);
    expect(host.actions.slice(-3)).toMatchObject([
      { operation: "calibrate" },
      { operation: "sweep" },
      { operation: "bench" },
    ]);
    app.shutdown();
    await finished;
  });

  it("fits the current draft against its origin revision before saving the suggested context", async () => {
    const { app, host, finished } = setup();
    host.results["profile.fit"] = { contextSize: 16384 };
    app.draft?.write("temperature", 0.9);
    app.applyMaxContext();
    await settle();
    expect(host.actions).toEqual([
      {
        type: "profile.fit",
        modelId: host.current.models[0].model.id,
        expectedRevision: "revision-1",
        patch: { temperature: 0.9 },
      },
      {
        type: "profile.save",
        modelId: host.current.models[0].model.id,
        expectedRevision: "revision-1",
        patch: { temperature: 0.9, contextSize: 16384 },
      },
    ]);
    expect(app.draft?.revision).toBe("revision-1+");
    app.shutdown();
    await finished;
  });

  it("does not save a fit without a GPU budget or overwrite an edit made during its preview", async () => {
    const { app, host, finished } = setup();
    app.applyMaxContext();
    await settle();
    expect(app.status.text).toContain("unavailable");
    let release!: () => void;
    host.wait = new Promise((resolve) => {
      release = resolve;
    });
    host.results["profile.fit"] = { contextSize: 16384 };
    app.applyMaxContext();
    app.draft?.write("contextSize", 8192);
    release();
    await settle();
    expect(host.actions.map((action) => action.type)).toEqual(["profile.fit", "profile.fit"]);
    expect(app.draft?.read("contextSize")).toBe(8192);
    app.shutdown();
    await finished;
  });

  it("pins rename/delete confirmations to their original model identity", async () => {
    const { app, host, finished } = setup();
    app.onKey("R");
    for (const key of ["N", "e", "w", "space", "n", "a", "m", "e", "enter"]) app.onKey(key);
    await settle();
    expect(host.actions[0]).toMatchObject({ type: "model.rename", displayName: "New name" });
    app.onKey("D");
    app.onKey("n");
    expect(host.actions).toHaveLength(1);
    app.onKey("D");
    app.onKey("y");
    await settle();
    app.onKey("u");
    app.onKey("y");
    await settle();
    expect(host.actions.slice(1).map((action) => action.type)).toEqual([
      "model.delete",
      "model.resetName",
    ]);
    app.shutdown();
    await finished;
  });

  it("does not delete a model the owning host reports resident or shared", async () => {
    const { app, host, finished } = setup();
    host.current.models[0].deleteBlocked = "Unload this resident model first.";
    host.publish();
    app.onKey("D");
    app.onKey("y");
    await settle();
    expect(app.status.text).toContain("Unload");
    expect(host.actions).toEqual([]);
    app.shutdown();
    await finished;
  });

  it("shows explicit unsupported actions and never sends disabled mutations", async () => {
    const { app, host, screen, finished } = setup();
    host.current.availableActions = [];
    host.publish();
    expect(screen.text).toContain("unavailable");
    app.onKey("s");
    await settle();
    expect(app.status.text).toContain("unavailable");
    expect(host.actions).toEqual([]);
    app.onKey("tab");
    app.onKey("right");
    await settle();
    expect(host.actions).toEqual([]);
    app.shutdown();
    await finished;
  });

  it("retains a conflicted draft through live updates and asks before reload", async () => {
    const { app, host, finished } = setup();
    host.failure = { status: "conflict", message: "Profile changed in another client." };
    app.onKey("tab");
    app.onKey("right");
    await settle();
    expect(app.profile?.contextSize).toBe(16384);
    host.current.models[0].profile.contextSize = 4096;
    host.publish();
    expect(app.profile?.contextSize).toBe(16384);
    app.onKey("r");
    expect(app.confirming).not.toBeNull();
    app.onKey("n");
    expect(app.profile?.contextSize).toBe(16384);
    app.onKey("r");
    app.onKey("y");
    expect(app.profile?.contextSize).toBe(4096);
    app.shutdown();
    await finished;
  });

  it("discards revision-bound drafts and dialogs after a new host instance", async () => {
    const { app, host, finished } = setup();
    app.onKey("R");
    host.current = { ...host.current, instanceId: "new-instance" };
    host.publish();
    expect(app.renaming).toBe(false);
    expect(app.status.text).toContain("restarted");
    app.shutdown();
    await finished;
  });

  it("renders live logs and simultaneous residents from snapshots, including actual slot phases", async () => {
    const { app, host, screen, finished } = setup();
    host.current.residents = [
      {
        residentId: "process-a",
        modelId: "one",
        displayName: "one",
        phase: "ready",
        pid: 1,
        slots: [{ slot: 0, phase: "thinking" }],
      },
      {
        residentId: "process-b",
        modelId: "two",
        displayName: "two",
        phase: "ready",
        pid: 2,
        slots: [{ slot: 0, phase: "generating" }],
      },
    ];
    host.current.logs = ["[runtime:a] loaded", "[operation:calibrate] measured"];
    host.publish();
    app.onKey("l");
    expect(screen.text).toContain("[operation:calibrate] measured");
    expect(screen.text).toContain("thinking");
    expect(screen.text).toContain("generating");
    app.shutdown();
    await finished;
  });

  it("searches HF, browses quants and requests a host-owned download job", async () => {
    const { app, host, finished } = setup();
    host.results["hf.search"] = [
      {
        repo: "author/new",
        author: "author",
        downloads: 100,
        likes: 1,
        updatedAt: null,
        gated: false,
        summary: null,
      },
    ];
    host.results["hf.quants"] = {
      repo: "author/new",
      quants: [{ quant: "Q5_K_M", files: ["file.gguf"], sizeBytes: 100 }],
      mmproj: null,
    };
    app.onKey("f");
    app.onKey("n");
    app.onKey("enter");
    await settle();
    app.onKey("enter");
    await settle();
    app.onKey("enter");
    await settle();
    expect(host.actions).toEqual([
      { type: "hf.search", query: "n" },
      { type: "hf.quants", repo: "author/new" },
      { type: "hf.add", repo: "author/new", quant: "Q5_K_M" },
    ]);
    app.shutdown();
    await finished;
  });

  it("ignores a late search result after its dialog is closed", async () => {
    const { app, host, finished } = setup();
    let release = (): void => {};
    host.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.onKey("f");
    app.onKey("x");
    app.onKey("enter");
    app.onKey("escape");
    app.onKey("escape");
    release();
    await settle();
    expect(app.search).toBeNull();
    app.shutdown();
    await finished;
  });

  it("exposes catalog/runtime/jobs views with durable explicit cancellation", async () => {
    const { app, host, screen, finished } = setup();
    host.current.catalog = [
      {
        id: "catalog-model",
        displayName: "Catalog model",
        description: "Fixture",
        installed: false,
      },
    ];
    host.current.runtimes = [
      {
        id: "build-1",
        label: "llama.cpp",
        version: "b1",
        installed: false,
        selected: false,
        unavailableReason: null,
      },
    ];
    host.current.jobs = [
      {
        id: "job-1",
        operation: "calibrate",
        modelId: null,
        state: "running",
        fraction: 0.5,
        error: null,
        progress: ["measuring"],
        cancelable: true,
      },
    ];
    app.onKey("C");
    app.onKey("enter");
    await settle();
    app.onKey("escape");
    app.onKey("t");
    app.onKey("enter");
    await settle();
    app.onKey("escape");
    app.onKey("J");
    expect(screen.text).toContain("measuring");
    app.onKey("x");
    await settle();
    expect(host.actions.map((action) => action.type)).toEqual([
      "catalog.pull",
      "runtime.install",
      "job.cancel",
    ]);
    app.shutdown();
    await finished;
    expect(host.actions.filter((action) => action.type === "job.cancel")).toHaveLength(1);
    expect(host.signals.every((signal) => signal?.aborted)).toBe(true);
  });

  it("does not expose raw request exceptions, and releases resources on Ctrl-C inside a dialog", async () => {
    const { app, host, finished } = setup();
    host.transportError = new Error("secret credential and private path");
    app.onKey("s");
    await settle();
    expect(app.status.text).not.toContain("secret");
    app.onKey("f");
    app.onKey("ctrl-c");
    await finished;
    expect(host.retained).toBe(0);
    expect(host.listeners.size).toBe(0);
  });

  it("preserves terminal footer after resize and keeps small terminals navigable", async () => {
    const { app, screen, finished } = setup();
    screen.columns = 40;
    screen.rows = 10;
    for (const resize of screen.resizes) resize();
    expect(screen.text).toContain("Resize the terminal");
    expect(screen.frames.at(-1)?.length).toBeLessThanOrEqual(9);
    app.onKey("q");
    await finished;
  });
});
