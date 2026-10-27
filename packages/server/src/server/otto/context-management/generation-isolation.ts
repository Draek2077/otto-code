/** A fixed recovery message, never provider diagnostics or native configuration. */
export const CONTEXT_GENERATION_ISOLATION_MESSAGE =
  "This provider cannot currently generate isolated, read-only Context proposals. Choose another provider for this action. Normal chats remain available.";

/** Raised before opening a session when no verified utility policy exists. */
export class ContextGenerationIsolationUnavailable extends Error {
  constructor() {
    super(CONTEXT_GENERATION_ISOLATION_MESSAGE);
    this.name = "ContextGenerationIsolationUnavailable";
  }
}
