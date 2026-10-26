/** Cleanup always runs once; neither an operation failure nor cleanup failure is hidden. */
export async function withContextCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let result: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    result = { ok: true, value: await operation() };
  } catch (error) {
    result = { ok: false, error };
  }
  let cleanupFailure: { error: unknown } | undefined;
  try {
    await cleanup();
  } catch (error) {
    cleanupFailure = { error };
  }
  if (!result.ok) {
    if (cleanupFailure)
      throw new AggregateError(
        [result.error, cleanupFailure.error],
        "Context edit and cleanup failed",
        { cause: result.error },
      );
    throw result.error;
  }
  if (cleanupFailure) throw cleanupFailure.error;
  return result.value;
}
