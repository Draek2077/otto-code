import http from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { ProfileSchema } from "../config/schema.js";
import type { ModelOperationProcess, OperationSupervisor } from "./process.js";
import { EXPECTED_FILES, sweep } from "./sweep.js";

const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(handler?: http.RequestListener) {
  let posted: unknown;
  const server = http.createServer(
    handler ??
      (async (request, response) => {
        let text = "";
        for await (const chunk of request) text += chunk;
        posted = JSON.parse(text);
        response.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: EXPECTED_FILES.join("\n"),
                  reasoning_content: "measured reasoning",
                },
              },
            ],
            usage: { completion_tokens: 50 },
            timings: { predicted_per_second: 25 },
          }),
        );
      }),
  );
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture not listening");
  const starts: number[] = [];
  let stops = 0;
  const supervisor: OperationSupervisor = {
    host: "127.0.0.1",
    internalPort: address.port,
    logVerbosity: 1,
    allocationLogLines: [],
    vramAtReadyBytes: null,
    vramBaselineBytes: null,
    loadSeconds: 0,
  };
  const lease: ModelOperationProcess = {
    supervisor,
    start: async (profile) => {
      starts.push(profile.reasoningBudget);
    },
    stop: async () => {
      stops++;
    },
  };
  return { lease, starts, stops: () => stops, posted: () => posted };
}

it("runs every budget through the supplied resident lease and retains real completion counters", async () => {
  const f = await fixture();
  const profile = ProfileSchema.parse({ contextSize: 4096, reasoningBudget: 900 });
  const report = await sweep({
    process: f.lease,
    profile,
    budgets: [0, 512, -1],
    releaseDelayMs: 0,
  });
  expect(f.starts).toEqual([0, 512, -1]);
  expect(f.stops()).toBe(3);
  expect(report.recommended).toBe(512);
  expect(report.results[0]).toMatchObject({
    filesDelivered: 4,
    outputTokens: 50,
    tokensPerSecond: 25,
    finishReason: "stop",
    reasoningChars: 18,
  });
  expect(f.posted()).toMatchObject({ max_tokens: 8192, temperature: 0.7 });
  expect(profile.reasoningBudget).toBe(900);
});

it("records a failed load and continues the remaining candidates after releasing its lease", async () => {
  const f = await fixture();
  const original = f.lease.start;
  f.lease.start = async (profile) => {
    await original(profile);
    if (profile.reasoningBudget === 0) throw new Error("fixture allocation failed");
  };
  const report = await sweep({
    process: f.lease,
    profile: ProfileSchema.parse({ contextSize: 4096 }),
    budgets: [0, 512],
    releaseDelayMs: 0,
  });
  expect(report.results[0].error).toBe("fixture allocation failed");
  expect(report.results[1].error).toBeNull();
  expect(report.recommended).toBe(512);
  expect(f.stops()).toBe(2);
});

it("cancels a silent in-flight model and never starts the following candidate", async () => {
  const controller = new AbortController();
  const f = await fixture(() => controller.abort(new Error("fixture cancelled")));
  await expect(
    sweep({
      process: f.lease,
      profile: ProfileSchema.parse({ contextSize: 4096 }),
      budgets: [0, 512],
      signal: controller.signal,
      releaseDelayMs: 0,
    }),
  ).rejects.toThrow("fixture cancelled");
  expect(f.starts).toEqual([0]);
  expect(f.stops()).toBe(1);
});

it("rejects invalid candidate plans before acquiring the model", async () => {
  const f = await fixture();
  for (const budgets of [[], [-2], [0.5], [Number.NaN], Array(65).fill(0)]) {
    await expect(
      sweep({
        process: f.lease,
        profile: ProfileSchema.parse({ contextSize: 4096 }),
        budgets,
        releaseDelayMs: 0,
      }),
    ).rejects.toThrow("Sweep budgets");
  }
  expect(f.starts).toEqual([]);
  expect(f.stops()).toBe(0);
});
