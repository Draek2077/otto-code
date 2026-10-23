import type { App } from "./app.js";

type KeyAction = (app: App) => void;
const previous: KeyAction = (app) => app.adjust(-1);
const next: KeyAction = (app) => app.adjust(1);
const panel: KeyAction = (app) => {
  app.focus = app.focus === "models" ? "config" : "models";
};
const activate: KeyAction = (app) => {
  if (app.focus === "config") app.activateField();
  else app.focus = "config";
};
const actions: Record<string, KeyAction> = {
  q: (app) => app.shutdown(),
  tab: panel,
  shifttab: panel,
  up: (app) => app.move(-1),
  down: (app) => app.move(1),
  pageup: (app) => app.move(-8),
  pagedown: (app) => app.move(8),
  left: previous,
  "-": previous,
  _: previous,
  right: next,
  "+": next,
  "=": next,
  enter: activate,
  space: activate,
  "/": (app) => {
    app.filterMode = true;
  },
  s: (app) => app.startModel(),
  x: (app) => app.stopModel(),
  c: (app) => app.runCalibration(),
  w: (app) => app.runSweep(),
  m: (app) => app.applyMaxContext(),
  g: (app) => {
    void app.beginDownload();
  },
  f: (app) => app.beginSearch(),
  D: (app) => app.beginDelete(),
  R: (app) => {
    if (app.focus === "models") app.beginRename();
  },
  u: (app) => {
    if (app.focus === "models") app.beginResetName();
  },
  r: (app) => app.reloadOrDiscard(),
  b: (app) => app.enterBench(),
  l: (app) => {
    app.viewMode = app.viewMode === "logs" ? "standard" : "logs";
  },
  "?": (app) => {
    app.viewMode = app.viewMode === "help" ? "standard" : "help";
  },
};

export function standardKey(app: App, key: string): void {
  const action = actions[key];
  if (!action) return;
  action(app);
  app.draw();
}
