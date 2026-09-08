import { app, Menu, BrowserWindow, ipcMain, type WebContents } from "electron";
import { getActiveOttoBrowserWebContentsForHostWindow } from "./browser-webviews/index.js";

interface ShowContextMenuInput {
  kind?: "terminal";
  hasSelection?: boolean;
}

const SPELLCHECK_CONTEXT_TTL_MS = 30_000;

export interface SpellcheckContextSnapshot {
  token: string;
  x: number;
  y: number;
  suggestions: string[];
  canAddToDictionary: boolean;
}

interface StoredSpellcheckContext extends SpellcheckContextSnapshot {
  misspelledWord: string;
  expiresAt: number;
}

type SpellcheckMenuAction =
  | { token: string; kind: "replace"; suggestion: string }
  | { token: string; kind: "add-to-dictionary" };

function readSpellcheckMenuAction(input: unknown): SpellcheckMenuAction | null {
  if (typeof input !== "object" || input === null) return null;
  const token = Reflect.get(input, "token");
  const kind = Reflect.get(input, "kind");
  if (typeof token !== "string") return null;
  if (kind === "add-to-dictionary") return { token, kind };
  const suggestion = Reflect.get(input, "suggestion");
  return kind === "replace" && typeof suggestion === "string" ? { token, kind, suggestion } : null;
}

/**
 * Retains only the native spellchecker operation created by the latest right
 * click in each window. The renderer sees suggestions, never the misspelled
 * word, and can only apply one of the suggestions that Electron produced.
 */
export class SpellcheckContextRegistry {
  private readonly contexts = new Map<number, StoredSpellcheckContext>();
  private nextToken = 0;

  capture(
    contents: WebContents,
    params: Electron.ContextMenuParams,
  ): SpellcheckContextSnapshot | null {
    if (!params.isEditable || !params.spellcheckEnabled || !params.misspelledWord) {
      this.contexts.delete(contents.id);
      return null;
    }

    const context: StoredSpellcheckContext = {
      token: `spellcheck-${++this.nextToken}`,
      x: params.x,
      y: params.y,
      suggestions: [...params.dictionarySuggestions],
      canAddToDictionary: true,
      misspelledWord: params.misspelledWord,
      expiresAt: Date.now() + SPELLCHECK_CONTEXT_TTL_MS,
    };
    this.contexts.set(contents.id, context);
    const { misspelledWord: _misspelledWord, expiresAt: _expiresAt, ...snapshot } = context;
    return snapshot;
  }

  apply(contents: WebContents, rawAction: unknown): boolean {
    const action = readSpellcheckMenuAction(rawAction);
    const context = this.contexts.get(contents.id);
    if (!action || !context || context.expiresAt < Date.now() || context.token !== action.token) {
      return false;
    }
    if (action.kind === "replace" && !context.suggestions.includes(action.suggestion)) {
      return false;
    }

    // A context-menu command is single use, matching Electron's own native
    // menu. Clearing before the edit also prevents a stale React menu from
    // changing a newer word after another right click.
    this.contexts.delete(contents.id);
    if (action.kind === "add-to-dictionary") {
      return contents.session.addWordToSpellCheckerDictionary(context.misspelledWord);
    }
    contents.replaceMisspelling(action.suggestion);
    return true;
  }

  clear(contentsId: number): void {
    this.contexts.delete(contentsId);
  }
}

interface ApplicationMenuOptions {
  onNewWindow: () => void;
}

function withBrowserWindow(
  callback: (win: BrowserWindow) => void,
): (_item: Electron.MenuItem, baseWin: Electron.BaseWindow | undefined) => void {
  return (_item, baseWin) => {
    const win = baseWin instanceof BrowserWindow ? baseWin : BrowserWindow.getFocusedWindow();
    if (win) callback(win);
  };
}

interface ReloadableWebContents {
  isLoadingMainFrame(): boolean;
  stop(): void;
  reload(): void;
  reloadIgnoringCache(): void;
}

interface ReloadableWindow {
  webContents: ReloadableWebContents & { id: number };
}

interface ReloadActiveBrowserOrWindowInput {
  win: ReloadableWindow;
  getActiveBrowserContentsForHostWindow: (
    hostWebContentsId: number,
  ) => ReloadableWebContents | null;
  ignoreCache?: boolean;
}

export function reloadActiveBrowserOrWindow({
  win,
  getActiveBrowserContentsForHostWindow,
  ignoreCache = false,
}: ReloadActiveBrowserOrWindowInput): void {
  const browserContents = getActiveBrowserContentsForHostWindow(win.webContents.id);
  if (browserContents) {
    if (ignoreCache) {
      browserContents.reloadIgnoringCache();
      return;
    }
    if (browserContents.isLoadingMainFrame()) {
      browserContents.stop();
      return;
    }
    browserContents.reload();
    return;
  }

  if (ignoreCache) {
    win.webContents.reloadIgnoringCache();
    return;
  }
  win.webContents.reload();
}

function buildApplicationMenuTemplate(
  options: ApplicationMenuOptions,
  capturing: boolean,
): Electron.MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  const zoomEnabled = !capturing;

  return [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            options.onNewWindow();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          enabled: zoomEnabled,
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
          }),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          enabled: zoomEnabled,
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
          }),
        },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          enabled: zoomEnabled,
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(0);
          }),
        },
        { type: "separator" },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: withBrowserWindow((win) => {
            reloadActiveBrowserOrWindow({
              win,
              getActiveBrowserContentsForHostWindow: getActiveOttoBrowserWebContentsForHostWindow,
            });
          }),
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: withBrowserWindow((win) => {
            reloadActiveBrowserOrWindow({
              win,
              getActiveBrowserContentsForHostWindow: getActiveOttoBrowserWebContentsForHostWindow,
              ignoreCache: true,
            });
          }),
        },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
  ];
}

let applicationMenuOptions: ApplicationMenuOptions | null = null;
let capturingShortcut = false;

function rebuildApplicationMenu(): void {
  if (!applicationMenuOptions) return;
  const menu = Menu.buildFromTemplate(
    buildApplicationMenuTemplate(applicationMenuOptions, capturingShortcut),
  );
  Menu.setApplicationMenu(menu);
}

export function setupApplicationMenu(options: ApplicationMenuOptions): void {
  applicationMenuOptions = options;
  rebuildApplicationMenu();

  ipcMain.handle("otto:menu:showContextMenu", (event, input?: ShowContextMenuInput) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }

    if (input?.kind !== "terminal") {
      return;
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Copy",
        role: "copy",
        enabled: input.hasSelection === true,
      },
      {
        label: "Paste",
        role: "paste",
      },
      {
        type: "separator",
      },
      {
        label: "Select All",
        role: "selectAll",
      },
    ]);

    contextMenu.popup({ window: win });
  });

  // Disable the zoom accelerators while capturing a shortcut so combos like
  // Cmd+- / Cmd+= reach the renderer instead of zooming the window.
  ipcMain.handle("otto:menu:set-capturing-shortcut", (_event, capturing?: boolean) => {
    capturingShortcut = capturing === true;
    rebuildApplicationMenu();
  });

  // If the renderer reloads mid-capture (e.g. Cmd+R) the renderer-side effect
  // never gets to send `false`, so reset the flag from the main process when a
  // main window finishes loading. Workspace browser webviews are not
  // BrowserWindows, so they don't trigger this.
  app.on("browser-window-created", (_event, win) => {
    win.webContents.on("did-finish-load", () => {
      if (!capturingShortcut) return;
      capturingShortcut = false;
      rebuildApplicationMenu();
    });
  });
}
