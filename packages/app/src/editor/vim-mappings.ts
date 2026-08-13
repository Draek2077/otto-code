/**
 * The intentionally small, Otto-owned Vim mapping contract.
 *
 * These are leader mappings only. They are not a .vimrc surface and must not
 * grow into one: keeping the grammar here small makes persistence safe and
 * lets the editor own the mapping locally without claiming global shortcuts.
 */
export const VIM_LEADER = "Space" as const;
export const VIM_MAPPING_MAX_LENGTH = 2;

export const VIM_ACTIONS = [
  "save",
  "find",
  "goToDefinition",
  "findReferences",
  "renameSymbol",
  "openFileSearch",
  "openChanges",
  "newTerminal",
] as const;

export type VimMappingAction = (typeof VIM_ACTIONS)[number];

export interface VimMappingSettings {
  leader: typeof VIM_LEADER;
  mappings: Partial<Record<VimMappingAction, string>>;
}

export const DEFAULT_VIM_MAPPING_SETTINGS: VimMappingSettings = {
  leader: VIM_LEADER,
  mappings: {
    save: "s",
    find: "f",
    goToDefinition: "d",
    findReferences: "r",
    renameSymbol: "n",
    openFileSearch: "p",
    openChanges: "c",
    newTerminal: "t",
  },
};

const VIM_ACTION_SET = new Set<string>(VIM_ACTIONS);

export function isVimMappingKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= VIM_MAPPING_MAX_LENGTH &&
    /^[A-Za-z0-9]+$/.test(value)
  );
}

export function normalizeVimMappingSettings(input: unknown): VimMappingSettings {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return DEFAULT_VIM_MAPPING_SETTINGS;
  }

  const raw = input as { leader?: unknown; mappings?: unknown };
  if (raw.leader !== undefined && raw.leader !== VIM_LEADER) {
    return DEFAULT_VIM_MAPPING_SETTINGS;
  }
  if (raw.mappings === null || typeof raw.mappings !== "object" || Array.isArray(raw.mappings)) {
    return DEFAULT_VIM_MAPPING_SETTINGS;
  }

  const mappings: Partial<Record<VimMappingAction, string>> = {
    ...DEFAULT_VIM_MAPPING_SETTINGS.mappings,
  };
  const claimed = new Set<string>();

  // An explicit custom mapping owns its sequence. Remove a shipped default
  // from any other action before applying the override, so rebinding Space+F
  // to a different action never leaves two actions behind the same key.
  for (const action of VIM_ACTIONS) {
    const value = (raw.mappings as Record<string, unknown>)[action];
    if (!isVimMappingKey(value)) {
      continue;
    }
    for (const otherAction of VIM_ACTIONS) {
      if (otherAction !== action && mappings[otherAction] === value) {
        delete mappings[otherAction];
      }
    }
  }

  for (const action of VIM_ACTIONS) {
    const value = (raw.mappings as Record<string, unknown>)[action];
    if (!isVimMappingKey(value) || claimed.has(value)) {
      continue;
    }
    claimed.add(value);
    mappings[action] = value;
  }
  return { leader: VIM_LEADER, mappings };
}

export function isVimMappingAction(value: string): value is VimMappingAction {
  return VIM_ACTION_SET.has(value);
}

export function getVimMappingAction(
  settings: VimMappingSettings,
  sequence: string,
): VimMappingAction | null {
  for (const action of VIM_ACTIONS) {
    if (settings.mappings[action] === sequence) {
      return action;
    }
  }
  return null;
}

export function isVimMappingPrefix(settings: VimMappingSettings, sequence: string): boolean {
  return Object.values(settings.mappings).some((mapping) => mapping?.startsWith(sequence));
}
