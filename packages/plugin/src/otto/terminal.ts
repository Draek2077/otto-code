import { z } from "zod";
import { defineRpc } from "../rpc.js";

export const TerminalPreferencesSchema = z.object({
  terminalTitleMode: z.enum(["auto", "default"]),
  terminalTitleIncludePaths: z.boolean(),
  defaultTerminalShell: z.enum(["system", "command-prompt", "windows-powershell", "powershell-7"]),
});
export type TerminalPreferences = z.infer<typeof TerminalPreferencesSchema>;
// Reads accept future host fields; writes stay bounded to explicitly supported preferences.
export const TerminalPreferencesPatchSchema = TerminalPreferencesSchema.partial().strict();
const Host = z.object({ hostId: z.string().min(1).max(256) });
export const TerminalSettingsSchema = z.object({
  revision: z.string(),
  preferences: TerminalPreferencesSchema,
  shells: z.array(
    z.object({
      id: TerminalPreferencesSchema.shape.defaultTerminalShell,
      label: z.string(),
      available: z.boolean(),
    }),
  ),
  platform: z.string(),
});
export type TerminalSettings = z.infer<typeof TerminalSettingsSchema>;
export const TerminalCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "fail", "warn", "unknown"]),
  detail: z.string(),
});
export type TerminalCheck = z.infer<typeof TerminalCheckSchema>;
export const TerminalDiagnosticSchema = z.object({
  checkedAt: z.string(),
  checks: z.array(TerminalCheckSchema),
});
export type TerminalDiagnostic = z.infer<typeof TerminalDiagnosticSchema>;
export const readTerminalSettings = defineRpc({
  name: "terminal.settings.read",
  input: Host,
  output: TerminalSettingsSchema,
});
export const saveTerminalSettings = defineRpc({
  name: "terminal.settings.save",
  input: Host.extend({
    expectedRevision: z.string().min(1),
    patch: TerminalPreferencesPatchSchema,
  }),
  output: TerminalSettingsSchema,
});
export const diagnoseTerminal = defineRpc({
  name: "terminal.compatibility.check",
  input: Host,
  output: TerminalDiagnosticSchema,
});
