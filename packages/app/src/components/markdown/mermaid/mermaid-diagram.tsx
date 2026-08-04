import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { MermaidDiagramProps, MermaidDiagramState } from "./mermaid-diagram-contract";
import { MERMAID_RENDER_DEBOUNCE_MS, toMermaidDiagramState } from "./mermaid-diagram-contract";
import { peekMermaidOutcome, resolveMermaidOutcome } from "./mermaid-render";

// Web + Electron host: mermaid runs in the page and its SVG goes straight into a
// DOM node. The raw <div> wrapper is the sanctioned pattern for real DOM
// infrastructure (see docs/unistyles.md and editor/code-editor.tsx);
// mermaid-diagram.native.tsx overrides this file on iOS/Android.
//
// The app-shell CSP (`script-src 'self'`, `style-src 'self' 'unsafe-inline'`)
// is satisfied: mermaid is our own bundle, and the only thing injected is
// markup - `<script>` elements assigned through innerHTML never execute, and
// mermaid's `securityLevel: "strict"` has already sanitized every label.

const WRAPPER_STYLE: CSSProperties = { width: "100%" };

function initialState(code: string, theme: MermaidDiagramProps["theme"]): MermaidDiagramState {
  const cached = peekMermaidOutcome(code, theme);
  return cached ? toMermaidDiagramState(cached) : { status: "pending" };
}

export function MermaidDiagram({ code, theme, renderFallback }: MermaidDiagramProps) {
  const [state, setState] = useState<MermaidDiagramState>(() => initialState(code, theme));
  // The theme object is rebuilt by the withUnistyles mapping on every wrapper
  // render, so effects key off its value (same approach as code-editor.native).
  const themeKey = useMemo(() => JSON.stringify(theme), [theme]);

  useEffect(() => {
    const cached = peekMermaidOutcome(code, theme);
    if (cached) {
      setState(toMermaidDiagramState(cached));
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const outcome = await resolveMermaidOutcome(code, theme);
        if (!cancelled) {
          setState(toMermaidDiagramState(outcome));
        }
      })();
    }, MERMAID_RENDER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `theme` is covered by themeKey; depending on the object itself would
    // re-run on every parent paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, themeKey]);

  const rendered = state.status === "rendered" ? state : null;
  // maxWidth pins the diagram to its natural size - mermaid's own useMaxWidth
  // behaviour, reapplied here after the inline cap is stripped in
  // mermaid-render. Narrow panes scale it down instead.
  const diagramStyle = useMemo<CSSProperties>(
    () => ({ maxWidth: rendered?.width, background: theme.background }),
    [rendered?.width, theme.background],
  );
  const markup = useMemo(() => ({ __html: rendered?.svg ?? "" }), [rendered?.svg]);

  if (!rendered) {
    return renderFallback(state.status === "failed" ? state.message : null);
  }

  return (
    <div style={WRAPPER_STYLE}>
      <div style={diagramStyle} dangerouslySetInnerHTML={markup} />
    </div>
  );
}
