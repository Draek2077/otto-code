import { expect, test } from "vitest";
import { z } from "zod";
import { generateProviderContextText } from "@getpaseo/plugin/server/otto-openai";
import { createContextTextGeneration, type ContextTextGenerationPorts } from "./text-generation.js";

const request = {
  cwd: "/fixture",
  prompt: "Bounded prose only",
  schema: z.object({ text: z.string() }),
  schemaName: "Proposal",
  agentTitle: "Context compaction",
};
function fixture(responses: unknown[] = [{ ok: true, value: { text: '{"text":"proposal"}' } }]) {
  const calls: { owner: string; method: string; input: unknown }[] = [];
  const ports: ContextTextGenerationPorts = {
    providerOwner: (id) => (id === "api" || id === "brain" ? `owner-${id}` : undefined),
    candidates: async () => [{ provider: "native-cli" }, { provider: "api", model: "fixture" }],
    invoke: async (owner, method, input) => {
      calls.push({ owner, method, input });
      return responses.shift();
    },
  };
  return { ports, calls };
}
test("default resolution skips native sessions and invokes only the owning text RPC", async () => {
  const { ports, calls } = fixture();
  await expect(createContextTextGeneration(ports).generate(request)).resolves.toEqual({
    text: "proposal",
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    owner: "owner-api",
    method: generateProviderContextText.name,
    input: { providerId: "api", model: "fixture" },
  });
  expect(JSON.stringify(calls)).toContain("Bounded prose only");
  expect(JSON.stringify(calls)).not.toContain("native-cli");
});
test("explicit Brain selection retains its model and never consults default candidates", async () => {
  const { ports, calls } = fixture();
  ports.candidates = async () => {
    throw Error("Defaults must not be read");
  };
  await createContextTextGeneration(ports, { provider: "brain", model: "resident-model" }).generate(
    request,
  );
  expect(calls[0]).toMatchObject({
    owner: "owner-brain",
    input: { providerId: "brain", model: "resident-model" },
  });
});
test("malformed text receives a bounded text-only correction request", async () => {
  const { ports, calls } = fixture([
    { ok: true, value: { text: "not JSON" } },
    { ok: true, value: { text: '{"text":"corrected"}' } },
  ]);
  await expect(createContextTextGeneration(ports).generate(request)).resolves.toEqual({
    text: "corrected",
  });
  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[1])).toContain("Previous response was invalid");
});
test("explicit unsupported CLI selections cannot create or fall through to an agent session", async () => {
  const { ports, calls } = fixture();
  await expect(
    createContextTextGeneration(ports, { provider: "native-cli", model: "native" }).generate(
      request,
    ),
  ).rejects.toThrow("Normal writable chat sessions are never used");
  expect(calls).toHaveLength(0);
});
test("provider failures are sanitized and explicit selections never use a different provider", async () => {
  const { ports, calls } = fixture([
    { ok: false, error: { code: "unavailable", message: "secret-provider-stderr" } },
  ]);
  await expect(
    createContextTextGeneration(ports, { provider: "api", model: "fixture" }).generate(request),
  ).rejects.toThrow(/^Read-only proposal generation is unavailable/);
  expect(calls).toHaveLength(1);
});
test("schema-invalid responses stop after the bounded correction attempts", async () => {
  const { ports, calls } = fixture(
    Array.from({ length: 5 }, () => ({ ok: true, value: { text: '{"wrong":true}' } })),
  );
  await expect(createContextTextGeneration(ports).generate(request)).rejects.toThrow(
    "Read-only proposal generation is unavailable",
  );
  expect(calls).toHaveLength(3);
});
test("an explicit native selection uses only its enforced read-only operation and bounded schema correction", async () => {
  const { ports, calls } = fixture();
  const nativeCalls: string[] = [];
  ports.native = async (input) => {
    nativeCalls.push(input.prompt);
    expect(input).toMatchObject({ provider: "native-cli", model: "selected", cwd: "/fixture" });
    return nativeCalls.length === 1 ? "not json" : '{"text":"native proposal"}';
  };
  await expect(
    createContextTextGeneration(ports, { provider: "native-cli", model: "selected" }).generate(
      request,
    ),
  ).resolves.toEqual({ text: "native proposal" });
  expect(nativeCalls).toHaveLength(2);
  expect(nativeCalls[1]).toContain("Previous response was invalid");
  expect(calls).toHaveLength(0);
});
