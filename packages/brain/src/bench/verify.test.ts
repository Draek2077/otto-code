import { test } from "vitest";
import assert from "node:assert/strict";

import {
  findExpectedName,
  unescapeMarkdown,
  extractCodeBlocks,
  findPlaceholders,
} from "./verify.js";

const EXPECTED = ["lru.py", "metrics.py", "test_lru.py"];

test("a longer expected name wins over a name it contains", () => {
  // Regression: "test_lru.py" contains "lru.py". A naive substring scan
  // attributed every test block to lru.py and overwrote the implementation,
  // which scored every model identically and wrongly.
  assert.equal(findExpectedName("### 3. test_lru.py", EXPECTED), "test_lru.py");
  assert.equal(findExpectedName("here is test_lru.py now", EXPECTED), "test_lru.py");
  assert.equal(findExpectedName("**test_lru.py**", EXPECTED), "test_lru.py");
});

test("a plain name still matches itself", () => {
  assert.equal(findExpectedName("## lru.py", EXPECTED), "lru.py");
  assert.equal(findExpectedName("file: metrics.py", EXPECTED), "metrics.py");
});

test("a name embedded in a longer identifier does not match", () => {
  assert.equal(findExpectedName("mylru.py", ["lru.py"]), null);
  assert.equal(findExpectedName("helper_metrics.pyc", ["metrics.py"]), null);
});

test("no expected name present yields null", () => {
  assert.equal(findExpectedName("some prose with no filenames", EXPECTED), null);
  assert.equal(findExpectedName("", EXPECTED), null);
});

test("markdown escapes are undone before matching", () => {
  assert.equal(unescapeMarkdown("test\\_lru.py"), "test_lru.py");
  assert.equal(unescapeMarkdown("**bold**"), "**bold**", "only escapes are removed");
  assert.equal(findExpectedName(unescapeMarkdown("`test\\_lru.py`"), EXPECTED), "test_lru.py");
});

test("code blocks are attributed to the right files", () => {
  const response = [
    "Here you go.",
    "",
    "**lru.py**",
    "```python",
    "class LRUCache:",
    "    pass",
    "```",
    "",
    "**metrics.py**",
    "```python",
    "class Metrics:",
    "    pass",
    "```",
    "",
    "**test\\_lru.py**",
    "```python",
    "import unittest",
    "class T(unittest.TestCase):",
    "    def test_x(self): pass",
    "```",
  ].join("\n");

  const blocks = extractCodeBlocks(response, EXPECTED);

  assert.equal(blocks.length, 3);
  assert.deepEqual(
    blocks.map((b) => b.filename),
    ["lru.py", "metrics.py", "test_lru.py"],
  );
  assert.equal(new Set(blocks.map((b) => b.filename)).size, 3, "no two blocks share a name");
});

test("an unlabelled test block is identified from its content", () => {
  const response = "```python\nimport unittest\nclass T(unittest.TestCase):\n    pass\n```";
  const [block] = extractCodeBlocks(response, EXPECTED);
  assert.equal(block.filename, "test_lru.py");
});

test("an unlabelled implementation block is matched by its class name", () => {
  const response = "```python\nclass Metrics:\n    def snapshot(self): return {}\n```";
  const [block] = extractCodeBlocks(response, EXPECTED);
  assert.equal(block.filename, "metrics.py");
});

test("prose blocks are not treated as code", () => {
  const response = "```markdown\n# README\nSome docs.\n```";
  const [block] = extractCodeBlocks(response, EXPECTED);
  assert.equal(block.isCode, false);
});

test("placeholder elisions are detected", () => {
  assert.ok(findPlaceholders("# TODO: implement here") > 0);
  assert.ok(findPlaceholders("... rest of the implementation") > 0);
  assert.ok(findPlaceholders("omitted for brevity") > 0);
  assert.equal(findPlaceholders("def f():\n    return 1"), 0);
});
