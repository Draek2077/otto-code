export type EditorErrorKind = "unavailable" | "conflict" | "invalid" | "timeout" | "closed";

export class EditorError extends Error {
  constructor(
    readonly kind: EditorErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EditorError";
  }
}
