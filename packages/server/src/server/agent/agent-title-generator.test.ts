import { describe, expect, test, vi } from "vitest";

import type { AgentManager } from "./agent-manager.js";
import type { StructuredAgentGenerationWithFallbackOptions } from "./agent-response-loop.js";
import { generateAgentTitleFromFirstAgentContext } from "./agent-title-generator.js";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createStructuredGenerator(result: { title: string }) {
  const calls: StructuredAgentGenerationWithFallbackOptions<unknown>[] = [];

  async function generateStructured<T>(
    options: StructuredAgentGenerationWithFallbackOptions<T>,
  ): Promise<T> {
    calls.push(options as StructuredAgentGenerationWithFallbackOptions<unknown>);
    return result as T;
  }

  return { generateStructured, calls };
}

describe("generateAgentTitleFromFirstAgentContext", () => {
  test("returns the generated short title and runs an internal generation", async () => {
    const structured = createStructuredGenerator({ title: "Login flow" });

    const result = await generateAgentTitleFromFirstAgentContext({
      agentManager: {} as AgentManager,
      cwd: "/tmp/repo",
      firstAgentContext: { prompt: "Fix the login flow so redirects work" },
      logger: createLogger(),
      deps: { generateStructuredAgentResponseWithFallback: structured.generateStructured },
    });

    expect(result).toBe("Login flow");
    expect(structured.calls).toHaveLength(1);
    const firstCall = structured.calls[0];
    if (!firstCall) {
      throw new Error("expected structured generation call");
    }
    expect(firstCall).toMatchObject({
      cwd: "/tmp/repo",
      schemaName: "AgentTitle",
      maxRetries: 2,
      agentConfigOverrides: {
        title: "Chat title generator",
        internal: true,
      },
    });
    // The prompt carries the first message and the 1–3 word instruction.
    expect(firstCall.prompt).toContain(
      "<user-prompt>\nFix the login flow so redirects work\n</user-prompt>",
    );
    expect(firstCall.prompt).toContain("1–3 words MAXIMUM");
    expect(firstCall.prompt).toContain("Return JSON only with a single field 'title'.");
  });

  test("returns null when there is no prompt to name from", async () => {
    const structured = createStructuredGenerator({ title: "unused" });

    const result = await generateAgentTitleFromFirstAgentContext({
      agentManager: {} as AgentManager,
      cwd: "/tmp/repo",
      firstAgentContext: undefined,
      logger: createLogger(),
      deps: { generateStructuredAgentResponseWithFallback: structured.generateStructured },
    });

    expect(result).toBeNull();
    expect(structured.calls).toHaveLength(0);
  });

  test("returns null (never throws) when generation fails", async () => {
    async function failingGenerate<T>(): Promise<T> {
      throw new Error("no provider available");
    }

    const result = await generateAgentTitleFromFirstAgentContext({
      agentManager: {} as AgentManager,
      cwd: "/tmp/repo",
      firstAgentContext: { prompt: "Do a thing" },
      logger: createLogger(),
      deps: { generateStructuredAgentResponseWithFallback: failingGenerate },
    });

    expect(result).toBeNull();
  });
});
