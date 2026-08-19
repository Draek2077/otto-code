import { z } from "zod";

/**
 * Otto terminal-compatibility wire schemas: the terminal.compatibility.* probe RPCs. Fork-only capability, so it owns its schemas; messages.ts re-exports them. New file rather than terminal-*.ts because those import from messages.ts.
 */

export const TerminalCompatibilityDiagnosticRequestSchema = z.object({
  type: z.literal("terminal.compatibility.diagnostic.request"),
  requestId: z.string(),
});

export const TerminalCompatibilityDiagnosticStatusSchema = z.enum([
  "pass",
  "fail",
  "warn",
  "unknown",
]);

export const TerminalCompatibilityDiagnosticCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: TerminalCompatibilityDiagnosticStatusSchema,
  detail: z.string(),
  evidence: z.string().optional(),
});

export const TerminalCompatibilityDiagnosticResponseSchema = z.object({
  type: z.literal("terminal.compatibility.diagnostic.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    error: z.string().nullable(),
    generatedAt: z.string(),
    platform: z.string().optional(),
    term: z.string().nullable().optional(),
    termProgram: z.string().nullable().optional(),
    checks: z.array(TerminalCompatibilityDiagnosticCheckSchema),
  }),
});

export type TerminalCompatibilityDiagnosticStatus = z.infer<
  typeof TerminalCompatibilityDiagnosticStatusSchema
>;
export type TerminalCompatibilityDiagnosticCheck = z.infer<
  typeof TerminalCompatibilityDiagnosticCheckSchema
>;

export type TerminalCompatibilityDiagnosticRequest = z.infer<
  typeof TerminalCompatibilityDiagnosticRequestSchema
>;

export type TerminalCompatibilityDiagnosticResponse = z.infer<
  typeof TerminalCompatibilityDiagnosticResponseSchema
>;
