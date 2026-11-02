import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { TerminalSettingsStore } from "./settings.js";
import { TerminalHost } from "./host.js";
import { readTerminalSettings, saveTerminalSettings } from "@getpaseo/plugin/otto/terminal";

const homes: string[] = [];
function home() {
  const directory = path.resolve("../../.tmp/terminal-fixtures");
  mkdirSync(directory, { recursive: true });
  const created = mkdtempSync(path.join(directory, "home-"));
  homes.push(created);
  return created;
}
afterEach(() => {
  for (const directory of homes.splice(0)) rmSync(directory, { recursive: true, force: true });
});
describe("host terminal preferences", () => {
  it("reads defaults without creating files or launching a PTY", async () => {
    const directory = home();
    const host = new TerminalHost(
      directory,
      () => "host",
      () => {
        throw new Error("must not launch");
      },
    );
    const result = await host.invoke(readTerminalSettings.name, { hostId: "host" });
    expect(result).toMatchObject({
      preferences: {
        terminalTitleMode: "auto",
        terminalTitleIncludePaths: false,
        defaultTerminalShell: "system",
      },
    });
    expect(existsSync(path.join(directory, "terminal"))).toBe(false);
  });
  it("inherits 0.9 settings without rewriting the preserved document", () => {
    const directory = home();
    const legacy = JSON.stringify({
      daemon: {
        terminalTitleMode: "default",
        terminalTitleIncludePaths: true,
        defaultTerminalShell: "powershell-7",
        brain: { enabled: true },
      },
      privateOtherFeature: "retained",
    });
    writeFileSync(path.join(directory, "otto-config.json"), legacy);
    const store = new TerminalSettingsStore(directory);
    const current = store.read();
    expect(current.preferences).toEqual({
      terminalTitleMode: "default",
      terminalTitleIncludePaths: true,
      defaultTerminalShell: "powershell-7",
    });
    store.save(current.revision, { terminalTitleMode: "auto" });
    expect(readFileSync(path.join(directory, "otto-config.json"), "utf8")).toBe(legacy);
    expect(new TerminalSettingsStore(directory).read().preferences).toEqual({
      ...current.preferences,
      terminalTitleMode: "auto",
    });
  });
  it("preserves unknown current settings while applying only a pinned patch", () => {
    const directory = home();
    mkdirSync(path.join(directory, "terminal"));
    const file = path.join(directory, "terminal/settings.json");
    writeFileSync(file, JSON.stringify({ terminalTitleMode: "auto", future: { keep: true } }));
    const store = new TerminalSettingsStore(directory);
    const current = store.read();
    store.save(current.revision, { terminalTitleIncludePaths: true });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      future: { keep: true },
      terminalTitleIncludePaths: true,
    });
    expect(() => store.save(current.revision, { terminalTitleMode: "default" })).toThrow("changed");
  });
  it("detects a peer update of inherited settings before the first save", () => {
    const directory = home();
    const file = path.join(directory, "otto-config.json");
    writeFileSync(file, "{}");
    const store = new TerminalSettingsStore(directory);
    const first = store.read();
    writeFileSync(file, '{"daemon":{"terminalTitleMode":"default"}}');
    expect(() => store.save(first.revision, { terminalTitleIncludePaths: true })).toThrow(
      "changed",
    );
    expect(existsSync(path.join(directory, "terminal/settings.json"))).toBe(false);
  });
  it("does not replace corrupt settings or accept invalid patches", () => {
    const directory = home();
    const store = new TerminalSettingsStore(directory);
    const initial = store.read();
    expect(() => store.save(initial.revision, { terminalTitleMode: "invalid" })).toThrow();
    mkdirSync(path.join(directory, "terminal"));
    const file = path.join(directory, "terminal/settings.json");
    writeFileSync(file, "{broken");
    expect(() => store.read()).toThrow();
    expect(readFileSync(file, "utf8")).toBe("{broken");
  });
  it("rejects another host before reading or writing settings", () => {
    const directory = home();
    const host = new TerminalHost(
      directory,
      () => "owner",
      () => {
        throw new Error("not used");
      },
    );
    expect(() => host.invoke(readTerminalSettings.name, { hostId: "peer" })).toThrow(
      "another host",
    );
  });
  it("persists a host-bound write without starting a terminal", async () => {
    const directory = home();
    const host = new TerminalHost(
      directory,
      () => "owner",
      () => {
        throw new Error("must not launch");
      },
    );
    const initial = await host.read();
    await host.invoke(saveTerminalSettings.name, {
      hostId: "owner",
      expectedRevision: initial.revision,
      patch: { terminalTitleMode: "default" },
    });
    expect((await host.read()).preferences.terminalTitleMode).toBe("default");
  });
});
