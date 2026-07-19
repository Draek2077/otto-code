import { LOCAL_AI_PROVIDER, getLocalAiModel } from "../../e2e/helpers/local-ai";

/**
 * Real-run demo scenarios must never silently HARDCODE a provider — that's
 * an explicit, costly choice, not something to bury in a scenario file.
 * Provider and model are chosen via env vars, both overridable per capture.
 *
 * Default is Claude on Sonnet 5 (user decision, 2026-07-18): cheap relative
 * to Opus, and the only provider with the full feature set demo captures
 * need (e.g. the local-AI/openai-compatible tool catalog has no
 * TodoWrite-equivalent, so scenario beats built around planning/todos can't
 * run on it — see 01-agent-live's history). Set DEMO_PROVIDER=local-ai
 * explicitly to capture against the local-AI tier (LM Studio, injected as
 * the "openai-compatible" provider by e2e/global-setup.ts's
 * readLocalAiEnv/injectLocalAiProvider when E2E_LOCAL_AI=1) instead.
 */
export interface ResolvedDemoProvider {
  provider: string;
  model: string;
}

export function resolveDemoProvider(): ResolvedDemoProvider {
  const requested = (process.env.DEMO_PROVIDER ?? "claude").trim();

  if (requested === "claude") {
    return { provider: "claude", model: process.env.DEMO_MODEL ?? "sonnet" };
  }

  if (requested === "local-ai") {
    if (process.env.E2E_LOCAL_AI !== "1") {
      throw new Error(
        "DEMO_PROVIDER=local-ai requires E2E_LOCAL_AI=1 plus " +
          "E2E_LOCAL_AI_BASE_URL/E2E_LOCAL_AI_API_KEY/E2E_LOCAL_AI_MODEL in the repo-root " +
          ".env.test — see demo/README.md.",
      );
    }
    return { provider: LOCAL_AI_PROVIDER, model: process.env.DEMO_MODEL ?? getLocalAiModel() };
  }

  throw new Error(`Unknown DEMO_PROVIDER "${requested}" — use "claude" (default) or "local-ai".`);
}
