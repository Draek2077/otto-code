import { readFileSync, statSync } from "node:fs";

/**
 * Validates that a string contains reasonable HTML content.
 * Does not perform full parsing - just basic structural checks.
 */
export function isValidHtmlContent(content: string): boolean {
  // Minimum length check (basic HTML needs at least ~50 chars)
  if (content.length < 50) return false;

  // Must have HTML structure indicators
  const hasDoctype = /<!DOCTYPE\s+html/i.test(content);
  const hasHtmlTag = /<html[^>]*>/i.test(content);
  const hasBasicTags = /<(head|body)/i.test(content);

  return (hasDoctype || hasHtmlTag) && (hasBasicTags || content.includes("<"));
}

// Artifacts are LLM-generated HTML rendered inline (WebView/iframe/webview guest)
// on every platform. This CSP is the one hardening layer that reaches all of
// them regardless of renderer: it blocks the artifact from making any network
// call (fetch/XHR/WebSocket/beacon) or framing/submitting to anywhere, while
// still allowing the inline script/style/data-URI assets an artifact needs to
// render itself. Per-platform WebView/webview sandboxing is defense in depth
// on top of this, not a substitute for it.
const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * Inserts a restrictive Content-Security-Policy meta tag into the document
 * head so artifact content cannot reach the network no matter which platform
 * renders it. Idempotent - a document that already has one is left alone.
 */
export function injectContentSecurityPolicy(content: string): string {
  if (/<meta[^>]+http-equiv=["']Content-Security-Policy["']/i.test(content)) {
    return content;
  }

  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;

  const headOpenMatch = content.match(/<head[^>]*>/i);
  if (headOpenMatch) {
    const insertAt = headOpenMatch.index! + headOpenMatch[0].length;
    return content.slice(0, insertAt) + cspTag + content.slice(insertAt);
  }

  const htmlOpenMatch = content.match(/<html[^>]*>/i);
  if (htmlOpenMatch) {
    const insertAt = htmlOpenMatch.index! + htmlOpenMatch[0].length;
    return content.slice(0, insertAt) + `<head>${cspTag}</head>` + content.slice(insertAt);
  }

  return cspTag + content;
}

/**
 * Sanitizes HTML content by stripping common wrapper artifacts
 * that models might add (markdown code fences, explanations), and injecting
 * a restrictive CSP so the artifact cannot make network calls.
 */
export function sanitizeHtmlContent(content: string): string {
  // Strip markdown code fences if present
  let sanitized = content.replace(/^```html\s*\n?/, "");
  sanitized = sanitized.replace(/^```\s*\n?/, "");
  sanitized = sanitized.replace(/\n?```\s*$/, "");

  // Remove any trailing explanations after closing HTML tags
  const htmlEndMatch = sanitized.match(/(<\/html>)(?:\s|<)/is);
  if (htmlEndMatch) {
    // Keep only content up to and including </html>
    sanitized = sanitized.substring(0, htmlEndMatch.index! + "</html>".length);
  }

  sanitized = injectContentSecurityPolicy(sanitized.trim());

  return sanitized.trim();
}

/**
 * Validates an HTML file on disk exists and contains valid HTML.
 * Returns the validated content or null if validation fails.
 */
export function validateHtmlFile(filePath: string): { content: string; isValid: boolean } {
  try {
    // Check file exists and has minimum size
    const stats = statSync(filePath);

    // Must have non-zero size (minimum ~50 bytes for basic HTML)
    if (stats.size < 50) {
      return { content: "", isValid: false };
    }

    // Read and validate content
    const rawContent = readFileSync(filePath, "utf-8");

    // Sanitize first (remove code fences etc)
    const sanitized = sanitizeHtmlContent(rawContent);

    return {
      content: sanitized,
      isValid: isValidHtmlContent(sanitized),
    };
  } catch {
    return { content: "", isValid: false };
  }
}
