import { expect, test } from "vitest";
import { BrainRequestLeases } from "./request-leases.js";

function blocked(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(new Error("Read canceled")), { once: true }),
  );
}
test("a resource release cancels only the requesting session's transient read", async () => {
  const reads = new BrainRequestLeases();
  const first = reads.run("old-session", "same-id", blocked).catch((error) => error);
  let otherAborted = false;
  const other = reads
    .run("new-session", "same-id", (signal) => {
      signal.addEventListener("abort", () => {
        otherAborted = true;
      });
      return blocked(signal);
    })
    .catch((error) => error);
  reads.release("old-session", "same-id");
  expect(await first).toMatchObject({ message: "Read canceled" });
  expect(otherAborted).toBe(false);
  reads.releaseClient("new-session");
  expect(await other).toMatchObject({ message: "Read canceled" });
});
test("pending reads are bounded and cleanup releases their admission after failure or disconnect", async () => {
  const reads = new BrainRequestLeases();
  const pending: Promise<unknown>[] = [];
  for (let index = 0; index < 4; index++)
    pending.push(reads.run("client", String(index), blocked).catch((error) => error));
  await expect(reads.run("client", "fifth", async () => 1)).rejects.toThrow("Too many");
  reads.close();
  await Promise.all(pending);
  expect(await reads.run("client", "fresh", async () => 1)).toBe(1);
});
