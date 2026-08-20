import type { KanbanRemediation } from "@otto-code/protocol/kanban";

/**
 * A provider failure that Otto knows how to recover from.
 *
 * The SPI keeps provider-specific error *types* off the wire, and this does
 * not break that rule: the remediation payload is provider-neutral (an opaque
 * reason key plus resolved argv), so the session can forward it without
 * learning anything about GitHub or Jira. A provider that has no recovery
 * route keeps throwing a plain Error.
 */
export class KanbanRemediationError extends Error {
  readonly remediation: KanbanRemediation;

  constructor(message: string, remediation: KanbanRemediation) {
    super(message);
    this.name = "KanbanRemediationError";
    this.remediation = remediation;
  }
}

/** The remediation carried by an error, or null for any other failure. */
export function remediationOf(error: unknown): KanbanRemediation | null {
  return error instanceof KanbanRemediationError ? error.remediation : null;
}
