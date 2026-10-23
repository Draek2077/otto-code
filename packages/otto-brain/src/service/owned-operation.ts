/** Preserve the primary failure when releasing an operation's owned resources. */
async function attempt<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}
export async function completeOwnedOperation<T>(
  run: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  const operation = await attempt(run);
  const released = await attempt(cleanup);
  if (!operation.ok && !released.ok)
    throw new AggregateError(
      [operation.error, released.error],
      "Brain operation and resource cleanup failed",
      { cause: operation.error },
    );
  if (!operation.ok) throw operation.error;
  if (!released.ok) throw released.error;
  return operation.value;
}
