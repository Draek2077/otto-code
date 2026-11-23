import { expect, it } from "vitest";
import type { HostCommandPort } from "./host-command.js";
import { AcquisitionHost } from "./acquisition-host.js";

function fixture(supported = true) {
  const requests: { route: string; body: unknown }[] = [];
  const port: HostCommandPort = {
    instanceId: "fixture",
    request: async (route, signal, body) => {
      signal.throwIfAborted();
      requests.push({ route, body });
      if (route.endsWith("capabilities"))
        return {
          modelAcquisition: supported,
          catalog: true,
          hfSearch: true,
          inventory: true,
          jobs: true,
          events: true,
        };
      if (route === "/__host/models")
        return {
          models: [
            {
              id: "host/artifact",
              repo: "fixture/repo",
              catalogId: "catalog/stable",
              quant: "Q8_0",
              hasProjector: true,
            },
            {
              id: "host/unclassified",
              repo: "fixture/other",
              catalogId: null,
              quant: null,
              hasProjector: false,
            },
          ],
        };
      if (route.startsWith("/__host/hf/quants?"))
        return {
          repo: "fixture/repo",
          quants: [{ quant: "Q8_0", files: ["one.gguf", "two.gguf"], sizeBytes: 20 }],
          mmproj: { files: ["mmproj.gguf"], sizeBytes: 5 },
        };
      if (route.startsWith("/__host/hf/search?"))
        return {
          models: [
            { repo: "fixture/repo", downloads: 1, likes: 2, gated: false, summary: null },
            { repo: "fixture/other", downloads: 0, likes: 0, gated: true, summary: null },
          ],
        };
      if (route === "/__host/jobs/add") return { job: { id: "host-job" } };
      if (route.startsWith("/__host/jobs/status?"))
        return {
          job: {
            id: "host-job",
            state: "completed",
            progress: null,
            result: {
              repo: "fixture/repo",
              path: "owner display path",
              files: ["one.gguf"],
              totalBytes: 20,
            },
            error: null,
          },
        };
      throw new Error("Unexpected fixture request");
    },
    events: (_receive, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  };
  return { port, requests };
}
it("uses the owner's artifact identities to decorate quant rows and projectors", async () => {
  const value = fixture();
  const host = await AcquisitionHost.connect(value.port, new AbortController().signal);
  expect(await host.quantRows("fixture/repo")).toMatchObject([
    {
      quant: "Q8_0",
      files: 2,
      fileNames: ["one.gguf", "two.gguf"],
      modelId: "host/artifact",
      installed: true,
      projector: { file: "mmproj.gguf", installed: true },
    },
  ]);
});
it("joins search results against the owner's inventory rather than scanning a client home", async () => {
  const value = fixture();
  const host = await AcquisitionHost.connect(value.port, new AbortController().signal);
  expect(await host.search("fixture model", 25)).toMatchObject([
    { repo: "fixture/repo", installed: true, gated: "" },
    { repo: "fixture/other", installed: true, gated: "yes" },
  ]);
  expect(
    value.requests.some((request) => request.route.includes("query=fixture+model&limit=25")),
  ).toBe(true);
});
it("admits a host selection and consumes the accepted job without sending credentials or destinations", async () => {
  const value = fixture();
  const host = await AcquisitionHost.connect(value.port, new AbortController().signal);
  expect(
    await host.download("add", {
      repo: "fixture/repo",
      quant: "Q8_0",
      components: ["vision-projector"],
    }),
  ).toMatchObject({ repo: "fixture/repo", path: "owner display path", totalBytes: 20 });
  expect(value.requests.find((request) => request.route === "/__host/jobs/add")?.body).toEqual({
    repo: "fixture/repo",
    quant: "Q8_0",
    components: ["vision-projector"],
  });
});
it("gates an unsupported owner before metadata, transfer or local fallback", async () => {
  const value = fixture(false);
  await expect(
    AcquisitionHost.connect(value.port, new AbortController().signal),
  ).rejects.toMatchObject({ code: "UPDATE_HOST" });
  expect(value.requests).toEqual([{ route: "/__host/capabilities", body: undefined }]);
});
