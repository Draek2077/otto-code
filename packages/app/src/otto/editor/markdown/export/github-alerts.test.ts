import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { ALERT_ATTRIBUTE, applyGithubAlerts, parseAlertKind } from "./github-alerts";

const parser = applyGithubAlerts(MarkdownIt({ typographer: true, linkify: true }));

function alertKinds(source: string): (string | undefined)[] {
  return parser
    .parse(source, {})
    .filter((token) => token.type === "blockquote_open")
    .map((token) => {
      const value = token.attrGet(ALERT_ATTRIBUTE);
      return value === null ? undefined : String(value);
    });
}

/** The text a reader ends up seeing, per inline run. */
function inlineTexts(source: string): string[] {
  return parser
    .parse(source, {})
    .filter((token) => token.type === "inline")
    .map((token) => (token.children ?? []).map((child) => child.content).join(""));
}

describe("parseAlertKind", () => {
  it("accepts the five GitHub kinds, case-insensitively", () => {
    expect(parseAlertKind("[!NOTE]")).toBe("note");
    expect(parseAlertKind("[!tip]")).toBe("tip");
    expect(parseAlertKind("[!Important]")).toBe("important");
    expect(parseAlertKind("[!WARNING]")).toBe("warning");
    expect(parseAlertKind("[!CAUTION]")).toBe("caution");
  });

  it("rejects anything that is not one of them", () => {
    expect(parseAlertKind("[!DANGER]")).toBeNull();
    expect(parseAlertKind("[NOTE]")).toBeNull();
    expect(parseAlertKind("[!NOTE] with trailing prose")).toBeNull();
    expect(parseAlertKind("")).toBeNull();
  });
});

describe("github alerts", () => {
  it("tags an alert blockquote with its kind", () => {
    expect(alertKinds("> [!WARNING]\n> Mind the gap.")).toEqual(["warning"]);
  });

  it("strips the marker and the break after it from the body", () => {
    expect(inlineTexts("> [!NOTE]\n> Useful information.")).toEqual(["Useful information."]);
  });

  it("leaves an ordinary blockquote alone", () => {
    expect(alertKinds("> just a quote")).toEqual([undefined]);
    expect(inlineTexts("> just a quote")).toEqual(["just a quote"]);
  });

  // The reason this runs on tokens rather than on the source text.
  it("does not touch a marker inside a fenced code block", () => {
    const source = ["```md", "> [!NOTE]", "> body", "```"].join("\n");
    expect(alertKinds(source)).toEqual([]);
    expect(parser.parse(source, {}).some((token) => token.type === "fence")).toBe(true);
  });

  it("does not treat a mid-sentence marker as an alert", () => {
    expect(alertKinds("> see [!NOTE] below")).toEqual([undefined]);
  });

  it("handles several alerts in one document", () => {
    const source = ["> [!TIP]", "> one", "", "> [!CAUTION]", "> two"].join("\n");
    expect(alertKinds(source)).toEqual(["tip", "caution"]);
    expect(inlineTexts(source)).toEqual(["one", "two"]);
  });

  it("survives an alert with no body", () => {
    expect(alertKinds("> [!NOTE]")).toEqual(["note"]);
    expect(inlineTexts("> [!NOTE]")).toEqual([""]);
  });

  it("keeps multi-paragraph alert bodies intact", () => {
    const source = ["> [!IMPORTANT]", "> first", ">", "> second"].join("\n");
    expect(alertKinds(source)).toEqual(["important"]);
    expect(inlineTexts(source)).toEqual(["first", "second"]);
  });
});
