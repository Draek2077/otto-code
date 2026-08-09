/**
 * Regression for R07-01: author-supplied CSP meta tags used to bypass artifact
 * hardening because the validator left any existing policy unchanged. Every
 * rendered artifact must instead contain exactly one Otto-owned policy.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  injectContentSecurityPolicy,
  sanitizeHtmlContent,
  validateHtmlFile,
} from "./html-validator.js";

const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";
const OTTO_CSP_TAG = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
const CSP_META_PATTERN =
  /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?content-security-policy(?:["']|\s|\/?>)[^>]*>/gi;

describe("artifact HTML CSP canonicalization", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "html-validator-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("replaces a permissive CSP in a complete document with Otto's restrictive policy", () => {
    const content = [
      "<!doctype html><html><head>",
      '<meta http-equiv="Content-Security-Policy" content="default-src *; connect-src *">',
      "<title>Artifact</title></head><body>Safe content</body></html>",
    ].join("");

    const sanitized = sanitizeHtmlContent(content);

    expect(sanitized).toContain(OTTO_CSP_TAG);
    expect(sanitized).not.toContain("default-src *");
    expect(sanitized.match(CSP_META_PATTERN)).toEqual([OTTO_CSP_TAG]);
  });

  it("removes every existing CSP meta element before injecting one Otto-owned policy", () => {
    const content = [
      "<!doctype html><html><head>",
      '<meta content="default-src *" http-equiv="content-security-policy">',
      '<meta http-equiv=Content-Security-Policy content="connect-src https://example.com">',
      '<meta name="viewport" content="width=device-width">',
      "</head><body>Safe content</body></html>",
    ].join("");

    const sanitized = sanitizeHtmlContent(content);

    expect(sanitized).toContain('<meta name="viewport" content="width=device-width">');
    expect(sanitized).not.toContain("https://example.com");
    expect(sanitized.match(CSP_META_PATTERN)).toEqual([OTTO_CSP_TAG]);
  });

  it("is idempotent after canonicalizing CSP meta elements", () => {
    const content =
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>Safe content</body></html>';

    const once = injectContentSecurityPolicy(content);

    expect(injectContentSecurityPolicy(once)).toBe(once);
  });

  it("returns canonicalized content through validateHtmlFile for watcher writes", async () => {
    const filePath = join(tempDir, "artifact.html");
    await writeFile(
      filePath,
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>Safe content</body></html>',
    );

    const validation = validateHtmlFile(filePath);

    expect(validation.isValid).toBe(true);
    expect(validation.content.match(CSP_META_PATTERN)).toEqual([OTTO_CSP_TAG]);
    expect(validation.content).not.toContain("default-src *");
  });
});
