import { useMemo } from "react";
import { FileEditorView } from "@/file-pane/editor/view.web";
import { codeExtensions } from "../code/extensions";
import type { EditorRendererProps } from "./props";

export function EditorRenderer({ code, ...props }: EditorRendererProps) {
  const extensions = useMemo(
    () => codeExtensions(code, props.theme, props.filename),
    [code, props.theme, props.filename],
  );
  return <FileEditorView {...props} ottoExtensions={extensions} />;
}
