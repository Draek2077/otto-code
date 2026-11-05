import { z } from "zod";
import { MARKDOWN_COMMAND_NAMES } from "../markdown/contracts";
export const EditorKeyAction = z.enum([
  "save",
  "find",
  "goToLine",
  "goToDefinition",
  "findReferences",
  "renameSymbol",
  "outline",
  ...MARKDOWN_COMMAND_NAMES,
]);
export type EditorKeyAction = z.infer<typeof EditorKeyAction>;
export const EditorKeyBinding = z.object({ action: EditorKeyAction, key: z.string().max(128) });
export type EditorKeyBinding = z.infer<typeof EditorKeyBinding>;
