import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import { resolveProfile } from "../agent-profiles.js";
import { getActiveAgentTeam, isTeamMember } from "@otto-code/protocol/agent-teams";
import {
  isProfileRole,
  normalizeProfileRoles,
  profileHasRole,
  summarizeProfileForSelection,
} from "@otto-code/protocol/agent-profiles";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<
  OttoToolContext,
  | "agentManager"
  | "providerSnapshotManager"
  | "readAgentProfiles"
  | "readAgentTeams"
  | "callerAgentId"
  | "getPersonalityRoster"
> & { registerTool: RegisterOttoTool };

export function registerProfilesTools({
  agentManager,
  providerSnapshotManager,
  readAgentProfiles,
  readAgentTeams,
  callerAgentId,
  getPersonalityRoster,
  registerTool,
}: Dependencies): void {
  if (readAgentProfiles) {
    registerTool(
      "list_agent_profiles",
      {
        title: "List agent profiles",
        description:
          "List the agent profiles on this host - named templates binding a provider/model, effort, mode, prompt, and roles. Pass a name to create_chat's `agentProfile` to start one (availability is resolved per workspace; an unavailable profile cannot be started there). Any chat may call this to choose a collaborator. Each entry's `guidance`, `tier`, and `canLaunch` fields explain when to choose it, and `notes` carries the author's own note about what this particular one is for.",
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              "Workspace directory to resolve availability against. Defaults to your current cwd.",
            ),
          roles: z
            .array(z.string())
            .optional()
            .describe(
              "Only return agent profiles carrying at least one of these roles (for example writer, coder, judger, advisor).",
            ),
        },
        outputSchema: {
          agentProfiles: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              roles: z.array(z.string()),
              provider: z.string(),
              model: z.string(),
              available: z.boolean(),
              tier: z
                .string()
                .describe("coordinator (delegates/orchestrates) or focused (stays on one task)."),
              canLaunch: z
                .boolean()
                .describe(
                  "Whether this agent profile is meant to spawn other agents and orchestrate.",
                ),
              guidance: z
                .string()
                .describe("Why you'd choose this agent profile - its roles' intent."),
              unavailableReason: z.string().optional(),
              modeId: z.string().optional(),
              thinkingOptionId: z.string().optional(),
              effortLevel: z.string().optional(),
            }),
          ),
          activeTeam: z
            .object({ id: z.string(), name: z.string(), note: z.string() })
            .optional()
            .describe(
              "Present when an Agent Team is active - the list above is scoped to its members.",
            ),
        },
      },
      async (args: { cwd?: string; roles?: string[] }) => {
        const roleFilters = (args.roles ?? []).map((role) => role.trim()).filter(Boolean);
        const caller = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
        const cwd = args.cwd?.trim() || caller?.cwd || undefined;
        const entries = await providerSnapshotManager.listProviders({ cwd, wait: true });
        // With a team active, the bench is the team: only members are listed
        // (create_chat by explicit name still resolves the full roster - an
        // off-team specialist can be pulled in deliberately, without the team
        // prompt). No active team = the full roster, exactly as before.
        const activeTeam = getActiveAgentTeam(readAgentTeams?.());
        const personalities = getPersonalityRoster()
          .filter((personality) => !activeTeam || isTeamMember(activeTeam, personality.id))
          .filter(
            (personality) =>
              roleFilters.length === 0 ||
              roleFilters.some((role) => isProfileRole(role) && profileHasRole(personality, role)),
          )
          .map((personality) => {
            const resolution = resolveProfile(personality, entries);
            const selection = summarizeProfileForSelection(personality);
            const entryOut: {
              id: string;
              name: string;
              roles: string[];
              provider: string;
              model: string;
              available: boolean;
              tier: string;
              canLaunch: boolean;
              guidance: string;
              unavailableReason?: string;
              modeId?: string;
              thinkingOptionId?: string;
              effortLevel?: string;
              notes?: string;
            } = {
              id: personality.id,
              name: personality.name,
              roles: normalizeProfileRoles(personality.roles),
              provider: personality.provider,
              // A personality may name no model, meaning "this provider's
              // default". Report the model the resolver actually bound so a
              // deciding agent sees what it would really get, and fall back to
              // the stored value only when resolution failed.
              model:
                resolution.status === "available"
                  ? resolution.snapshot.model
                  : (personality.model ?? ""),
              available: resolution.status === "available",
              tier: selection.tier,
              canLaunch: selection.canLaunch,
              guidance: selection.guidance,
            };
            // The author's own "when to pick this one" note. `guidance` is
            // derived from roles and says what the ROLE is for; this says what
            // this particular teammate is for, which the roles cannot express.
            const notes = typeof personality.notes === "string" ? personality.notes.trim() : "";
            if (notes) {
              entryOut.notes = notes;
            }
            if (resolution.status === "unavailable") {
              entryOut.unavailableReason = resolution.reason;
              return entryOut;
            }
            const snapshot = resolution.snapshot;
            if (snapshot.modeId !== undefined) {
              entryOut.modeId = snapshot.modeId;
            }
            if (snapshot.thinkingOptionId !== undefined) {
              entryOut.thinkingOptionId = snapshot.thinkingOptionId;
            }
            if (snapshot.effortLevel !== undefined) {
              entryOut.effortLevel = snapshot.effortLevel;
            }
            return entryOut;
          });
        return {
          content: [],
          structuredContent: ensureValidJson({
            agentProfiles: personalities,
            ...(activeTeam
              ? {
                  activeTeam: {
                    id: activeTeam.id,
                    name: activeTeam.name,
                    note: `Team "${activeTeam.name}" is active; this list is its bench. create_chat with an off-team agent profile name still works but starts without the team prompt.`,
                  },
                }
              : {}),
          }),
        };
      },
    );
  }
}
