export class TerminalSettingsError extends Error {
  constructor(
    readonly kind: "conflict" | "unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export class TerminalShellUnavailableError extends Error {
  constructor(shell: string) {
    super(`${shell} is unavailable on this host. Choose another shell in Host → Terminals.`);
  }
}
