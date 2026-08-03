import type { TextStyle } from "react-native";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { useSettledFenceCode } from "./fence-highlight-debounce";
import { isMermaidFenceLanguage } from "./mermaid/mermaid-contract";
import { MermaidBlock } from "./mermaid/mermaid-block";

/**
 * What a fenced code block renders as.
 *
 * The single dispatch point for fence info strings that mean something other
 * than "highlight this as code". Both markdown `fence` rules — the shared one in
 * `markdown/renderer.tsx` and the assistant-message copy in `message.tsx` —
 * route through here, so a new fence language lights up chat, the file viewer,
 * and the pull-request panel at once.
 *
 * It is also where a streaming fence is throttled: `useSettledFenceCode` is what
 * stops a fence that is still being typed from re-tokenizing itself on every
 * reveal tick. Mermaid keeps the raw code — it runs its own debounce
 * (`MERMAID_RENDER_DEBOUNCE_MS`) and stacking a second one would only make a
 * diagram settle later.
 */
export function MarkdownFence({
  code,
  language,
  inheritedStyles,
  textStyle,
  detectUntagged,
}: {
  code: string;
  language: string | null | undefined;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  detectUntagged?: boolean;
}) {
  const settledCode = useSettledFenceCode(code);

  if (isMermaidFenceLanguage(language)) {
    return <MermaidBlock code={code} inheritedStyles={inheritedStyles} textStyle={textStyle} />;
  }

  return (
    <HighlightedCodeBlock
      code={settledCode}
      language={language}
      inheritedStyles={inheritedStyles}
      textStyle={textStyle}
      detectUntagged={detectUntagged}
    />
  );
}
