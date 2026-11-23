import type { FileEditorModel } from "@/file-pane/editor/model";
import type { EditorVisualTheme } from "@/file-pane/editor/extensions.web";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { CodePort } from "../code/port";
import type { EditorProblemColors } from "../code/overview";

export interface EditorRendererProps {
  model: FileEditorModel;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  vimEnabled: boolean;
  theme: EditorVisualTheme & { problems: EditorProblemColors };
  onCursorChange(position: { line: number; column: number }): void;
  onVimModeChange(mode: string | null): void;
  code: CodePort;
}
