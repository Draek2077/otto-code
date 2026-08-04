// Corpus self-test: every template in test-documents/projects is well-formed and
// materializes into the repo shape the playbooks and the E2E suites expect.
//
// Deliberately does NOT run the templates' builds. A full build sweep compiles C#,
// Java, Python and TypeScript and takes minutes, which is the wrong shape for a test
// that should run on every change. Build verification is `--verify` on the playbook
// runner, and the manifest rule that `main` builds green is enforced there.
//
// What this catches is the authoring mistake that actually happens: declaring a break
// variant and forgetting its overlay, or an overlay that no longer matches any file in
// the tree - which would silently produce a break branch identical to main, i.e. an
// error scenario that has quietly stopped being one.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  listTemplates,
  materializeTemplate,
  readTemplate,
  TEMPLATE_ROOT,
} from "./playbook-projects.mjs";

function filesUnder(root) {
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(next, rel);
      } else {
        found.push(rel);
      }
    }
  };
  walk(root, "");
  return found;
}

// Content, not file size: an overlay that swaps one operator for another of the same
// length is exactly the kind of break a size comparison would call identical.
function overlayChangesSomething(greenDir, overlayDir) {
  return filesUnder(overlayDir).some((rel) => {
    const green = readFileSync(path.join(greenDir, rel));
    const broken = readFileSync(path.join(overlayDir, rel));
    return !green.equals(broken);
  });
}

const templates = listTemplates();

test("the corpus is not empty", () => {
  expect(templates.length).toBeGreaterThan(0);
});

describe.each(templates)("%s", (name) => {
  const template = readTemplate(name);

  test("declares a toolchain and at least one check", () => {
    expect(template.tool).toBeTruthy();
    expect(template.build ?? template.test).toBeTruthy();
  });

  test("commands are argv arrays, not shell strings", () => {
    for (const argv of [template.build, template.test].filter(Boolean)) {
      expect(Array.isArray(argv)).toBe(true);
      expect(argv.length).toBeGreaterThan(0);
      for (const part of argv) {
        expect(typeof part).toBe("string");
      }
    }
  });

  test("ships a README so the tree reads as a real project", () => {
    expect(existsSync(path.join(template.treeDir, "README.md"))).toBe(true);
  });

  test("declares at least one break variant", () => {
    // A green-only fixture exercises half of Otto. Diagnostics, a red preview and an
    // agent asked to fix something all need a real failure to react to.
    expect(template.breaks.length).toBeGreaterThan(0);
  });

  describe.each(template.breaks)("break/$slug", (variant) => {
    const overlayTree = path.join(template.dir, "breaks", variant.slug, "tree");

    test("has an overlay tree", () => {
      expect(existsSync(overlayTree)).toBe(true);
      expect(statSync(overlayTree).isDirectory()).toBe(true);
    });

    test("every overlay file replaces one that exists in the green tree", () => {
      // An overlay is a partial replacement. A path that matches nothing in tree/ is
      // a typo that would add a stray file instead of breaking anything.
      for (const rel of filesUnder(overlayTree)) {
        expect(
          existsSync(path.join(template.treeDir, rel)),
          `${variant.slug} overlays ${rel}, which does not exist in tree/`,
        ).toBe(true);
      }
    });

    test("actually differs from the green tree", () => {
      expect(
        overlayChangesSomething(template.treeDir, overlayTree),
        `${variant.slug} is byte-identical to tree/`,
      ).toBe(true);
    });
  });
});

// Well past vitest's 5s default: this lays down a git repo per template and makes a
// commit per break branch on top. Real process spawns, so it scales with the corpus.
test("every template materializes to a repo with main plus one branch per break", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "playbook-corpus-"));
  try {
    for (const name of templates) {
      const result = materializeTemplate({ name, targetDir: path.join(root, name) });
      expect(result.created).toBe(true);
      expect(result.branches).toContain("main");
      for (const variant of result.template.breaks) {
        expect(result.branches).toContain(`break/${variant.slug}`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}, 120_000);

test("TEMPLATE_ROOT points at the checked-in corpus", () => {
  expect(TEMPLATE_ROOT.endsWith(path.join("test-documents", "projects"))).toBe(true);
});
