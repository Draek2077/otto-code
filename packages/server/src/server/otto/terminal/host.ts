import {
  readTerminalSettings,
  saveTerminalSettings,
  diagnoseTerminal,
  TerminalSettingsSchema,
} from "@getpaseo/plugin/otto/terminal";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import { TerminalSettingsStore } from "./settings.js";
import { terminalShellChoices } from "./launch.js";
import { diagnose } from "./diagnostic.js";

export class TerminalHost {
  readonly store: TerminalSettingsStore;
  private diagnostic: ReturnType<typeof diagnose> | null = null;
  constructor(
    home: string,
    private readonly hostId: () => string,
    private readonly manager: () => TerminalManager,
  ) {
    this.store = new TerminalSettingsStore(home);
  }
  async read() {
    return TerminalSettingsSchema.parse({
      ...this.store.read(),
      shells: await terminalShellChoices(),
      platform: process.platform,
    });
  }
  invoke(method: string, input: unknown): Promise<unknown> | undefined {
    if (method === readTerminalSettings.name) {
      this.assertHost(readTerminalSettings.input.parse(input).hostId);
      return this.read();
    }
    if (method === saveTerminalSettings.name) return this.save(input);
    if (method === diagnoseTerminal.name) {
      this.assertHost(diagnoseTerminal.input.parse(input).hostId);
      // One host-wide check, including across multiple requesting clients.
      if (!this.diagnostic)
        this.diagnostic = diagnose(this.manager()).finally(() => {
          this.diagnostic = null;
        });
      return this.diagnostic;
    }
    return undefined;
  }
  private assertHost(id: string) {
    if (id !== this.hostId()) throw new Error("Terminal settings belong to another host.");
  }
  private async save(input: unknown) {
    const value = saveTerminalSettings.input.parse(input);
    this.assertHost(value.hostId);
    const shell = value.patch.defaultTerminalShell;
    if (
      shell !== undefined &&
      !(await terminalShellChoices()).some((choice) => choice.id === shell && choice.available)
    )
      throw new Error(
        "The selected shell is unavailable on this host. Choose an available shell before saving.",
      );
    this.store.save(value.expectedRevision, value.patch);
    return this.read();
  }
}
