import { expect, it } from "vitest";
import type { HostCommandPort } from "./host-command.js";
import { runHostedRuntimeInstall, runHostedRuntimeRemove } from "./runtime.js";

function fixture() {
  const requests: { route: string; body: unknown }[] = [];
  let supported = true;
  let installed = true;
  const row = {
    id: "runtime/host-owned",
    label: "cpu-managed-b10004",
    displayName: "CPU b10004",
    version: "b10004",
    source: "managed",
    dir: "/fixture/host/runtime",
  };
  const port: HostCommandPort = {
    instanceId: "fixture",
    request: async (route, signal, body) => {
      signal.throwIfAborted();
      requests.push({ route, body });
      if (route.endsWith("capabilities")) return { runtimes: supported, jobs: true, events: true };
      if (route.endsWith("runtimes")) return { runtimes: installed ? [row] : [] };
      if (route.endsWith("candidate")) return { id: "candidate/issued-by-host" };
      if (route.endsWith("runtime-install")) return { job: { id: "job/issued-by-host" } };
      if (route.includes("/status?"))
        return {
          job: {
            id: "job/issued-by-host",
            state: "completed",
            progress: null,
            result: { runtimeId: row.id, warning: null },
            error: null,
          },
        };
      if (route.endsWith("remove")) {
        installed = false;
        return { ok: true };
      }
      throw new Error("Unexpected fixture request");
    },
    events: (_receive, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  };
  return {
    port,
    row,
    requests,
    unsupported: () => {
      supported = false;
    },
  };
}
it("exchanges a build choice for a host-issued install identity and waits for its job", async () => {
  const value = fixture();
  expect(
    await runHostedRuntimeInstall(
      value.port,
      { build: "latest", variant: "cpu" },
      new AbortController().signal,
    ),
  ).toEqual(value.row);
  expect(value.requests.find((request) => request.route.endsWith("candidate"))?.body).toEqual({
    build: "latest",
    variant: "cpu",
  });
  expect(value.requests.find((request) => request.route.endsWith("runtime-install"))?.body).toEqual(
    { runtimeId: "candidate/issued-by-host" },
  );
});
it("removes by the resolved host identity rather than sending a local path or name", async () => {
  const value = fixture();
  expect(
    await runHostedRuntimeRemove(value.port, value.row.label, new AbortController().signal),
  ).toEqual([]);
  expect(value.requests.find((request) => request.route.endsWith("remove"))?.body).toEqual({
    runtimeId: value.row.id,
  });
});
it("rejects invalid build or variant input before starting a host request", async () => {
  const value = fixture();
  await expect(
    runHostedRuntimeInstall(value.port, { build: "../../runtime" }, new AbortController().signal),
  ).rejects.toMatchObject({ code: "INVALID_RUNTIME" });
  await expect(
    runHostedRuntimeInstall(value.port, { variant: "shell-command" }, new AbortController().signal),
  ).rejects.toMatchObject({ code: "INVALID_RUNTIME" });
  expect(value.requests).toEqual([]);
});
it("requires the runtime-management capability without falling back to direct filesystem writes", async () => {
  const value = fixture();
  value.unsupported();
  await expect(
    runHostedRuntimeRemove(value.port, value.row.label, new AbortController().signal),
  ).rejects.toMatchObject({ code: "UPDATE_HOST" });
  expect(value.requests.map((request) => request.route)).toEqual(["/__host/capabilities"]);
});
