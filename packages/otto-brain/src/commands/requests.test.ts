import { expect, it } from "vitest";
import {
  brainCommandHttpRequest,
  encodeBrainCommandRequest,
  BrainCommandRequestSchema,
} from "./requests.js";

it("preserves explicit full and quick scan choices without accepting ambiguous metadata", () => {
  for (const metadata of [true, false]) {
    const route = `/__host/models/discover?metadata=${metadata}`;
    expect(brainCommandHttpRequest(encodeBrainCommandRequest(route))).toEqual({ route });
    expect(encodeBrainCommandRequest(route)).toEqual({ operation: "scan", metadata });
  }
  for (const query of ["metadata=0", "metadata=false&metadata=true", "metadata=true&extra=1"])
    expect(() => encodeBrainCommandRequest(`/__host/models/discover?${query}`)).toThrow();
});

it("preserves an explicit benchmark plan and bundle selection through the fixed operation contract", () => {
  const plan = {
    operation: "benchmark",
    modelId: "owner/model",
    options: {
      execute: false,
      depths: [1000, 16000],
      concurrency: 2,
      only: ["tool-use"],
      repository: {
        directory: "/explicit/owner/source",
        workspace: "fixture",
        workspaceDirectory: "packages/fixture",
        ref: "reviewed-ref",
        maxTasks: 7,
      },
    },
  };
  expect(brainCommandHttpRequest(encodeBrainCommandRequest("/__host/jobs", plan))).toEqual({
    route: "/__host/jobs",
    body: plan,
  });
  const selection = {
    modelId: "catalog/opaque",
    file: "selected.Q8.gguf",
    components: ["projector"],
    componentsOnly: true,
  };
  expect(
    brainCommandHttpRequest(encodeBrainCommandRequest("/__host/jobs/pull", selection)),
  ).toEqual({ route: "/__host/jobs/pull", body: selection });
});

it("encodes query values without interpreting repository and job identities as URL syntax", () => {
  expect(encodeBrainCommandRequest("/__host/hf/search?limit=7&query=a%26b%3Dc")).toEqual({
    operation: "search",
    limit: 7,
    query: "a&b=c",
  });
  expect(brainCommandHttpRequest({ operation: "job-read", id: "opaque?x&y" })).toEqual({
    route: "/__host/jobs/status?id=opaque%3Fx%26y",
  });
});

it.each([
  { route: "https://different.invalid/__host/models" },
  { route: "/__host/settings" },
  { route: "/__host/models?extra=1" },
  { route: "/__host/hf/search?query=a&limit=7&query=b" },
  { route: "/__host/hf/search?query=a&limit=0" },
  { route: "/__host/jobs/status?id=known#fragment" },
  { route: "/__host/../models" },
  { route: "/__host/runtime/select", body: { runtimeId: "opaque", path: "/untrusted/executable" } },
  { route: "/__host/jobs", body: { operation: "shell", modelId: "known" } },
  {
    route: "/__host/jobs/add",
    body: { repo: "owner/model", quant: "Q8", token: "not-a-command-field" },
  },
])(
  "rejects unsupported destinations, ambiguous queries and unowned control fields: $route",
  ({ route, body }) => {
    expect(() => encodeBrainCommandRequest(route, body)).toThrow();
  },
);

it("does not accept a path-shaped generic proxy request on the daemon side", () => {
  expect(
    BrainCommandRequestSchema.safeParse({ operation: "inventory", route: "/other", body: {} })
      .success,
  ).toBe(false);
  expect(
    BrainCommandRequestSchema.safeParse({ operation: "request", route: "/__host/models" }).success,
  ).toBe(false);
});
