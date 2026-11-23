import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { createSupervisorFixture } from "../../test-runtime.js";
import { EngineProcess } from "./engine-process.js";

const fixtures: Awaited<ReturnType<typeof createSupervisorFixture>>[] = [];
const processes: EngineProcess[] = [];
afterEach(async () => {
  for (const process of processes.splice(0)) await process.stop();
  for (const owned of fixtures.splice(0)) rmSync(owned.root, { recursive: true, force: true });
});
async function fixture() {
  const value = await createSupervisorFixture();
  fixtures.push(value);
  return value;
}

it("does not launch after cancellation during lazy runtime/port resolution", async () => {
  const child = await fixture();
  let release!: (supervisor: typeof child.supervisor) => void;
  const process = new EngineProcess(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  processes.push(process);
  const loading = process.start(child.model, child.profile).catch(() => "cancelled");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stopping = process.stop();
  release(child.supervisor);
  expect(await loading).toBe("cancelled");
  await stopping;
  expect(child.supervisor.args).toBeNull();
  expect(process.state).toBe("stopped");
});

it("preserves operation verbosity and assigns a fresh resident identity for each native lifetime", async () => {
  const first = await fixture();
  const second = await fixture();
  let count = 0;
  const process = new EngineProcess(async () =>
    ++count === 1 ? first.supervisor : second.supervisor,
  );
  processes.push(process);
  process.logVerbosity = 0;
  await process.start(first.model, first.profile);
  const residentId = process.residentId;
  expect(first.supervisor.logVerbosity).toBe(0);
  await process.stop();
  await process.start(second.model, second.profile);
  expect(process.residentId).not.toBe(residentId);
  expect(second.supervisor.logVerbosity).toBe(0);
});
