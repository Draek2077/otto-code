/** Translate Windows' opaque directory-access errors into a recovery action. */
export function describeRuntimeRemovalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(?:EPERM|EBUSY)\b/iu.test(message)) {
    return "Windows denied access to this runtime. Close anything using it or correct the folder permissions, then try again.";
  }
  return message;
}
