import { useSessionStore } from "@/stores/session-store";

/**
 * What the host can answer a go-to-definition with. Two independent capabilities
 * back one action, so the question "is the action available at all" is answered
 * here rather than re-derived at each call site.
 *
 * `lsp` resolves a position through a language server; `codeIndex` is the
 * name-based ctags index, which still serves the outline and the fuzzy finder and
 * remains the answer for languages no server covers.
 * COMPAT(lsp): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
 */
export interface DefinitionSources {
  hasCodeIndex: boolean;
  hasLsp: boolean;
  /** Either source can serve the action. */
  canGoToDefinition: boolean;
}

export function useDefinitionSources(serverId: string): DefinitionSources {
  const features = useSessionStore((state) => state.sessions[serverId]?.serverInfo?.features);
  const hasCodeIndex = features?.codeIndex === true;
  const hasLsp = features?.lsp === true;
  return { hasCodeIndex, hasLsp, canGoToDefinition: hasCodeIndex || hasLsp };
}
