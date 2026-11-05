import { useCallback } from "react";
import { FileOutput } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuHint,
} from "@/components/ui/dropdown-menu";
import { getDesktopHost } from "@/desktop/host";
import type { Theme } from "@/styles/theme";
import type { EditorSurface } from "./surface";
import { isMarkdownPath } from "./markdown/markdown-path";
const Icon = withUnistyles(FileOutput);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export function EditorExportItems({ surface }: { surface: EditorSurface }) {
  const html = useCallback(() => void surface.exportDocument("html"), [surface]);
  const pdf = useCallback(() => void surface.exportDocument("pdf"), [surface]);
  if (!isMarkdownPath(surface.file)) return null;
  return (
    <>
      <DropdownMenuItem onSelect={html}>Export new HTML file</DropdownMenuItem>
      {getDesktopHost()?.documentExport ? (
        <DropdownMenuItem onSelect={pdf}>Export new PDF file</DropdownMenuItem>
      ) : null}
      <DropdownMenuHint>
        Creates a new file beside this document on the selected host.
      </DropdownMenuHint>
    </>
  );
}
export function EditorDocumentTools({ surface }: { surface: EditorSurface }) {
  if (!isMarkdownPath(surface.file)) return null;
  return (
    <DropdownMenu>
      <ToolbarButton kind="menu" label="Document tools" testID="editor-document-tools">
        <Icon size={14} uniProps={color} />
      </ToolbarButton>
      <DropdownMenuContent side="bottom" align="end" width={280} sheetTitle="Document tools">
        <EditorExportItems surface={surface} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
