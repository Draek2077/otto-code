import type { SettingsState } from "@getpaseo/plugin/client";
import type { providerSettings } from "../shared/settings.js";
export type ReadySettings = Extract<
  SettingsState<typeof providerSettings.schema>,
  { status: "ready" }
>;
