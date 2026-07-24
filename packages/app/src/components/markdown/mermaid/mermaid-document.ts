/**
 * Wrap standalone diagram source (`.mmd`, `.mermaid`) as a one-fence markdown
 * document.
 *
 * A `.mmd` file *is* a mermaid fence without the fence, so the viewer renders it
 * by handing it to the same markdown pipeline rather than growing a second
 * mermaid host with its own theming, sizing and failure behaviour.
 *
 * The fence is opened with enough backticks to beat the longest run in the
 * source, so a diagram that happens to contain ``` in a label cannot close it
 * early. Content is passed through verbatim — mermaid parses its own YAML
 * frontmatter, so nothing may be stripped on the way in.
 */
export function toMermaidFenceDocument(source: string): string {
  let longestRun = 0;
  for (const match of source.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}mermaid\n${source.replace(/\s+$/, "")}\n${fence}`;
}
