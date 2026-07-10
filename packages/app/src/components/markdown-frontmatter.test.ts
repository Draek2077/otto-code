import { describe, expect, it } from "vitest";
import { splitMarkdownFrontmatter } from "./markdown-frontmatter";

describe("splitMarkdownFrontmatter", () => {
  it("splits leading YAML frontmatter off the body", () => {
    const result = splitMarkdownFrontmatter(
      "---\nname: release-stable\ndescription: Cut a release\n---\n\n# Release stable\n",
    );
    expect(result.frontmatter).toBe("name: release-stable\ndescription: Cut a release");
    expect(result.body).toBe("\n# Release stable\n");
  });

  it("handles CRLF line endings", () => {
    const result = splitMarkdownFrontmatter("---\r\nname: x\r\n---\r\nBody\r\n");
    expect(result.frontmatter).toBe("name: x");
    expect(result.body).toBe("Body\r\n");
  });

  it("handles a closing delimiter at end of file", () => {
    const result = splitMarkdownFrontmatter("---\nname: x\n---");
    expect(result.frontmatter).toBe("name: x");
    expect(result.body).toBe("");
  });

  it("returns the whole document when there is no frontmatter", () => {
    const text = "# Title\n\n---\n\nSection after a rule.\n";
    expect(splitMarkdownFrontmatter(text)).toEqual({ frontmatter: null, body: text });
  });

  it("returns the whole document when the frontmatter never closes", () => {
    const text = "---\nname: x\nno closing delimiter\n";
    expect(splitMarkdownFrontmatter(text)).toEqual({ frontmatter: null, body: text });
  });

  it("does not treat a delimiter mid-document as frontmatter", () => {
    const text = "Intro paragraph.\n---\nname: x\n---\n";
    expect(splitMarkdownFrontmatter(text)).toEqual({ frontmatter: null, body: text });
  });

  it("strips empty frontmatter", () => {
    const result = splitMarkdownFrontmatter("---\n---\nBody\n");
    expect(result.frontmatter).toBe("");
    expect(result.body).toBe("Body\n");
  });
});
