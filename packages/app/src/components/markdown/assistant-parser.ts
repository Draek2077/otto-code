// `markdown-it` directly, the way `parser.ts` takes it, rather than through
// `react-native-markdown-display`'s re-export: the library ships raw JSX that
// the unit test project cannot import. `markdown-it-resolution.test.ts` pins
// that both names resolve to the same module.
import MarkdownIt from "markdown-it";
import { applyTaskListMarkers } from "./task-lists";
import { applyFootnotes } from "./footnotes";
import { applyMath } from "./math";

/**
 * The markdown-it instance an assistant reply is parsed with.
 *
 * Its own module rather than a const inside `message.tsx` so the plugin set is
 * assertable: chat's parser is deliberately not `defaultMarkdownParser` (see
 * docs/markdown-rendering.md), which makes it the place a shared extension
 * silently fails to reach.
 *
 * A factory, not a singleton: `validateLink` is mutated below, so one instance
 * per bubble keeps that patch from being applied to a shared object twice.
 */
export function createAssistantMarkdownParser(): ReturnType<typeof MarkdownIt> {
  const parser = applyMath(
    applyFootnotes(applyTaskListMarkers(MarkdownIt({ typographer: true, linkify: true }))),
  );

  // Agents link to files they touched; markdown-it rejects `file://` by
  // default, which would render those as plain text.
  const defaultValidateLink = parser.validateLink.bind(parser);
  parser.validateLink = (url: string) => {
    if (url.trim().toLowerCase().startsWith("file://")) {
      return true;
    }

    return defaultValidateLink(url);
  };

  return parser;
}
