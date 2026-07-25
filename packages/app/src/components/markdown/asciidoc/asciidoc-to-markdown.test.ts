import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asciiDocToMarkdown } from "./asciidoc-to-markdown";

const convert = (source: string) => asciiDocToMarkdown(source).body;

describe("document header", () => {
  it("promotes the level-0 title to an h1 and lifts attributes into frontmatter", () => {
    const result = asciiDocToMarkdown(
      "= Otto Architecture\n:description: The record.\n\nBody text.",
    );
    expect(result.body).toBe("# Otto Architecture\n\nBody text.");
    expect(result.frontmatter).toBe("description: The record.");
  });

  it("has no frontmatter when the document has no header attributes", () => {
    expect(asciiDocToMarkdown("= Title\n\nBody.").frontmatter).toBeNull();
  });

  it("does not eat leading content when there is no title", () => {
    expect(convert("Just a paragraph.\n")).toBe("Just a paragraph.");
  });

  it("resolves attribute references and leaves unknown ones visible", () => {
    const result = convert("= T\n:product: Otto\n\n{product} ships {missing}.");
    expect(result).toContain("Otto ships {missing}.");
  });
});

describe("sections", () => {
  it("maps section levels to heading levels", () => {
    expect(convert("== One\n\n=== Two\n\n====== Six")).toBe("## One\n\n### Two\n\n###### Six");
  });

  it("does not mistake an example delimiter for a heading", () => {
    expect(convert("====\nInside.\n====")).toBe("> Inside.");
  });
});

describe("delimited blocks", () => {
  it("renders a [mermaid] block as a mermaid fence", () => {
    const result = convert("[mermaid]\n----\ngraph TD\n  A --> B\n----");
    expect(result).toBe("```mermaid\ngraph TD\n  A --> B\n```");
  });

  it("carries the source language onto the fence", () => {
    expect(convert("[source,typescript]\n----\nconst a = 1;\n----")).toBe(
      "```typescript\nconst a = 1;\n```",
    );
  });

  it("renders an untagged listing block as a plain fence", () => {
    expect(convert("----\nplain text\n----")).toBe("```\nplain text\n```");
  });

  it("opens a fence long enough to survive backticks in the content", () => {
    const result = convert("----\nuse ``` for fences\n----");
    expect(result).toBe("````\nuse ``` for fences\n````");
  });

  it("drops comment blocks entirely", () => {
    expect(convert("////\nhidden\n////\n\nVisible.")).toBe("Visible.");
  });

  it("keeps callouts in the fence and renders the callout list", () => {
    const result = convert("[source,ts]\n----\nconst a = 1; // <1>\n----\n<1> Declares a.");
    expect(result).toContain("const a = 1; // <1>");
    expect(result).toContain("1. Declares a.");
  });

  it("shows a passthrough block as html source rather than rendering it", () => {
    expect(convert("++++\n<b>raw</b>\n++++")).toBe("```html\n<b>raw</b>\n```");
  });
});

describe("admonitions", () => {
  it("converts the single-paragraph form", () => {
    expect(convert("NOTE: Watch out.")).toBe("> **Note:** Watch out.");
  });

  it("converts the block form with its inner content", () => {
    const result = convert("[NOTE]\n====\n*Bold* point.\n\nSecond paragraph.\n====");
    expect(result).toBe("> **Note**\n>\n> **Bold** point.\n>\n> Second paragraph.");
  });

  it("leaves an unrelated all-caps prefix alone", () => {
    expect(convert("TODO: not an admonition.")).toBe("TODO: not an admonition.");
  });

  it("prefixes every physical line of a wrapped paragraph", () => {
    const result = convert("****\nA sidebar whose paragraph\nwraps onto a second line.\n****");
    expect(result).toBe("> A sidebar whose paragraph\n> wraps onto a second line.");
  });
});

describe("lists", () => {
  it("nests unordered items by marker depth", () => {
    expect(convert("* One\n** Two\n*** Three")).toBe("- One\n  - Two\n    - Three");
  });

  it("nests ordered items by marker depth", () => {
    expect(convert(". First\n.. Second")).toBe("1. First\n  1. Second");
  });

  it("renders a description list as bolded terms", () => {
    expect(convert("Term:: The definition.")).toBe("- **Term** — The definition.");
  });
});

describe("tables", () => {
  it("converts a header table using the cols attribute", () => {
    const source = ['[cols="1,2"]', "|===", "|Name |Meaning", "", "|a", "|first", "|==="].join(
      "\n",
    );
    expect(convert(source)).toBe(
      ["| Name | Meaning |", "| --- | --- |", "| a | first |"].join("\n"),
    );
  });

  it("infers the column count from the first row when cols is absent", () => {
    const source = ["|===", "|A |B", "", "|1 |2", "|==="].join("\n");
    expect(convert(source)).toBe(["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n"));
  });

  it("escapes pipes that appear inside cell text", () => {
    const source = ["|===", "|Head", "", "|a `x \\| y` b", "|==="].join("\n");
    expect(convert(source)).toContain("\\|");
  });

  it("uses the first line's width for a table with no header", () => {
    const source = ["|===", "|a |b", "|c |d", "|==="].join("\n");
    expect(convert(source)).toBe(["|  |  |", "| --- | --- |", "| a | b |", "| c | d |"].join("\n"));
  });

  it("joins multi-line cell content into one cell", () => {
    const source = ["|===", "|Head", "", "|first line", "continued here", "|==="].join("\n");
    expect(convert(source)).toContain("| first line continued here |");
  });
});

describe("inline formatting", () => {
  it("converts constrained bold to markdown bold", () => {
    expect(convert("A *bold* word.")).toBe("A **bold** word.");
  });

  it("leaves unconstrained bold as-is", () => {
    expect(convert("A **bold** word.")).toBe("A **bold** word.");
  });

  it("converts double-underscore italic without touching single underscores", () => {
    expect(convert("__yes__ and snake_case_name")).toBe("*yes* and snake_case_name");
  });

  it("does not reformat inside code spans", () => {
    expect(convert("Use `a * b * c` here.")).toBe("Use `a * b * c` here.");
  });

  it("unwraps the literal monospace form", () => {
    expect(convert("Set `+{name}+` now.")).toBe("Set `{name}` now.");
  });

  it("converts link and bare-url macros", () => {
    expect(convert("See link:https://x.dev[the site].")).toBe("See [the site](https://x.dev).");
    expect(convert("See https://x.dev[the site].")).toBe("See [the site](https://x.dev).");
  });

  it("converts inline and block images", () => {
    expect(convert("image::diagram.png[A diagram]")).toBe("![A diagram](diagram.png)");
    expect(convert("Icon image:i.svg[] here.")).toBe("Icon ![](i.svg) here.");
  });

  it("prefixes an image target with imagesdir, as Asciidoctor does", () => {
    expect(convert("= T\n:imagesdir: assets/img\n\nimage::diagram.png[A diagram]")).toBe(
      "# T\n\n![A diagram](assets/img/diagram.png)",
    );
    expect(convert("= T\n:imagesdir: assets/\n\nIcon image:i.svg[] here.")).toBe(
      "# T\n\nIcon ![](assets/i.svg) here.",
    );
  });

  it("leaves a URL or a root-relative image target untouched by imagesdir", () => {
    expect(convert("= T\n:imagesdir: assets\n\nimage::https://x.dev/a.png[]")).toBe(
      "# T\n\n![](https://x.dev/a.png)",
    );
    expect(convert("= T\n:imagesdir: assets\n\nimage::/logo.png[]")).toBe("# T\n\n![](/logo.png)");
  });

  it("reduces cross references to their text", () => {
    expect(convert("See <<intro,the intro>> and xref:api.adoc[the API].")).toBe(
      "See the intro and the API.",
    );
  });

  it("renders a hard line break as two trailing spaces", () => {
    expect(convert("first +\nsecond")).toBe("first  \nsecond");
  });
});

describe("degradation", () => {
  it("surfaces an unresolved include rather than dropping it", () => {
    expect(convert("include::shared/setup.adoc[]")).toBe(
      "> **Include** `shared/setup.adoc` — not resolved in preview.",
    );
  });

  it("drops conditional directives but keeps their content", () => {
    expect(convert("ifdef::draft[]\nDraft note.\nendif::[]")).toBe("Draft note.");
  });
});

// The 18 architecture pages are the fidelity corpus: real documents with
// tables, admonition blocks, nested lists and embedded diagrams. A construct
// this converter mishandles shows up here before it shows up in the viewer.
describe("archdocs corpus", () => {
  const pagesDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../../archdocs/pages",
  );
  const pages = readdirSync(pagesDir).filter((name) => name.endsWith(".adoc"));

  it("finds the corpus", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)("converts %s without leaving AsciiDoc markup behind", (page) => {
    const source = readFileSync(join(pagesDir, page), "utf8");
    const { body } = asciiDocToMarkdown(source);

    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain("|===");
    expect(body).not.toMatch(/^\[(source|mermaid|NOTE|TIP|WARNING|cols)/m);
    expect(body).not.toMatch(/^include::/m);

    // Every diagram in the source must reach the markdown pipeline as a fence,
    // which is what routes it to MermaidBlock.
    const diagrams = source.match(/^\[mermaid\]$/gm)?.length ?? 0;
    const fences = body.match(/^```mermaid$/gm)?.length ?? 0;
    expect(fences).toBe(diagrams);
  });
});

// The hand-authored fixture is deliberately construct-dense — it carries
// constructs the architecture pages happen not to use (callout lists, literal
// blocks, description lists, sidebars, an unresolved include). Keeping it under
// test means the file people open to eyeball the viewer is also the file that
// fails the build when a construct regresses.
describe("test-documents fixture", () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../../test-documents/asciidoc.adoc",
  );

  it("converts every construct it demonstrates", () => {
    const { frontmatter, body } = asciiDocToMarkdown(readFileSync(fixture, "utf8"));

    expect(frontmatter).toContain("description:");
    expect(body).toMatch(/^# AsciiDoc Preview Test$/m);

    // Both diagrams reach the markdown pipeline.
    expect(body.match(/^```mermaid$/gm)).toHaveLength(2);

    // A representative construct from each family survived.
    expect(body).toContain("```typescript");
    expect(body).toContain("> **Note:**");
    expect(body).toContain("> **Tip**");
    expect(body).toContain("| Construct | Rendered as |");
    expect(body).toContain("    - Third level");
    expect(body).toContain("- **Preview mode**");
    expect(body).toContain("not resolved in preview");
    expect(body).toContain("[the AsciiDoc site](https://asciidoc.org)");
    expect(body).toContain("`literal {monospace}`");

    // Both image macros reach the markdown image path, targets intact — that is
    // what the renderer then resolves against the document's own directory.
    expect(body).toContain("![Orbit via the block macro](logo.svg)");
    expect(body).toContain("![Orbit inline](logo.svg)");
    expect(body).toContain("![Refused: escaping path](../../../../etc/passwd.png)");

    // And nothing raw leaked through.
    expect(body).not.toContain("|===");
    expect(body).not.toMatch(/^\[(source|mermaid|NOTE|TIP|quote|#)/m);
  });
});
