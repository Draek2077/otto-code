import { useCallback } from "react";
import { useHostFeature } from "@/runtime/host-features";
import { useFormPreferences } from "@/hooks/use-form-preferences";

// A live Otto chat owns its model choices. Only create surfaces can change defaults for future chats.
export function useLiveChatPreferences(serverId: string) {
  const ownsSelection = useHostFeature(serverId, "ottoAgentTeams");
  const { updatePreferences } = useFormPreferences();
  return useCallback(
    async (changes: Parameters<typeof updatePreferences>[0]) => {
      if (!ownsSelection) await updatePreferences(changes);
    },
    [ownsSelection, updatePreferences],
  );
}
