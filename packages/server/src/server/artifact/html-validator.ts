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

/**
 * Sanitizes HTML content by stripping common wrapper artifacts
 * that models might add (markdown code fences, explanations).
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
