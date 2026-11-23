import { z } from "zod";

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
export const VimActionSchema = z.enum(VIM_ACTIONS);
export type VimAction = z.infer<typeof VimActionSchema>;
export const VimMappingSettings = z.object({
  leader: z.literal("Space"),
  mappings: z.partialRecord(z.enum(VIM_ACTIONS), z.string()),
});
export type VimMappingSettings = z.infer<typeof VimMappingSettings>;
export const DEFAULT_VIM_MAPPINGS: VimMappingSettings = {
  leader: "Space",
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
const MappingInput = z.object({
  leader: z.literal("Space").optional(),
  mappings: z.record(z.string(), z.unknown()),
});
export function validVimMapping(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{1,2}$/u.test(value);
}
/** Same 0.9 key grammar and collision priority, without unsafe persisted casts. */
export function normalizeVimMappings(value: unknown): VimMappingSettings {
  const parsed = MappingInput.safeParse(value);
  if (!parsed.success) return DEFAULT_VIM_MAPPINGS;
  const mappings = { ...DEFAULT_VIM_MAPPINGS.mappings };
  const claimed = new Set<string>();
  for (const action of VIM_ACTIONS) {
    const key = parsed.data.mappings[action];
    if (!validVimMapping(key)) continue;
    for (const other of VIM_ACTIONS)
      if (other !== action && mappings[other] === key) delete mappings[other];
  }
  for (const action of VIM_ACTIONS) {
    const key = parsed.data.mappings[action];
    if (!validVimMapping(key) || claimed.has(key)) continue;
    claimed.add(key);
    mappings[action] = key;
  }
  return { leader: "Space", mappings };
}
export interface EditorPreferences {
  vimMappings: VimMappingSettings;
  fileEditorMode: "off" | "vim" | "neovim" | "custom";
  fileEditorCustomCommand: string;
  alwaysUseOttoEditorForMarkdown: boolean;
  rulerEnabled: boolean;
  rulerColumn: number;
}
export const editorPreferenceDefaults: EditorPreferences = {
  vimMappings: DEFAULT_VIM_MAPPINGS,
  fileEditorMode: "off",
  fileEditorCustomCommand: "",
  alwaysUseOttoEditorForMarkdown: false,
  rulerEnabled: true,
  rulerColumn: 120,
};
// These are device persistence adapters, not protocol schemas. The existing
// settings owner retains unknown keys while projecting supported 0.9 fields.
export const editorStoredPreferences = {
  // Older device settings omit this key. Without explicit optional input Zod
  // rejects the entire settings record before normalizing its default value.
  vimMappings: z.unknown().optional().transform(normalizeVimMappings),
  fileEditorMode: z.enum(["off", "vim", "neovim", "custom"]).catch("off"),
  fileEditorCustomCommand: z.string().catch(""),
  alwaysUseOttoEditorForMarkdown: z.boolean().catch(false),
  rulerEnabled: z.boolean().catch(true),
  rulerColumn: z
    .number()
    .finite()
    .transform((value) => Math.max(80, Math.min(240, Math.round(value))))
    .catch(120),
};
export type EditorRenderingPreferences = Pick<
  EditorPreferences,
  "vimMappings" | "rulerEnabled" | "rulerColumn"
>;
export const EditorRenderingPreferencesSchema = z.object({
  vimMappings: VimMappingSettings,
  rulerEnabled: z.boolean(),
  rulerColumn: z.number().int().min(80).max(240),
});
export const defaultRenderingPreferences: EditorRenderingPreferences = editorPreferenceDefaults;
