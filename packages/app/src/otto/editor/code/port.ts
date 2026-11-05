import type { z } from "zod";
import type { EditorRenderingPreferences, VimAction } from "../preferences";
import type { MarkdownEditorState, EditorCommandSchema } from "../markdown/contracts";
import type { EditorKeyBinding } from "../shortcuts/contracts";
import type {
  EditorDiagnostic,
  EditorQueryResult,
  EditorPosition,
  EditorImage,
} from "@getpaseo/plugin/otto/editor";

export type CodeAction = "definition" | "references" | "symbols" | "diagnostics" | "rename";
export type CodePosition = z.infer<typeof EditorPosition>;
export type CodeCommand = z.infer<typeof EditorCommandSchema>;
/** Both the desktop adapter and the offline native WebView implement this port.
 * The renderer never constructs a daemon connection or owns file persistence. */
export interface CodePort {
  scroll?: {
    enabled(): boolean;
    report(fraction: number): void;
    subscribe(listener: (fraction: number) => void): () => void;
  };
  request(
    action: "hover" | "completion",
    position: CodePosition,
  ): Promise<EditorQueryResult | null>;
  action(action: CodeAction): void;
  position(position: CodePosition): void;
  selection(
    characters: number,
    lines: number,
    range?: { start: CodePosition; end: CodePosition },
  ): void;
  diagnostics(): readonly EditorDiagnostic[];
  subscribe(listener: () => void): () => void;
  onCommand(listener: (command: CodeCommand) => boolean): () => void;
  rendering(): EditorRenderingPreferences;
  markdown(): MarkdownEditorState;
  keyBindings(): EditorKeyBinding[];
  writeImage(image: EditorImage): Promise<string | null>;
  reportError(message: string): void;
  vimAction(action: VimAction): void;
  leaderPending(sequence: string | null): void;
  active(): boolean;
  activation(): number;
}
