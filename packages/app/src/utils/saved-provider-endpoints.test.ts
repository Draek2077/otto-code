import { describe, expect, it } from "vitest";
import type { SavedProviderEndpoint } from "@otto-code/protocol/messages";
import {
  SAVED_PROVIDER_ENDPOINT_LIMIT,
  findSavedProviderEndpoint,
  forgetProviderEndpoint,
  rememberProviderEndpoint,
  savedProviderEndpointId,
  selectSavedProviderEndpoints,
} from "./saved-provider-endpoints";

function remember(
  endpoints: readonly SavedProviderEndpoint[],
  baseUrl: string,
  apiKey: string,
  savedAt: number,
  baseUrlKey = "OPENAI_BASE_URL",
): SavedProviderEndpoint[] {
  return rememberProviderEndpoint({
    endpoints,
    baseUrlKey,
    apiKeyKey: baseUrlKey === "OPENAI_BASE_URL" ? "OPENAI_API_KEY" : "ANTHROPIC_AUTH_TOKEN",
    baseUrl,
    apiKey,
    savedAt,
  });
}

describe("rememberProviderEndpoint", () => {
  it("keeps the credential the endpoint was saved with", () => {
    const endpoints = remember([], "http://localhost:1234/v1", "lm-key", 1);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      baseUrl: "http://localhost:1234/v1",
      apiKey: "lm-key",
      apiKeyKey: "OPENAI_API_KEY",
    });
  });

  it("replaces the entry for a URL instead of duplicating it when the key rotates", () => {
    const first = remember([], "https://api.example/v1", "old-key", 1);
    const second = remember(first, "https://api.example/v1", "new-key", 2);

    expect(second).toHaveLength(1);
    expect(second[0].apiKey).toBe("new-key");
  });

  it("preserves a user-given label across a re-save", () => {
    const labeled: SavedProviderEndpoint[] = [
      {
        id: savedProviderEndpointId("OPENAI_BASE_URL", "https://api.example/v1"),
        baseUrlKey: "OPENAI_BASE_URL",
        apiKeyKey: "OPENAI_API_KEY",
        baseUrl: "https://api.example/v1",
        apiKey: "old-key",
        label: "Work account",
        savedAt: 1,
      },
    ];

    const [entry] = remember(labeled, "https://api.example/v1", "new-key", 2);

    expect(entry.label).toBe("Work account");
    expect(entry.apiKey).toBe("new-key");
  });

  it("orders a family newest-save-first", () => {
    let endpoints = remember([], "http://localhost:1234/v1", "a", 1);
    endpoints = remember(endpoints, "http://localhost:11434/v1", "b", 2);

    expect(
      selectSavedProviderEndpoints(endpoints, "OPENAI_BASE_URL").map((e) => e.baseUrl),
    ).toEqual(["http://localhost:11434/v1", "http://localhost:1234/v1"]);
  });

  it("evicts the least recently saved once the family is full", () => {
    let endpoints: SavedProviderEndpoint[] = [];
    for (let i = 0; i < SAVED_PROVIDER_ENDPOINT_LIMIT; i += 1) {
      endpoints = remember(endpoints, `https://api.example/${i}/v1`, "k", i + 1);
    }
    endpoints = remember(endpoints, "https://api.example/overflow/v1", "k", 1000);

    expect(endpoints).toHaveLength(SAVED_PROVIDER_ENDPOINT_LIMIT);
    expect(endpoints.map((e) => e.baseUrl)).toContain("https://api.example/overflow/v1");
    expect(endpoints.map((e) => e.baseUrl)).not.toContain("https://api.example/0/v1");
  });

  it("does not disturb another env-var family", () => {
    const anthropic = remember([], "https://api.z.ai/api/anthropic", "z", 1, "ANTHROPIC_BASE_URL");
    const both = remember(anthropic, "http://localhost:1234/v1", "lm", 2);

    expect(selectSavedProviderEndpoints(both, "ANTHROPIC_BASE_URL")).toHaveLength(1);
    expect(selectSavedProviderEndpoints(both, "OPENAI_BASE_URL")).toHaveLength(1);
  });
});

describe("findSavedProviderEndpoint", () => {
  it("matches only within the same family", () => {
    const endpoints = remember([], "https://shared.example/v1", "k", 1);

    expect(
      findSavedProviderEndpoint(endpoints, "OPENAI_BASE_URL", "https://shared.example/v1"),
    ).not.toBeNull();
    expect(
      findSavedProviderEndpoint(endpoints, "ANTHROPIC_BASE_URL", "https://shared.example/v1"),
    ).toBeNull();
  });
});

describe("forgetProviderEndpoint", () => {
  it("removes the named entry and leaves the rest", () => {
    let endpoints = remember([], "http://localhost:1234/v1", "a", 1);
    endpoints = remember(endpoints, "http://localhost:11434/v1", "b", 2);

    const remaining = forgetProviderEndpoint(
      endpoints,
      savedProviderEndpointId("OPENAI_BASE_URL", "http://localhost:1234/v1"),
    );

    expect(remaining.map((e) => e.baseUrl)).toEqual(["http://localhost:11434/v1"]);
  });
});
