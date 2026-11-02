export class TerminalSettingsError extends Error {
  readonly kind: "conflict" | "unavailable";
  constructor(kind: "conflict" | "unavailable", message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}
export class TerminalShellUnavailableError extends Error {
  constructor(shell: string) {
    super(`${shell} is unavailable on this host. Choose another shell in Host → Terminals.`);
  }
}
