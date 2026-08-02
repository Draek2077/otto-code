import MarkdownIt from "markdown-it";
import { applyFootnotes } from "./footnotes";
import { ALERT_ATTRIBUTE, applyGithubAlerts } from "./github-alerts";
import { applyTaskListMarkers, TASK_STATE_ATTRIBUTE } from "./task-lists";

/**
 * Export a markdown document as one standalone HTML file.
 *
 * The same markdown-it extensions the app renders with, pointed at markdown-it's
 * own HTML renderer instead of the React Native one. That is the whole reason
 * task lists, alerts and footnotes were built as token rewrites over standard
 * node types: the export gets all three for free, and cannot drift from what the
 * viewer shows, because there is only one parse.
 *
 * **Standalone means standalone.** The CSS is inlined and nothing is fetched at
 * open time, so the file works from a thumb drive, an email attachment or a
 * `file://` URL with no network. The one thing it does not carry is the
 * document's own images: a relative `![](assets/x.png)` stays relative, so it
 * resolves when the HTML is saved beside the document and shows as its alt text
 * otherwise. Inlining them would mean reading every image through the daemon and
 * base64-ing it into the file, which is a different feature with a different
 * cost.
 */

export interface MarkdownHtmlDocument {
  /** The complete file, `<!doctype html>` onwards. */
  html: string;
  /** What went in `<title>`, so a caller can name the file the same way. */
  title: string;
}

/** Embedded HTML is translated on the way in, never passed through. See docs/markdown-rendering.md. */
const exportParser = applyFootnotes(
  applyGithubAlerts(applyTaskListMarkers(MarkdownIt({ typographer: true, linkify: true }))),
);

const UNCHECKED_GLYPH = "☐";
const CHECKED_GLYPH = "☑";

/**
 * Task state lives in an attribute rather than in the item's text (see
 * `task-lists.ts`), so the HTML renderer has to draw the box itself the way the
 * React Native `list_item` rule does. A real `<input type=checkbox>` would be
 * interactive in a browser and change nothing on disk, which is worse than a
 * glyph that is honestly static.
 */
const defaultListItemOpen =
  exportParser.renderer.rules.list_item_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

exportParser.renderer.rules.list_item_open = (tokens, index, options, env, self) => {
  const state = tokens[index].attrGet(TASK_STATE_ATTRIBUTE);
  const rendered = defaultListItemOpen(tokens, index, options, env, self);
  if (state !== "checked" && state !== "unchecked") {
    return rendered;
  }
  const glyph = state === "checked" ? CHECKED_GLYPH : UNCHECKED_GLYPH;
  return `${rendered}<span class="task">${glyph}</span> `;
};

/**
 * The first level-1 heading, which is what a markdown document uses as its
 * title far more reliably than frontmatter does.
 */
function readTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split("\n")) {
    const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (match) {
      return match[1].trim();
    }
  }
  return fallback;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Deliberately plain, and deliberately not Otto's theme.
 *
 * An exported file is read outside this app, usually in a browser, often
 * printed. It should look like a document, honour the reader's own light/dark
 * preference, and never depend on a font that is not installed.
 */
const STYLESHEET = `
:root { color-scheme: light dark; --fg: #1a1a1a; --muted: #666; --line: #d8d8d8; --bg: #ffffff; --code-bg: #f4f4f4; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6e6e6; --muted: #9a9a9a; --line: #333; --bg: #16161a; --code-bg: #1f1f24; }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 2.5rem 1.25rem; max-width: 46rem;
  background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2rem 0 0.75rem; }
h1 { font-size: 2rem; } h2 { font-size: 1.5rem; } h3 { font-size: 1.25rem; }
h1, h2 { border-bottom: 1px solid var(--line); padding-bottom: 0.3rem; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1rem; }
a { color: inherit; }
code { background: var(--code-bg); padding: 0.15em 0.35em; border-radius: 3px; font-size: 0.9em;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
pre { background: var(--code-bg); padding: 1rem; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 0.875rem; }
blockquote { border-left: 3px solid var(--line); margin-left: 0; padding: 0.1rem 0 0.1rem 1rem; color: var(--muted); }
blockquote[${ALERT_ATTRIBUTE}] { border-left-width: 4px; }
blockquote[${ALERT_ATTRIBUTE}]::before {
  display: block; font-weight: 600; text-transform: capitalize; color: var(--fg);
  content: attr(${ALERT_ATTRIBUTE});
}
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--line); padding: 0.4rem 0.6rem; text-align: left; }
th { background: var(--code-bg); }
hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
img { max-width: 100%; }
.task { font-size: 1.1em; }
li:has(> .task) { list-style: none; margin-left: -1.2em; }
@media print { body { max-width: none; padding: 0; } }
`.trim();

/**
 * Render markdown as a complete HTML document.
 *
 * `fallbackTitle` is used when the document has no level-1 heading; pass the
 * file name.
 */
export function markdownToHtmlDocument(
  markdown: string,
  fallbackTitle: string,
): MarkdownHtmlDocument {
  const title = readTitle(markdown, fallbackTitle);
  const body = exportParser.render(markdown);
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${STYLESHEET}\n</style>`,
    "</head>",
    "<body>",
    body.trimEnd(),
    "</body>",
    "</html>",
    "",
  ].join("\n");
  return { html, title };
}

/** `notes/design.md` exports as `design.html`. */
export function htmlExportFileName(path: string): string {
  const base = path.split(/[/\\]/).findLast(Boolean) ?? "document";
  return `${base.replace(/\.[^.]+$/, "")}.html`;
}
