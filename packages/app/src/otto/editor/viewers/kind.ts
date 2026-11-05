import { filePreviewRenderKind } from "@/components/file-pane-render-mode";
export function editorPreviewKind(path: string) {
  if (/\.(?:mmd|mermaid)$/iu.test(path)) return "mermaid" as const;
  if (/\.(?:adoc|asciidoc)$/iu.test(path)) return "asciidoc" as const;
  return filePreviewRenderKind(path);
}
