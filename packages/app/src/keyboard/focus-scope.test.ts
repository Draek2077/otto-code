import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKeyboardFocusScope } from "./focus-scope";

class FakeNode {
  parentElement: FakeElement | null = null;
}

class FakeElement extends FakeNode {
  tagName: string;
  isContentEditable = false;
  private selectors: Set<string>;

  constructor(input?: { tagName?: string; selectors?: string[]; isContentEditable?: boolean }) {
    super();
    this.tagName = (input?.tagName ?? "div").toUpperCase();
    this.selectors = new Set(input?.selectors ?? []);
    if (input?.isContentEditable) {
      this.isContentEditable = true;
    }
  }

  closest(selector: string): FakeElement | null {
    if (this.selectors.has(selector)) {
      return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }
}

describe("resolveKeyboardFocusScope", () => {
  const globalRef = globalThis as {
    Element?: unknown;
    Node?: unknown;
    document?: { activeElement?: unknown };
  };
  const originalElement = globalRef.Element;
  const originalNode = globalRef.Node;
  const originalDocument = globalRef.document;

  beforeEach(() => {
    globalRef.Element = FakeElement;
    globalRef.Node = FakeNode;
    globalRef.document = { activeElement: null };
  });

  afterEach(() => {
    globalRef.Element = originalElement;
    globalRef.Node = originalNode;
    globalRef.document = originalDocument;
  });

  it("resolves terminal scope from the direct keyboard event target", () => {
    const target = new FakeElement({ selectors: [".xterm"] });
    const scope = resolveKeyboardFocusScope({
      target: target as unknown as EventTarget,
      commandCenterOpen: false,
    });
    expect(scope).toBe("terminal");
  });

  it("falls back to activeElement when target is not an Element", () => {
    const activeElement = new FakeElement({ selectors: [".xterm"] });
    globalRef.document = { activeElement };
    const scope = resolveKeyboardFocusScope({
      target: null,
      commandCenterOpen: false,
    });
    expect(scope).toBe("terminal");
  });

  // CM6's content node is contenteditable, so the file editor would otherwise
  // read as a plain text field and lose the combos its own keymap binds.
  it("resolves code-editor scope ahead of the generic editable test", () => {
    const content = new FakeElement({ isContentEditable: true });
    const surface = new FakeElement({ selectors: ["[data-testid='code-editor-surface']"] });
    content.parentElement = surface;
    const scope = resolveKeyboardFocusScope({
      target: content as unknown as EventTarget,
      commandCenterOpen: false,
    });
    expect(scope).toBe("code-editor");
  });

  // The markdown surface carries BOTH testids, so the order of the two checks is
  // the whole behaviour: matching the narrower one first is what makes Mod+K a
  // link in a .md file and the command center in a .ts one.
  it("resolves markdown-editor ahead of code-editor on a surface carrying both", () => {
    const content = new FakeElement({ isContentEditable: true });
    const surface = new FakeElement({
      selectors: ["[data-markdown-editor]", "[data-testid='code-editor-surface']"],
    });
    content.parentElement = surface;
    const scope = resolveKeyboardFocusScope({
      target: content as unknown as EventTarget,
      commandCenterOpen: false,
    });
    expect(scope).toBe("markdown-editor");
  });

  it("still yields to the command center when it is open over a markdown file", () => {
    const surface = new FakeElement({
      selectors: ["[data-markdown-editor]"],
    });
    const scope = resolveKeyboardFocusScope({
      target: surface as unknown as EventTarget,
      commandCenterOpen: true,
    });
    expect(scope).toBe("command-center");
  });

  it("detects editable scope from activeElement fallback", () => {
    const activeElement = new FakeElement({ tagName: "input" });
    globalRef.document = { activeElement };
    const scope = resolveKeyboardFocusScope({
      target: null,
      commandCenterOpen: false,
    });
    expect(scope).toBe("editable");
  });
});
