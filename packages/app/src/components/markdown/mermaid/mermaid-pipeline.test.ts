import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { splitHtmlishMarkdown } from "@/components/markdown/html-ish";
import { applyTaskListMarkers } from "@/components/markdown/task-lists";
import { isMermaidFenceLanguage } from "./mermaid-contract";

// The bug this feature fixes was reported against the *file viewer*, which is
// the one surface that runs the embedded-HTML translation pass over a document
// before markdown-it sees it. A mermaid fence has to survive that pass byte for
// byte: mermaid's grammar is whitespace- and newline-sensitive, so a fence body
// that gets its indentation stripped (rule 4 in docs/markdown-rendering.md)
// stops parsing.
const DOCUMENT = `# Architecture

Some prose with <strong>embedded HTML</strong> in it.

\`\`\`mermaid
flowchart TD
  Client -->|websocket| Daemon
  Daemon --> Agent
\`\`\`

<details>
<summary>More</summary>

\`\`\`mermaid
sequenceDiagram
  App->>Daemon: file.read
\`\`\`

</details>
`;

function mermaidFences(markdown: string) {
  return applyTaskListMarkers(new MarkdownIt({ typographer: true, linkify: true }))
    .parse(markdown, {})
    .filter((token) => token.type === "fence" && isMermaidFenceLanguage(token.info));
}

describe("mermaid fences through the viewer's pipeline", () => {
  it("survives the HTML translation pass unchanged", () => {
    const parts = splitHtmlishMarkdown(DOCUMENT, { remoteImages: "altText" });
    const fences = parts
      .filter((part) => part.kind === "markdown")
      .flatMap((part) => mermaidFences(part.text));

    expect(fences).toHaveLength(1);
    expect(fences[0]?.content).toBe(
      "flowchart TD\n  Client -->|websocket| Daemon\n  Daemon --> Agent\n",
    );
  });

  it("survives inside a <details> body too", () => {
    const parts = splitHtmlishMarkdown(DOCUMENT, { remoteImages: "altText" });
    const details = parts.find((part) => part.kind === "details");

    expect(details).toBeDefined();
    const body =
      details?.kind === "details"
        ? (details.bodyParts ?? [{ kind: "markdown" as const, text: details.body }])
        : [];
    const fences = body
      .filter((part) => part.kind === "markdown")
      .flatMap((part) => mermaidFences(part.text));

    expect(fences).toHaveLength(1);
    expect(fences[0]?.content).toBe("sequenceDiagram\n  App->>Daemon: file.read\n");
  });

  it("is a plain code fence to markdown-it, so only the fence rule sees it", () => {
    const [fence] = mermaidFences("```mermaid\ngraph TD\n  A --> B\n```");

    expect(fence?.type).toBe("fence");
    expect(fence?.info).toBe("mermaid");
  });
});
