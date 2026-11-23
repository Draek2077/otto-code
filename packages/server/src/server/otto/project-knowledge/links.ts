/** Frozen 0.9 wiki syntax, including aliases and heading suffixes. */
export function wikiLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((match) =>
    match[1].trim(),
  );
}

/** Frozen 0.9 removal semantics: repair only lines that lost this exact wiki-link.
 * Other targets, ordinary text, and historical timelines are not inputs here. */
export function removeWikiLinksTo(markdown: string, id: string): string {
  const kept: string[] = [];
  let changed = false;
  for (const line of markdown.split("\n")) {
    let removed = false;
    const stripped = line.replace(
      /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g,
      (full: string, target: string) => {
        if (target.trim() !== id) return full;
        removed = true;
        return "";
      },
    );
    if (!removed) {
      kept.push(line);
      continue;
    }
    changed = true;
    const tidied = tidyAfterLinkRemoval(stripped);
    if (tidied !== null) kept.push(tidied);
  }
  return changed ? kept.join("\n").replace(/\n{3,}/g, "\n\n") : markdown;
}
function tidyAfterLinkRemoval(line: string): string | null {
  const marker = line.match(/^([ \t]*)([-*+]|\d+[.)])[ \t]+/);
  if (marker) {
    const content = collapseGaps(line.slice(marker[0].length))
      .replace(/^[-:|,;·–—]+[ \t]*/, "")
      .trim();
    return content ? `${marker[1]}${marker[2]} ${content}` : null;
  }
  const indent = line.match(/^[ \t]*/)?.[0] ?? "";
  const content = collapseGaps(line.slice(indent.length)).trimEnd();
  return content ? `${indent}${content}` : null;
}
function collapseGaps(value: string): string {
  return value.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.;:!?)\]])/g, "$1");
}
