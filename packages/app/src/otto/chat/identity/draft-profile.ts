import { useCallback, useState } from "react";
import type { ChatProfileBinding } from "./profile-binding";

/** Draft-only selection; changing hosts/providers cannot carry another host's Profile identity. */
export function useDraftChatProfile(
  serverId: string | null,
  provider: string | null,
  initial?: { provider: string; binding: ChatProfileBinding } | null,
) {
  const [selection, setSelection] = useState<{
    serverId: string | null;
    provider: string;
    binding: ChatProfileBinding;
  } | null>(() => (initial ? { serverId, ...initial } : null));
  const select = useCallback(
    (nextProvider: string, binding: ChatProfileBinding | undefined) => {
      setSelection(binding ? { serverId, provider: nextProvider, binding } : null);
    },
    [serverId],
  );
  const clear = useCallback(() => setSelection(null), []);
  const binding =
    selection?.serverId === serverId && selection.provider === provider
      ? selection.binding
      : undefined;
  return { binding, select, clear };
}
