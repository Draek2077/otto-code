/** Passive command settings are separate from runtime/model-operation ownership. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { BrainConfig } from "../config/schema.js";
import type { ShareOptions, ShareStatus } from "./share-contract.js";

export interface BrainConnectionCommandResult {
  connection: {
    revision: string;
    config: { enabled: boolean; autoStart: boolean; mode: "local" | "remote" };
  };
}
export type BrainConfigCommandResult = BrainConfig | BrainConnectionCommandResult;
export interface BrainSettingsCommandTarget {
  readConfig(): Promise<BrainConfig>;
  setConfig(key: string, raw: string): Promise<BrainConfigCommandResult>;
  share(options: ShareOptions): Promise<ShareStatus>;
}
const settings = new AsyncLocalStorage<BrainSettingsCommandTarget>();
export function selectedBrainSettingsTarget(): BrainSettingsCommandTarget | undefined {
  return settings.getStore();
}
export function withBrainSettingsTarget<T>(
  target: BrainSettingsCommandTarget,
  run: () => Promise<T>,
): Promise<T> {
  return settings.run(target, run);
}
