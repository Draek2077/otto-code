import { expect, test } from "vitest";
import { providerSettings } from "../shared/settings.js";
import { qualifyModel, type EndpointProfile } from "./endpoints.js";
import { generateToolFreeText } from "./text-generation.js";
import { createOpenAiProvider } from "./provider.js";

function stream(deltas: unknown[], finish = "stop") {
  const chunks: unknown[] = deltas.map((delta) => ({ choices: [{ index: 0, delta }] }));
  chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: finish }] });
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
const settings = providerSettings.schema.parse({ baseUrl: "https://fixture.invalid/v1" });
const profile: EndpointProfile = { id: "primary", label: "Fixture", settings };

test("the direct request contains only the supplied prose prompt and no tool definitions", async () => {
  const requests: Request[] = [];
  const transport: typeof fetch = async (url, init) => {
    requests.push(new Request(url, init));
    return stream([{ content: '{"files":[]}' }]);
  };
  const result = await generateToolFreeText({
    profile,
    models: [],
    model: "fixture",
    prompt: "Untrusted file text",
    apiKey: "fixture-key",
    transport,
  });
  expect(result).toBe('{"files":[]}');
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe("https://fixture.invalid/v1/chat/completions");
  expect(requests[0]!.headers.get("authorization")).toBe("Bearer fixture-key");
  const body = await requests[0]!.json();
  expect(body.messages).toEqual([{ role: "user", content: "Untrusted file text" }]);
  expect(body.model).toBe("fixture");
  expect(body).not.toHaveProperty("tools");
  expect(body).not.toHaveProperty("tool_choice");
});

test("a returned tool call is rejected without a follow-up or an executor", async () => {
  let requests = 0;
  const transport: typeof fetch = async () => {
    requests++;
    return stream(
      [
        {
          tool_calls: [
            {
              index: 0,
              id: "hostile",
              type: "function",
              function: { name: "shell", arguments: '{"command":"write"}' },
            },
          ],
        },
      ],
      "tool_calls",
    );
  };
  await expect(
    generateToolFreeText({ profile, models: [], model: "fixture", prompt: "prose", transport }),
  ).rejects.toThrow("Tool calls are not accepted");
  expect(requests).toBe(1);
});

test("the bounded text limit measures cumulative output once, regardless of stream chunking", async () => {
  const text = "a".repeat(100000);
  const transport: typeof fetch = async () =>
    stream([{ content: text }, { content: text }, { content: "b" }]);
  await expect(
    generateToolFreeText({ profile, models: [], model: "fixture", prompt: "prose", transport }),
  ).resolves.toBe(text + text + "b");
});

test("oversized output is refused and aborts the request signal", async () => {
  let signal: AbortSignal | null | undefined;
  const transport: typeof fetch = async (_url, init) => {
    signal = init?.signal;
    return stream([{ content: "a".repeat(262145) }]);
  };
  await expect(
    generateToolFreeText({ profile, models: [], model: "fixture", prompt: "prose", transport }),
  ).rejects.toThrow("bounded text limit");
  expect(signal?.aborted).toBe(true);
});

test("a profile-qualified selection is sent only to its owning endpoint", async () => {
  const urls: string[] = [];
  const credentials: string[] = [];
  const model = qualifyModel("secondary", "local/model");
  const configured = {
    ...settings,
    endpoints: [
      {
        id: "secondary",
        label: "Second",
        baseUrl: "https://second.invalid/v1",
        model: "local/model",
        apiKeyEnv: "SECOND_KEY",
      },
    ],
  };
  const transport: typeof fetch = async (url, init) => {
    urls.push(String(url));
    if (init?.method === "POST") {
      expect(JSON.parse(String(init.body)).model).toBe("local/model");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer owner-secondary");
      return stream([{ content: "proposal" }]);
    }
    return Response.json({ data: [{ id: "local/model" }] });
  };
  const provider = createOpenAiProvider(async () => configured, {
    id: "named-alias",
    transport,
    resolveApiKey: async (binding) => {
      credentials.push(binding.id);
      return `owner-${binding.id}`;
    },
  });
  await expect(provider.generateContextText({ model, prompt: "prose" })).resolves.toBe("proposal");
  expect(urls.filter((url) => url.endsWith("chat/completions"))).toEqual([
    "https://second.invalid/v1/chat/completions",
  ]);
  expect(credentials).toContain("secondary");
});

test.each(["missing", "disabled"])(
  "a %s profile never falls through to the primary endpoint",
  async (state) => {
    let inference = 0;
    const transport: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") inference++;
      return Response.json({ data: [{ id: "fixture" }] });
    };
    const configured = {
      ...settings,
      endpoints:
        state === "missing"
          ? []
          : [
              {
                id: "disabled",
                label: "Disabled",
                baseUrl: "https://second.invalid/v1",
                model: "fixture",
                apiKeyEnv: "SECOND_KEY",
                enabled: false,
              },
            ],
    };
    const provider = createOpenAiProvider(async () => configured, { transport });
    await expect(
      provider.generateContextText({ model: qualifyModel(state, "fixture"), prompt: "prose" }),
    ).rejects.toThrow("endpoint is unavailable");
    expect(inference).toBe(0);
  },
);

test("Brain requires the owning host to advertise the requested model before inference", async () => {
  let inference = 0;
  const transport: typeof fetch = async (_url, init) => {
    if (init?.method === "POST") inference++;
    return Response.json({ data: [{ id: "advertised" }] });
  };
  const provider = createOpenAiProvider(async () => settings, {
    id: "brain",
    requireModelMetadata: true,
    transport,
  });
  await expect(
    provider.generateContextText({ model: "not-advertised", prompt: "prose" }),
  ).rejects.toThrow("unavailable");
  expect(inference).toBe(0);
});
