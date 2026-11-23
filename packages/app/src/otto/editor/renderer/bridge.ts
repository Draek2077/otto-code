import { z } from "zod";
import { EditorRenderingPreferencesSchema, VimActionSchema } from "../preferences";
import {
  EditorDiagnostic,
  EditorPosition,
  EditorQueryResult,
  EditorImage,
} from "@getpaseo/plugin/otto/editor";
import { EditorCommandSchema, MarkdownEditorState } from "../markdown/contracts";
import { EditorKeyBinding } from "../shortcuts/contracts";

export const CodeAction = z.enum(["definition", "references", "symbols", "diagnostics", "rename"]);
export const CodeCommand = EditorCommandSchema;
const Session = z.object({ session: z.string().min(1) });
export const NativeEditorMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  Session.extend({
    type: z.literal("change"),
    text: z.string().max(4 * 1024 * 1024),
    sequence: z.number().int().positive(),
  }),
  Session.extend({ type: z.literal("cursor"), position: EditorPosition }),
  Session.extend({
    type: z.literal("selection"),
    characters: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
    range: z.object({ start: EditorPosition, end: EditorPosition }).optional(),
  }),
  Session.extend({ type: z.literal("vim"), mode: z.string().nullable() }),
  Session.extend({ type: z.literal("save") }),
  Session.extend({ type: z.literal("scroll"), fraction: z.number().finite().min(0).max(1) }),
  Session.extend({ type: z.literal("image"), id: z.number().int(), image: EditorImage }),
  Session.extend({ type: z.literal("vim-action"), action: VimActionSchema }),
  Session.extend({ type: z.literal("leader"), sequence: z.string().nullable() }),
  Session.extend({ type: z.literal("action"), action: CodeAction }),
  Session.extend({
    type: z.literal("query"),
    id: z.number().int(),
    action: z.enum(["hover", "completion"]),
    position: EditorPosition,
  }),
  Session.extend({ type: z.literal("error"), message: z.string() }),
]);
export const NativeEditorTheme = z.object({
  problems: z.object({ error: z.string(), warning: z.string(), info: z.string() }),
  colorScheme: z.enum(["light", "dark"]),
  background: z.string(),
  foreground: z.string(),
  cursor: z.string(),
  foregroundMuted: z.string(),
  border: z.string(),
  selection: z.string(),
  monoFont: z.string(),
  codeFontSize: z.number().positive(),
  syntax: z.record(z.string(), z.string()),
});
export const NativeEditorConfig = z.object({
  type: z.literal("config"),
  acknowledgedSequence: z.number().int().nonnegative(),
  session: z.string(),
  text: z.string(),
  filename: z.string(),
  vimEnabled: z.boolean(),
  active: z.boolean(),
  scrollLinked: z.boolean().optional(),
  activation: z.number().int().nonnegative(),
  theme: NativeEditorTheme,
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  columnStart: z.number().int().positive().optional(),
  columnEnd: z.number().int().positive().optional(),
  navigationRevision: z.number(),
  diagnostics: z.array(EditorDiagnostic),
  preferences: EditorRenderingPreferencesSchema,
  markdown: MarkdownEditorState,
  keyBindings: z.array(EditorKeyBinding).max(100),
});
export const NativeEditorInput = z.discriminatedUnion("type", [
  NativeEditorConfig,
  Session.extend({ type: z.literal("scroll"), fraction: z.number().finite().min(0).max(1) }),
  Session.extend({ type: z.literal("command"), command: CodeCommand }),
  Session.extend({
    type: z.literal("image-result"),
    id: z.number().int(),
    insert: z.string().nullable(),
    error: z.string().nullable(),
  }),
  Session.extend({
    type: z.literal("query-result"),
    id: z.number().int(),
    result: EditorQueryResult.nullable(),
  }),
]);
export type NativeEditorInput = z.infer<typeof NativeEditorInput>;
