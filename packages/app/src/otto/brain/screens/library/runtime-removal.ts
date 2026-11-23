/** Translate Windows' opaque directory-access errors into a recovery action. */
export function isRuntimeRemovalAccessDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:EPERM|EBUSY|EACCES)\b/iu.test(message);
}

export function describeRuntimeRemovalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isRuntimeRemovalAccessDenied(message)) {
    return "Windows denied access to this runtime. You can retry with administrator permission.";
  }
  return message;
}
