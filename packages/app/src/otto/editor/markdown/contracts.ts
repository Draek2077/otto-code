import { z } from "zod";
export const MARKDOWN_COMMAND_NAMES = [
  "markdownBold",
  "markdownItalic",
  "markdownCode",
  "markdownStrikethrough",
  "markdownLink",
  "markdownImage",
  "markdownBulletList",
  "markdownOrderedList",
  "markdownTaskList",
  "markdownToggleTask",
  "markdownBlockquote",
  "markdownCodeFence",
  "markdownHorizontalRule",
  "markdownTable",
  "markdownTableFormat",
  "markdownTableRowBelow",
  "markdownTableRowDelete",
  "markdownTableColumnRight",
  "markdownTableColumnDelete",
  "markdownTableAlign",
  "markdownHeading1",
  "markdownHeading2",
  "markdownHeading3",
  "markdownHeading4",
  "markdownHeading5",
  "markdownHeading6",
] as const;
export const MarkdownCommandSchema = z.enum(MARKDOWN_COMMAND_NAMES);
export type MarkdownCommandName = z.infer<typeof MarkdownCommandSchema>;
export const MarkdownEditorState = z.object({
  livePreview: z.boolean(),
  targets: z.array(z.string()).max(5000),
});
export type MarkdownEditorState = z.infer<typeof MarkdownEditorState>;
export const EditorCommandSchema = z.enum([
  "find",
  "goToLine",
  "undo",
  "redo",
  "toggleComment",
  ...MARKDOWN_COMMAND_NAMES,
]);
export interface EditorDroppedImage {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export function isMarkdownCommandName(value: string): value is MarkdownCommandName {
  return MarkdownCommandSchema.safeParse(value).success;
}
