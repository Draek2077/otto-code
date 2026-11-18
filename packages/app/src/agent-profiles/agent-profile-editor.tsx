import { useCallback, useMemo, useState, type ReactElement } from "react";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { AgentProfileEditModal } from "./settings/agent-profile-edit-modal";
import { generateAgentProfileId } from "./internal/profile-id";
import type { AgentProfileSeed, AgentProfileValue } from "./internal/profile-form-model";
import { useAgentProfiles } from "./internal/use-agent-profiles";
import { mergeEditedProfile } from "@/otto/agent-profiles/edits"; // OTTO(profile-continuity): preserve stored Otto extensions when editing basic Paseo fields.

export interface AgentProfileEditorControls {
  /** Open the create form pre-filled with provider, model, and suggested name. */
  openCreateFromModel: (seed: AgentProfileSeed) => void;
  /** Open the edit form for one profile. */
  openEdit: (profileId: string) => void;
  /** Render once where a sheet can portal; it self-hides until opened. */
  element: ReactElement | null;
}

type EditorRequest =
  | { mode: "create"; seed?: AgentProfileSeed }
  | { mode: "edit"; profile: AgentProfile };

/**
 * The model chooser's create/edit surface. Owns the write path so call sites
 * never see `saveProfiles` or construct profile records themselves.
 */
export function useAgentProfileEditor(serverId: string | null): AgentProfileEditorControls {
  const { profiles, saveProfiles } = useAgentProfiles(serverId);
  const [request, setRequest] = useState<EditorRequest | null>(null);

  const openCreateFromModel = useCallback((seed: AgentProfileSeed) => {
    setRequest({ mode: "create", seed });
  }, []);

  const openEdit = useCallback(
    (profileId: string) => {
      const profile = profiles?.find((entry) => entry.id === profileId);
      if (!profile) {
        return;
      }
      setRequest({ mode: "edit", profile });
    },
    [profiles],
  );

  const close = useCallback(() => setRequest(null), []);

  const handleSave = useCallback(
    async (value: AgentProfileValue) => {
      const current = profiles ?? [];
      const editing = request?.mode === "edit" ? request.profile : undefined;
      if (
        editing &&
        JSON.stringify(current.find((item) => item.id === editing.id)) !== JSON.stringify(editing)
      )
        throw new Error("This Profile changed. Reopen it to edit the new version."); // OTTO(agent-teams)
      const next: AgentProfile[] = editing
        ? current.map((entry) =>
            entry.id === editing.id ? mergeEditedProfile(entry, value) : entry,
          )
        : [...current, { id: generateAgentProfileId(), ...value }];
      await saveProfiles(next);
      setRequest(null);
    },
    [profiles, request, saveProfiles],
  );

  const element = useMemo(
    () => (
      <AgentProfileEditModal
        serverId={serverId ?? ""}
        visible={request !== null}
        mode={request?.mode ?? "create"}
        {...(request?.mode === "edit" && request.profile ? { profile: request.profile } : {})}
        {...(request?.mode === "create" && request.seed ? { seed: request.seed } : {})}
        onClose={close}
        onSave={handleSave}
      />
    ),
    [close, handleSave, request, serverId],
  );

  return useMemo(
    () => ({ openCreateFromModel, openEdit, element }),
    [openCreateFromModel, openEdit, element],
  );
}
