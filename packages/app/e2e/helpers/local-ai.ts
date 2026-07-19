import { seedWorkspace, type SeededWorkspace } from "./seed-client";
import { getServerId } from "./server-id";
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";

/**
 * Tier-2 (local-AI) spec support. These specs run under the `local-ai`
 * Playwright project only (`npm run test:e2e:local-ai`), where global setup has
 * already preflighted LM Studio and injected the openai-compatible provider
 * into the isolated OTTO_HOME. Specs must assert on side effects (files, diff
 * rows, tool-call rows, agent status) — never on model prose.
 */

export const LOCAL_AI_PROVIDER = "openai-compatible";

export function getLocalAiModel(): string {
  const model = process.env.E2E_LOCAL_AI_MODEL?.trim();
  if (!model) {
    throw new Error(
      "E2E_LOCAL_AI_MODEL is not set. Local-AI specs must run via " +
        "`npm run test:e2e:local-ai` with the repo-root .env.test populated.",
    );
  }
  return model;
}

export interface LocalAiAgentWorkspace {
  agentId: string;
  workspace: SeededWorkspace;
  cleanup(): Promise<void>;
}

/**
 * Seeds a temp git repo + workspace and creates a live openai-compatible agent
 * in it. Passing `initialPrompt` starts the first turn immediately; callers
 * then wait for completion with `workspace.client.waitForFinish(agentId)`.
 */
export async function seedLocalAiAgent(options: {
  repoPrefix: string;
  title: string;
  initialPrompt?: string;
  modeId?: string;
  featureValues?: Record<string, unknown>;
}): Promise<LocalAiAgentWorkspace> {
  const workspace = await seedWorkspace({ repoPrefix: options.repoPrefix });
  try {
    const agent = await workspace.client.createAgent({
      provider: LOCAL_AI_PROVIDER,
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: options.title,
      model: getLocalAiModel(),
      modeId: options.modeId,
      initialPrompt: options.initialPrompt,
      featureValues: options.featureValues,
    });
    return {
      agentId: agent.id,
      workspace,
      cleanup: workspace.cleanup,
    };
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
}

export function buildLocalAiAgentRoute(workspaceId: string, agentId: string): string {
  return buildHostAgentDetailRoute(getServerId(), agentId, workspaceId);
}

/**
 * Local inference on a 27B model is slow; a single short tool-using turn can
 * legitimately take a couple of minutes. Use this for waitForFinish timeouts.
 */
export const LOCAL_AI_TURN_TIMEOUT_MS = 180_000;
