import { expect, it } from "vitest";
import { BrainJobs, type BrainJobSubject } from "./jobs.js";

const subject: BrainJobSubject = {
  modelId: "fixture/model",
  catalogModelId: null,
  repo: null,
  quant: null,
};
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("reports actual admission, retains progress and isolates returned snapshots", async () => {
  const admission = gate();
  const jobs = new BrainJobs(() => {});
  const payload = { measured: [1] };
  const job = jobs.start("calibrate", subject, async (context) => {
    await admission.promise;
    context.started();
    context.progress(payload);
    payload.measured.push(2);
    return { measured: true };
  });
  expect(job.state).toBe("queued");
  job.subject.modelId = "other";
  expect(jobs.list()[0]!.subject.modelId).toBe(subject.modelId);
  admission.resolve();
  const result = await jobs.wait(job.id);
  expect(result).toMatchObject({
    state: "completed",
    progress: { measured: [1] },
    result: { measured: true },
  });
  expect(result!.startedAt).not.toBeNull();
  await jobs.close();
});

it("cancels queued work before it starts", async () => {
  const jobs = new BrainJobs(() => {});
  let called = false;
  const job = jobs.start("sweep", subject, async () => {
    called = true;
    return null;
  });
  expect(jobs.cancel(job.id)).toBe(true);
  expect(await jobs.wait(job.id)).toMatchObject({
    state: "canceled",
    startedAt: null,
    cancelRequested: true,
  });
  expect(called).toBe(false);
  await jobs.close();
});

it("keeps cancellation pending until owned work settles and close awaits it", async () => {
  const admitted = gate();
  const stopped = gate();
  const jobs = new BrainJobs(() => {});
  const job = jobs.start("benchmark", subject, async ({ started, signal }) => {
    started();
    admitted.resolve();
    await stopped.promise;
    signal.throwIfAborted();
    return null;
  });
  await admitted.promise;
  jobs.cancel(job.id);
  expect(jobs.list()[0]).toMatchObject({
    state: "running",
    cancelRequested: true,
    finishedAt: null,
  });
  let closed = false;
  const closing = jobs.close().then(() => {
    closed = true;
    return undefined;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  stopped.resolve();
  await closing;
  expect(await jobs.wait(job.id)).toMatchObject({ state: "canceled" });
  expect(() => jobs.start("sweep", subject, async () => null)).toThrow("closed");
});

it("bounds active and retained jobs without evicting active work", async () => {
  const admission = gate();
  const jobs = new BrainJobs(() => {}, { active: 1, retained: 2 });
  const first = jobs.start("sweep", subject, async () => {
    await admission.promise;
    return null;
  });
  expect(() => jobs.start("sweep", subject, async () => null)).toThrow("limit");
  admission.resolve();
  await jobs.wait(first.id);
  const second = jobs.start("sweep", subject, async () => null);
  await jobs.wait(second.id);
  const third = jobs.start("sweep", subject, async () => null);
  await jobs.wait(third.id);
  expect(jobs.list().map((job) => job.id)).toEqual([second.id, third.id]);
  expect(jobs.cancel("unknown")).toBe(false);
  await jobs.close();
});

it("bounds payloads and never exposes raw failures", async () => {
  const jobs = new BrainJobs(() => {});
  const failure = jobs.start("pull", subject, async () => {
    throw new Error("secret fixture token");
  });
  const large = jobs.start("pull", subject, async () => "x".repeat(512 * 1024));
  for (const job of [failure, large]) {
    const result = await jobs.wait(job.id);
    expect(result!.state).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("secret fixture token");
    expect(result!.result).toBeNull();
  }
  await jobs.close();
});
