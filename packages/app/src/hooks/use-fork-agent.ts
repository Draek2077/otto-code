import { useMemo } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type {
  AgentForkContextOptions,
  DaemonClient,
} from "@otto-code/client/internal/daemon-client";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import type { AssistantForkTarget } from "@/components/assistant-fork-menu";
import type { ToastApi } from "@/components/toast-host";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getHostProjectId, type HostProjectListItem } from "@/projects/host-project-model";
import { useHostProjects } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import { generateDraftId } from "@/stores/draft-keys";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { toErrorMessage } from "@/utils/error-messages";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import type { WorkspaceDraftTabSetup, WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * The subset of an agent record that a fork needs in order to seed the new
 * draft. Kept structural so both `AgentScreenAgent` (the agent-stream view's
 * live context) and the session store's `Agent` record satisfy it without a
 * projection step.
 */
export type ForkAgentSource = Pick<
  AgentScreenAgent,
  | "provider"
  | "cwd"
  | "currentModeId"
  | "model"
  | "thinkingOptionId"
  | "runtimeInfo"
  | "features"
  | "projectPlacement"
>;

/**
 * Boundary marking where the forked context should stop. Omit it entirely to
 * fork the whole timeline *up to now* — including a partially streamed
 * in-flight turn. `selectForkContextRows` projects the full timeline when
 * neither field is present, which is what makes mid-run forking work.
 */
export type ForkAgentBoundary = Pick<
  AgentForkContextOptions,
  "boundaryCursor" | "boundaryMessageId"
>;

export interface ForkAgentRequest {
  agentId: string;
  agent: ForkAgentSource;
  workspaceId?: string;
  target: AssistantForkTarget;
  boundary?: ForkAgentBoundary;
}

export interface UseForkAgentInput {
  serverId: string;
  toast?: ToastApi | null;
  /** Read-only surfaces (provider subagent panes) must never fork. */
  readOnly?: boolean;
}

function buildChatHistoryAttachment(input: {
  draftId: string;
  serverId: string;
  agentId: string;
  payload: Awaited<ReturnType<DaemonClient["buildAgentForkContext"]>>;
  missingAttachmentMessage: string;
}): WorkspaceComposerAttachment {
  if (!input.payload.attachment) {
    throw new Error(input.missingAttachmentMessage);
  }
  return {
    kind: "chat_history",
    id: `chat_history:${input.draftId}`,
    attachment: input.payload.attachment,
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      boundaryMessageId: input.payload.boundaryMessageId,
      boundaryCursor: input.payload.boundaryCursor,
      itemCount: input.payload.itemCount,
    },
  };
}

function buildForkDraftSetup(agent: ForkAgentSource): WorkspaceDraftTabSetup | undefined {
  if (!agent.provider) {
    return undefined;
  }

  const featureValues: Record<string, unknown> = {};
  for (const feature of agent.features ?? []) {
    featureValues[feature.id] = feature.value;
  }

  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    featureValues,
  };
}

/**
 * The placement only carries the cross-host projectKey, which is not a per-host
 * projectId (see projects/project-id-is-not-project-key.test.ts): sending it as
 * one fails workspace creation for any project with a real minted id. Resolve
 * the host's own id from the project list, and when the project is unknown here
 * return undefined so the daemon resolves it from sourceDirectory.
 */
function resolveForkRouteProjectId(input: {
  projectKey: string | null | undefined;
  hostProjects: readonly HostProjectListItem[];
  serverId: string;
}): string | undefined {
  const projectKey = input.projectKey?.trim();
  if (!projectKey) {
    return undefined;
  }
  const hostProject = input.hostProjects.find((project) => project.projectKey === projectKey);
  if (!hostProject) {
    return undefined;
  }
  return getHostProjectId(hostProject, input.serverId) ?? undefined;
}

function buildForkDraftTabTarget(
  setup: WorkspaceDraftTabSetup | undefined,
  draftId: string,
): WorkspaceTabTarget {
  return setup ? { kind: "draft", draftId, setup } : { kind: "draft", draftId };
}

/**
 * Shared fork driver behind both turn-footer fork affordances: the completed
 * turn's footer (which supplies a boundary pinned to that turn) and the
 * in-flight turn's footer next to the progress loader (which omits the boundary
 * so the fork captures the still-streaming response).
 */
export function useForkAgent(
  input: UseForkAgentInput,
): (request: ForkAgentRequest) => Promise<void> {
  const { serverId, toast, readOnly = false } = input;
  const { t } = useTranslation();
  const router = useRouter();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supportsAgentForkContext = useHostFeature(serverId, "agentForkContext") && !readOnly;
  const hostServerIds = useMemo(() => [serverId], [serverId]);
  const hostProjects = useHostProjects(hostServerIds);

  return useStableEvent(async ({ agentId, agent, workspaceId, target, boundary }) => {
    try {
      if (!supportsAgentForkContext) {
        toast?.error(t("message.actions.forkUnavailable"));
        return;
      }
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const draftSetup = buildForkDraftSetup(agent);
      const prepareForkDraft = async () => {
        const draftId = generateDraftId();
        const payload = await client.buildAgentForkContext(agentId, boundary);
        const attachment = buildChatHistoryAttachment({
          draftId,
          serverId,
          agentId,
          payload,
          missingAttachmentMessage: t("message.actions.forkFailed"),
        });
        useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
          scopeKey: buildDraftWorkspaceAttachmentScopeKey(draftId),
          attachments: [attachment],
        });
        return draftId;
      };

      if (target === "tab") {
        if (!workspaceId) {
          throw new Error(t("message.actions.forkMissingWorkspace"));
        }
        const draftId = await prepareForkDraft();
        navigateToWorkspace({
          serverId,
          workspaceId,
          target: buildForkDraftTabTarget(draftSetup, draftId),
        });
        return;
      }

      const draftId = await prepareForkDraft();
      const sourceDirectory =
        agent.projectPlacement?.checkout?.cwd?.trim() || agent.cwd.trim() || undefined;
      if (draftSetup) {
        useWorkspaceDraftSubmissionStore.getState().setDraftSetup({
          draftId,
          setup: draftSetup,
          sourceDirectory,
        });
      }
      router.push(
        buildNewWorkspaceRoute({
          serverId,
          sourceDirectory,
          displayName: agent.projectPlacement?.projectName,
          projectId: resolveForkRouteProjectId({
            projectKey: agent.projectPlacement?.projectKey,
            hostProjects,
            serverId,
          }),
          draftId,
        }),
      );
    } catch (error) {
      toast?.error(toErrorMessage(error) || t("message.actions.forkFailed"));
    }
  });
}
