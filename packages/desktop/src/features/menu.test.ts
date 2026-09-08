import { describe, expect, it } from "vitest";
import { reloadActiveBrowserOrWindow, SpellcheckContextRegistry } from "./menu.js";

class FakeWebContents {
  public readonly reloads: string[] = [];

  public constructor(public readonly id: number) {}

  public isLoadingMainFrame(): boolean {
    return false;
  }

  public stop(): void {
    this.reloads.push("stop");
  }

  public reload(): void {
    this.reloads.push("reload");
  }

  public reloadIgnoringCache(): void {
    this.reloads.push("force-reload");
  }
}

class BrowserReloads {
  public readonly firstWindow = { webContents: new FakeWebContents(101) };
  public readonly secondWindow = { webContents: new FakeWebContents(202) };
  public readonly firstBrowser = new FakeWebContents(11);
  public readonly secondBrowser = new FakeWebContents(22);
  public readonly resolvedHostWindowIds: number[] = [];

  public activeBrowserForHostWindow(hostWebContentsId: number): FakeWebContents | null {
    this.resolvedHostWindowIds.push(hostWebContentsId);
    return hostWebContentsId === 101 ? this.firstBrowser : this.secondBrowser;
  }
}

describe("reloadActiveBrowserOrWindow", () => {
  it("reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.firstWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([101]);
    expect(browserReloads.firstBrowser.reloads).toEqual(["reload"]);
    expect(browserReloads.secondBrowser.reloads).toEqual([]);
    expect(browserReloads.firstWindow.webContents.reloads).toEqual([]);
  });

  it("force reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.secondWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
      ignoreCache: true,
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([202]);
    expect(browserReloads.firstBrowser.reloads).toEqual([]);
    expect(browserReloads.secondBrowser.reloads).toEqual(["force-reload"]);
    expect(browserReloads.secondWindow.webContents.reloads).toEqual([]);
  });
});

class FakeSpellcheckWebContents {
  public readonly addedWords: string[] = [];
  public readonly replacements: string[] = [];
  public readonly session = {
    addWordToSpellCheckerDictionary: (word: string): boolean => {
      this.addedWords.push(word);
      return true;
    },
  };

  public constructor(public readonly id: number) {}

  public replaceMisspelling(suggestion: string): void {
    this.replacements.push(suggestion);
  }
}

function spellcheckParams(
  overrides: Partial<Electron.ContextMenuParams> = {},
): Electron.ContextMenuParams {
  return {
    isEditable: true,
    spellcheckEnabled: true,
    misspelledWord: "teh",
    dictionarySuggestions: ["the", "ten"],
    x: 42,
    y: 84,
    ...overrides,
  } as Electron.ContextMenuParams;
}

describe("SpellcheckContextRegistry", () => {
  it("keeps native words private while allowing an offered replacement once", () => {
    const registry = new SpellcheckContextRegistry();
    const contents = new FakeSpellcheckWebContents(7);
    const context = registry.capture(
      contents as unknown as Electron.WebContents,
      spellcheckParams(),
    );

    expect(context).toEqual({
      token: "spellcheck-1",
      x: 42,
      y: 84,
      suggestions: ["the", "ten"],
      canAddToDictionary: true,
    });
    expect(
      registry.apply(contents as unknown as Electron.WebContents, {
        token: context?.token,
        kind: "replace",
        suggestion: "their",
      }),
    ).toBe(false);
    expect(
      registry.apply(contents as unknown as Electron.WebContents, {
        token: context?.token,
        kind: "replace",
        suggestion: "the",
      }),
    ).toBe(true);
    expect(contents.replacements).toEqual(["the"]);
    expect(
      registry.apply(contents as unknown as Electron.WebContents, {
        token: context?.token,
        kind: "replace",
        suggestion: "ten",
      }),
    ).toBe(false);
  });

  it("adds only the word held by the native context", () => {
    const registry = new SpellcheckContextRegistry();
    const contents = new FakeSpellcheckWebContents(9);
    const context = registry.capture(
      contents as unknown as Electron.WebContents,
      spellcheckParams(),
    );

    expect(
      registry.apply(contents as unknown as Electron.WebContents, {
        token: context?.token,
        kind: "add-to-dictionary",
      }),
    ).toBe(true);
    expect(contents.addedWords).toEqual(["teh"]);
  });

  it("does not create a context for controls without an active spellcheck error", () => {
    const registry = new SpellcheckContextRegistry();
    const contents = new FakeSpellcheckWebContents(12);

    expect(
      registry.capture(
        contents as unknown as Electron.WebContents,
        spellcheckParams({ misspelledWord: "" }),
      ),
    ).toBeNull();
  });
});
