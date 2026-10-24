import { afterEach, expect, it } from "vitest";
import type { Runtime } from "../types.js";
import { BrainJobs } from "./jobs.js";
import {
  RuntimeManagement,
  runtimeIdentity,
  type RuntimeManagementPorts,
} from "./runtime-management.js";

const runtimes: Runtime[] = [
  {
    label: "first",
    version: "b10000",
    dir: "/fixture/first",
    exe: "/fixture/first/llama-server",
    vendorDir: null,
    source: "managed",
  },
  {
    label: "second",
    version: "b10001",
    dir: "/fixture/second",
    exe: "/fixture/second/llama-server",
    vendorDir: null,
    source: "managed",
  },
  {
    label: "external",
    version: "b10002",
    dir: "/fixture/external",
    exe: "/fixture/external/llama-server",
    vendorDir: null,
    source: "lmstudio",
  },
];
const cleanup: BrainJobs[] = [];
afterEach(async () => {
  for (const jobs of cleanup.splice(0)) await jobs.close();
});
function fixture(overrides: Partial<RuntimeManagementPorts> = {}) {
  const jobs = new BrainJobs(() => {});
  cleanup.push(jobs);
  let selected: Runtime | null = runtimes[0]!;
  let revision = 0;
  let latestReads = 0;
  const installs: string[] = [];
  const removals: string[] = [];
  const ports: RuntimeManagementPorts = {
    jobs,
    variants: ["cpu"],
    list: () => runtimes,
    selected: () => selected,
    selectionRevision: () => String(revision),
    select: (runtime, expected) => {
      if (expected !== undefined && expected !== String(revision)) return false;
      selected = runtime;
      revision++;
      return true;
    },
    assertUnused: () => {},
    remove: (runtime) => {
      removals.push(runtime.exe);
    },
    latest: async () => {
      latestReads++;
      return "b99999";
    },
    install: async (build, _variant, progress, signal) => {
      signal.throwIfAborted();
      installs.push(build);
      progress({
        phase: "downloading",
        receivedBytes: 1,
        totalBytes: 2,
        asset: "private host path",
      });
      return { ...runtimes[0]!, version: build };
    },
    changed: () => {},
    requireWrite: () => {},
    ...overrides,
  };
  const manager = new RuntimeManagement(ports);
  return {
    manager,
    jobs,
    installs,
    removals,
    ports,
    selected: () => selected,
    latestReads: () => latestReads,
  };
}

it("issues opaque host identities separately from display paths without changing the installed list", () => {
  const value = fixture();
  const snapshot = value.manager.list();
  expect(snapshot.runtimes).toHaveLength(3);
  expect(snapshot.runtimes[0]!.id).not.toContain("/fixture/");
  expect(snapshot.runtimes[0]!.dir).toBe(runtimes[0]!.dir);
  expect(snapshot.runtimes[0]!.id).toBe(runtimeIdentity(runtimes[0]!));
  expect(runtimes).toHaveLength(3);
});
it("resolves latest when the job runs, installs that exact build and restores automatic selection", async () => {
  const value = fixture();
  const candidate = value.manager.offer("latest");
  const { job } = value.manager.install(candidate.id);
  expect(() => value.manager.install(candidate.id)).toThrow("already being installed");
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { version: "b99999", selectionApplied: true },
  });
  expect(value.installs).toEqual(["b99999"]);
  expect(value.latestReads()).toBe(1);
  expect(value.selected()).toBeNull();
  expect(JSON.stringify(value.jobs.get(job.id))).not.toContain("private host path");
});
it("releases an install canceled before execution so the candidate can be retried", async () => {
  const value = fixture();
  const candidate = value.manager.offer("latest");
  const first = value.manager.install(candidate.id);
  value.jobs.cancel(first.job.id);
  expect(await value.jobs.wait(first.job.id)).toMatchObject({ state: "canceled" });
  expect(value.installs).toEqual([]);
  const second = value.manager.install(candidate.id);
  expect(await value.jobs.wait(second.job.id)).toMatchObject({ state: "completed" });
  expect(value.installs).toEqual(["b99999"]);
});
it("does not replace a failed latest lookup with a packaged pin", async () => {
  const value = fixture({
    latest: async () => {
      throw new Error("private network failure");
    },
  });
  const { job } = value.manager.install(value.manager.offer("latest").id);
  expect(await value.jobs.wait(job.id)).toMatchObject({ state: "failed" });
  expect(value.installs).toEqual([]);
  expect(value.selected()).toBe(runtimes[0]);
  expect(JSON.stringify(value.jobs.get(job.id))).not.toContain("private network failure");
});

it("retains a successful installation with an explicit GPU diagnostic warning", async () => {
  const value = fixture({ diagnose: async () => "Fixture has no GPU device" });
  const { job } = value.manager.install(value.manager.offer("b10004").id);
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { warning: "Fixture has no GPU device" },
  });
});
it("keeps an explicitly named build pinned without a latest lookup or selection reset", async () => {
  const value = fixture();
  const { job } = value.manager.install(value.manager.offer("b10004", "cpu").id);
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { version: "b10004", selectionApplied: false },
  });
  expect(value.latestReads()).toBe(0);
  expect(value.installs).toEqual(["b10004"]);
  expect(value.selected()).toBe(runtimes[0]);
});
it("preserves a peer's runtime choice made during an update", async () => {
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const value = fixture({
    install: async (build) => {
      await blocked;
      return { ...runtimes[0]!, version: build };
    },
  });
  const { job } = value.manager.install(value.manager.offer("latest").id);
  value.manager.select(runtimeIdentity(runtimes[1]!));
  finish();
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { selectionApplied: false },
  });
  expect(value.selected()).toBe(runtimes[1]);
});
it("removes only an unselected unused managed runtime and rejects client paths", () => {
  const value = fixture({
    assertUnused: (runtime) => {
      if (runtime.exe === runtimes[1]!.exe)
        throw new Error("fixture resident is using this runtime");
    },
  });
  expect(() => value.manager.remove(runtimeIdentity(runtimes[0]!))).toThrow("Select another");
  expect(() => value.manager.remove(runtimeIdentity(runtimes[1]!))).toThrow("resident");
  expect(() => value.manager.remove(runtimeIdentity(runtimes[2]!))).toThrow("Otto-managed");
  expect(() => value.manager.remove("/fixture/first")).toThrow("not found");
  expect(value.removals).toEqual([]);
});
it("publishes runtime removal as a real host job and rechecks selection before deleting", async () => {
  const f = fixture();
  const id = runtimeIdentity(runtimes[1]!);
  const admitted = f.manager.remove(id);
  expect(f.removals).toEqual([]);
  f.manager.select(id);
  expect(await f.jobs.wait(admitted.job.id)).toMatchObject({
    operation: "runtime-remove",
    state: "failed",
  });
  expect(f.removals).toEqual([]);
  f.manager.select(runtimeIdentity(runtimes[0]!));
  const accepted = f.manager.remove(id);
  expect(await f.jobs.wait(accepted.job.id)).toMatchObject({
    operation: "runtime-remove",
    state: "completed",
    result: { runtimeId: id },
  });
  expect(f.removals).toEqual([runtimes[1]!.exe]);
});
it("accepts only supported host install choices and bounds their retained catalog", () => {
  const value = fixture();
  expect(() => value.manager.offer("https://untrusted.invalid/archive")).toThrow("build tag");
  expect(() => value.manager.offer("b10004", "cuda")).toThrow("not available");
  expect(() => value.manager.install("../../runtime")).toThrow("not found");
  for (let index = 0; index < 63; index++) value.manager.offer(`b${index + 1}`);
  expect(() => value.manager.offer("b99998")).toThrow("Too many");
});
it("propagates host shutdown cancellation into runtime acquisition and releases the install latch", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const value = fixture({
    install: async (_build, _variant, _progress, signal) => {
      entered();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
      throw new Error("Unreachable fixture continuation");
    },
  });
  const { job } = value.manager.install(value.manager.offer("b10004").id);
  await started;
  await value.jobs.close();
  expect(value.jobs.get(job.id)?.state).toBe("canceled");
  expect(value.selected()).toBe(runtimes[0]);
});
