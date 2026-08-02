import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { extractMarkdownHeadings } from "@otto-code/highlight";
import { fuzzyFilter } from "@/file-explorer/fuzzy-match";
import {
  encodeLinkPath,
  findLinkCompletionContext,
  headingAnchors,
  relativeLinkPath,
} from "./markdown-link-completion";

/**
 * Link and heading completion for markdown documents.
 *
 * Two sources behind one trigger, both hanging off the `](` a link target opens
 * with. Files come from the workspace listing the host pushes in; anchors come
 * from the document itself, parsed on demand, because the client already holds
 * the text it wants a table of contents for.
 */

/**
 * Enough to scroll, few enough to stay responsive on a phone. The list is
 * ranked, so the cut only ever removes worse matches than the ones shown, and
 * typing one more character re-ranks the whole workspace rather than narrowing
 * this window.
 */
const MAX_FILE_COMPLETIONS = 50;

/** Replace the workspace file list the link source offers. */
export const setMarkdownLinkTargetsEffect = StateEffect.define<readonly string[]>();

/**
 * The paths the host has pushed, as a snapshot rather than a query.
 *
 * The editor core runs inside a webview on native, so it cannot call the daemon
 * itself: everything it knows about the workspace arrives as a serialisable
 * message. That is the same shape `setDiagnostics` uses, and for the same
 * reason.
 */
const linkTargetsField = StateField.define<readonly string[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setMarkdownLinkTargetsEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

function anchorCompletions(doc: string, from: number): CompletionResult {
  const options: Completion[] = headingAnchors(extractMarkdownHeadings(doc)).map((heading) => ({
    label: heading.anchor,
    // The heading as written, so a reader picking from the list sees the
    // section rather than only its slug.
    detail: heading.text,
    // Deeper headings sort after their parents at equal match quality, which
    // matches the order they appear on the page.
    boost: -heading.level,
  }));
  return { from, options, validFor: /^[^\s)#]*$/ };
}

function fileCompletions(
  targets: readonly string[],
  currentPath: string,
  query: string,
  from: number,
): CompletionResult | null {
  const matches = fuzzyFilter(targets, query, (path) => path, MAX_FILE_COMPLETIONS);
  if (matches.length === 0) {
    return null;
  }
  const options: Completion[] = matches.map((match) => ({
    // Workspace-relative in the list because that is how people know a file,
    // but document-relative in the buffer because that is what resolves.
    label: match.item,
    apply: encodeLinkPath(relativeLinkPath(currentPath, match.item)),
  }));
  return {
    from,
    options,
    // `fuzzyFilter` already ranked these against the query, and CodeMirror's own
    // filter is a prefix match that would throw most of them away.
    filter: false,
  };
}

function markdownLinkCompletionSource(currentPath: string): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const doc = context.state.doc.toString();
    const found = findLinkCompletionContext(doc, context.pos);
    if (!found) {
      return null;
    }

    if (found.kind === "anchor") {
      // Only this document's headings. Another file's would mean reading it,
      // and the editor has no file access of its own on either platform.
      return found.file === "" ? anchorCompletions(doc, found.from) : null;
    }

    const targets = context.state.field(linkTargetsField);
    if (targets.length === 0) {
      return null;
    }
    return fileCompletions(targets, currentPath, found.query, found.from);
  };
}

/**
 * Mounted only for markdown files, which is why the completion keymap cannot
 * reach a `.ts` buffer and why `completeHTMLTags` is worth turning on: the
 * source it registers needs an `autocompletion()` to run inside.
 *
 * `markdownLanguage.data.of(...)` is an extension value, not a global mutation,
 * so the `currentPath` closure stays scoped to this editor.
 */
export function markdownCompletionExtension(currentPath: string): Extension {
  return [
    linkTargetsField,
    autocompletion({
      // No icon column: the two sources here are files and headings, and an
      // icon that is the same for every row in the list is pure noise.
      icons: false,
    }),
    markdownLanguage.data.of({ autocomplete: markdownLinkCompletionSource(currentPath) }),
  ];
}
