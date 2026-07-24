import type { ReactNode } from "react";
import type { MermaidThemeConfig } from "./mermaid-contract";
import type { MermaidOutcome } from "./mermaid-render";

/**
 * The props both platform implementations of `MermaidDiagram` honour
 * (`mermaid-diagram.tsx` for web/Electron, `mermaid-diagram.native.tsx` for
 * iOS/Android).
 *
 * `renderFallback` is what keeps the "never a blank box" guarantee structural
 * rather than remembered: neither implementation has a state that draws nothing.
 * While a diagram is still being laid out, and forever after a parse failure,
 * the caller's fallback (the highlighted source, plus the message when there is
 * one) is what renders.
 */
export interface MermaidDiagramProps {
  code: string;
  theme: MermaidThemeConfig;
  renderFallback: (error: string | null) => ReactNode;
}

export type MermaidDiagramState =
  | { status: "pending" }
  | { status: "rendered"; svg: string; width: number }
  | { status: "failed"; message: string };

/**
 * How long a diagram source settles before it is rendered.
 *
 * Always applied, never skipped for a first paint: the markdown library remints
 * node keys on every parse, so a fence streaming into a chat message remounts
 * this component per flush. Debouncing unconditionally is what stops that from
 * becoming one full mermaid render (or, on native, one WebView) per flush. The
 * cost — a beat of source before a diagram appears — is paid once per document,
 * because `peekMermaidOutcome` answers every later remount instantly.
 */
export const MERMAID_RENDER_DEBOUNCE_MS = 250;

export function toMermaidDiagramState(outcome: MermaidOutcome): MermaidDiagramState {
  return outcome.status === "rendered"
    ? { status: "rendered", svg: outcome.result.svg, width: outcome.result.width }
    : { status: "failed", message: outcome.message };
}
