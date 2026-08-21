import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Tier-2 (local-AI) harness support. Lifted out of the app's global setup when
 * upstream split daemon startup into a per-worker fixture: the network probe
 * still belongs to the run (once, fail fast), while the provider block has to be
 * written into each worker's isolated OTTO_HOME.
 */
export interface LocalAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function readLocalAiEnv(): LocalAiConfig | null {
  if (process.env.E2E_LOCAL_AI !== "1") {
    return null;
  }
  const baseUrl = process.env.E2E_LOCAL_AI_BASE_URL?.trim();
  const apiKey = process.env.E2E_LOCAL_AI_API_KEY?.trim();
  const model = process.env.E2E_LOCAL_AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      "E2E_LOCAL_AI=1 requires E2E_LOCAL_AI_BASE_URL, E2E_LOCAL_AI_API_KEY, and " +
        "E2E_LOCAL_AI_MODEL (set them in the repo-root .env.test).",
    );
  }
  return { baseUrl, apiKey, model };
}

/**
 * Fails fast when LM Studio is unreachable or the pinned model is not loaded,
 * instead of burning a full spec timeout per test. LM Studio JIT-loads models
 * on first completion, so presence in /models is sufficient readiness.
 */
export async function preflightLocalAi(config: LocalAiConfig): Promise<void> {
  const modelsUrl = `${config.baseUrl.replace(/\/+$/, "")}/models`;
  let body: { data?: Array<{ id?: string }> };
  let response: Response;
  try {
    response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `Local-AI preflight failed: ${modelsUrl} unreachable (${
        error instanceof Error ? error.message : String(error)
      }). Is LM Studio running?`,
      { cause: error },
    );
  }
  // A reachable server that answers with an error status is a different failure
  // (wrong E2E_LOCAL_AI_API_KEY, wrong path) - don't blame it on LM Studio being down.
  if (!response.ok) {
    throw new Error(
      `Local-AI preflight failed: ${modelsUrl} answered ${response.status} ${response.statusText}. ` +
        `Check E2E_LOCAL_AI_BASE_URL and E2E_LOCAL_AI_API_KEY in the repo-root .env.test.`,
    );
  }
  try {
    body = (await response.json()) as { data?: Array<{ id?: string }> };
  } catch (error) {
    throw new Error(
      `Local-AI preflight failed: ${modelsUrl} returned a non-JSON body (${
        error instanceof Error ? error.message : String(error)
      }).`,
      { cause: error },
    );
  }
  const modelIds = (body.data ?? []).map((entry) => entry.id).filter(Boolean);
  if (!modelIds.includes(config.model)) {
    throw new Error(
      `Local-AI preflight failed: model "${config.model}" not in ${modelsUrl}. ` +
        `Available: ${modelIds.join(", ") || "(none)"}`,
    );
  }
  console.log(`[e2e] Local-AI preflight OK: ${config.model} available at ${config.baseUrl}`);
}

/**
 * Writes the openai-compatible provider block pointed at LM Studio into the
 * E2E daemon's isolated OTTO_HOME config so *.local.spec.ts specs can create
 * live agents through the daemon's native tool loop. Merges over any forked
 * config.json rather than replacing it.
 */
export async function injectLocalAiProvider(
  targetHome: string,
  config: LocalAiConfig,
): Promise<void> {
  const configPath = path.join(targetHome, "config.json");
  let existing: Record<string, unknown> = { version: 1 };
  if (existsSync(configPath)) {
    existing = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  }
  const agents = (existing.agents ??= {}) as Record<string, unknown>;
  const providers = (agents.providers ??= {}) as Record<string, unknown>;
  providers["openai-compatible"] = {
    extends: "openai-compatible",
    label: "OpenAI Compatible",
    env: {
      OPENAI_BASE_URL: config.baseUrl,
      OPENAI_API_KEY: config.apiKey,
    },
    compaction: {},
    maxToolRounds: 25,
  };
  await writeFile(configPath, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`[e2e] Injected local-AI openai-compatible provider into ${configPath}`);
}
