import {
  WIDGET_MAX_CODE_CHARS,
  WIDGET_MAX_LOADING_MESSAGE_CHARS,
  WIDGET_MAX_LOADING_MESSAGES,
  WIDGET_MAX_TITLE_CHARS,
  detectWidgetMode,
  type WidgetMode,
} from "@otto-code/protocol/widgets/types";

/**
 * Sanitizing for widget FRAGMENTS.
 *
 * Deliberately not `artifact/html-validator.ts`. That one is written for whole
 * documents: it trims everything after `</html>` and its `isValidHtmlContent`
 * requires a DOCTYPE or an `<html>` tag. Both are exactly wrong here - a widget
 * that legitimately has neither would be judged invalid, and a widget that
 * wrongly has an `</html>` would be silently truncated. Same problem, opposite
 * shape, so it gets its own pass.
 *
 * This is a normalizer, not a security boundary. Containment is the CSP in
 * `protocol/widgets/document.ts` plus the per-platform sandbox; nothing here
 * tries to out-parse a browser.
 */

const CODE_FENCE_OPEN = /^\s*```(?:html|svg|xml)?[ \t]*\r?\n/i;
const CODE_FENCE_CLOSE = /\r?\n?[ \t]*```\s*$/;

/**
 * A model told "fragments only" still sometimes ships a whole page. Unwrapping
 * to the body is strictly better than rendering a nested document: the outer
 * `<html>`/`<head>` would be dropped by the parser anyway, but a `<head>` full
 * of `<style>` would go with it and the widget would render unstyled.
 */
function unwrapDocument(content: string): string {
  const withoutDoctype = content.replace(/^\s*<!DOCTYPE[^>]*>/i, "").trim();
  const bodyMatch = withoutDoctype.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) {
    // No <body>, but possibly a stray <html> wrapper - strip the tags and keep
    // everything, head styles included.
    return withoutDoctype
      .replace(/<\/?html[^>]*>/gi, "")
      .replace(/<\/?head[^>]*>/gi, "")
      .replace(/<\/?body[^>]*>/gi, "")
      .trim();
  }
  // Carry any <head> styles down with the body so the widget keeps its look.
  const headMatch = withoutDoctype.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headStyles = headMatch
    ? (headMatch[1].match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n")
    : "";
  return `${headStyles}\n${bodyMatch[1]}`.trim();
}

export interface SanitizedWidgetFragment {
  code: string;
  mode: WidgetMode;
  truncated: boolean;
}

export class WidgetFragmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WidgetFragmentError";
  }
}

export function sanitizeWidgetFragment(rawCode: string): SanitizedWidgetFragment {
  let code = rawCode.replace(CODE_FENCE_OPEN, "");
  code = code.replace(CODE_FENCE_CLOSE, "");
  code = code.trim();

  if (/^\s*<!DOCTYPE/i.test(code) || /<html[\s>]/i.test(code) || /<body[\s>]/i.test(code)) {
    code = unwrapDocument(code);
  }

  if (!code) {
    throw new WidgetFragmentError("widget_code is empty after sanitizing.");
  }
  if (!code.includes("<")) {
    throw new WidgetFragmentError(
      "widget_code must be HTML or SVG markup - plain text is not a widget.",
    );
  }

  let truncated = false;
  if (code.length > WIDGET_MAX_CODE_CHARS) {
    // Cutting markup mid-tag produces a broken render rather than a partial
    // one, so say so in the document itself instead of failing silently.
    code = `${code.slice(0, WIDGET_MAX_CODE_CHARS)}\n<!-- truncated -->`;
    truncated = true;
  }

  return { code, mode: detectWidgetMode(code), truncated };
}

export function sanitizeWidgetTitle(rawTitle: string): string {
  const title = rawTitle.trim().slice(0, WIDGET_MAX_TITLE_CHARS);
  return title || "widget";
}

export function sanitizeWidgetLoadingMessages(raw: readonly string[] | undefined): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((message): message is string => typeof message === "string")
    .map((message) => message.trim().slice(0, WIDGET_MAX_LOADING_MESSAGE_CHARS))
    .filter((message) => message.length > 0)
    .slice(0, WIDGET_MAX_LOADING_MESSAGES);
}
