/**
 * Assembles everything that reaches the model before the user types, in the
 * order it reaches it, as readable text.
 *
 * The graph answers *what* is loaded and *what it costs*. It cannot answer the
 * question users actually ask first — "so what is the model reading?" — because
 * a tree of filenames and token counts never shows the thing itself. This module
 * concatenates the real content, once, for reading only.
 *
 * Three rules it exists to hold:
 *
 * 1. **Derived, never authoritative.** Sections are re-read from the files the
 *    scan resolved. Editing happens in the file pane against the real file; this
 *    view has no write path, so a stale preview can only be stale, never wrong
 *    in a way that lands on disk.
 * 2. **A section Otto cannot see says so.** Every CLI-backed provider composes
 *    its own preset internally. That section ships with no text and
 *    `visibility: "not_visible"` rather than being silently skipped — an absent
 *    section reads as "there is nothing there", which is the wrong conclusion.
 * 3. **Only fixed weight.** Conditional and referenced files are not in the
 *    request, so putting them in a preview of the request would misrepresent it.
 */

import fs from "node:fs/promises";
import { estimateTokens } from "../context-composition.js";
import { extractFrontmatter } from "./context-graph-scanner.js";
import type {
  ContextCategory,
  ContextCategoryVisibility,
  ContextNode,
  ContextReport,
} from "./types.js";

/** One readable block in the assembled prompt. */
export interface ContextPromptSection {
  category: ContextCategory;
  /** Display name: a file's `relPath`, or the synthetic name of a runtime block. */
  label: string;
  visibility: ContextCategoryVisibility;
  /** Absent exactly when the section is `not_visible`. */
  text?: string;
  estTokens: number;
}

/**
 * Load order, which is also reading order. `system_prompt` leads because it is
 * what the provider puts in front of everything else, and `context_files` follow
 * their own resolved order within the category.
 */
const SECTION_ORDER: ContextCategory[] = [
  "system_prompt",
  "otto_injected",
  "context_files",
  "memory_index",
  "skills_roster",
  "mcp_tools",
];

export interface BuildPromptPreviewInput {
  report: ContextReport;
  /** Text Otto composed itself, keyed by the category it belongs to. */
  runtimeTextByCategory?: Partial<Record<ContextCategory, string>>;
  /**
   * Restrict the assembly to these categories, in the same reading order.
   * Omitted means every category — reading one section must not cost a re-read
   * of every context file on disk.
   */
  categories?: readonly ContextCategory[];
  /** Injected for tests; defaults to reading the real file. */
  readFile?: (absolutePath: string) => Promise<string>;
}

export interface ContextPromptPreview {
  sections: ContextPromptSection[];
  /** Sum over sections that carry text. Unmeasurable ones contribute nothing. */
  estTokens: number;
}

export async function buildPromptPreview(
  input: BuildPromptPreviewInput,
): Promise<ContextPromptPreview> {
  const { report } = input;
  const readFile = input.readFile ?? ((path: string) => fs.readFile(path, "utf8"));
  const visibilityByCategory = new Map(
    report.categoryTotals.map((total) => [total.category, total.visibility]),
  );

  const wanted = input.categories ? new Set(input.categories) : null;

  const sections: ContextPromptSection[] = [];
  for (const category of SECTION_ORDER) {
    if (wanted && !wanted.has(category)) continue;
    const visibility = visibilityByCategory.get(category);

    // The disclosure case: a category the report explicitly flagged as
    // unmeasurable here. It is a section with no body, never an omission.
    if (visibility === "not_visible") {
      sections.push({ category, label: category, visibility, estTokens: 0 });
      continue;
    }

    const runtimeText = input.runtimeTextByCategory?.[category];
    if (runtimeText) {
      sections.push({
        category,
        label: category,
        visibility: visibility ?? "exact",
        text: runtimeText,
        estTokens: estimateTokens(runtimeText.length),
      });
      continue;
    }

    for (const node of fixedNodesIn(report, category)) {
      const raw = await readText(readFile, node.path);
      // A file the scan resolved but that has since gone is not worth failing
      // the whole preview over; the graph's `dead_import` findings are where
      // missing files get reported.
      if (raw == null) continue;
      // A roster entry reaches the model as its frontmatter — showing the body
      // here would display text that is not in the request, which is exactly the
      // misconception this view exists to clear up.
      const text = category === "skills_roster" ? extractFrontmatter(raw) : raw;
      if (text == null) continue;
      sections.push({
        category,
        label: node.relPath,
        visibility: visibility ?? report.confidence,
        text,
        estTokens: estimateTokens(text.length),
      });
    }
  }

  return {
    sections,
    estTokens: sections.reduce((sum, section) => sum + section.estTokens, 0),
  };
}

/**
 * Only fixed weight, in report order. The scan already emitted nodes in load
 * order, so preserving that order is the whole job here.
 */
function fixedNodesIn(report: ContextReport, category: ContextCategory): ContextNode[] {
  return report.nodes.filter((node) => node.category === category && node.costClass === "fixed");
}

async function readText(
  readFile: (absolutePath: string) => Promise<string>,
  absolutePath: string,
): Promise<string | null> {
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}
