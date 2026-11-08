/** The complete target API is available only when its composed trusted built-in
 * is loaded. The presence of source files alone grants no capability. */
export function scheduleTargetsAvailable(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
) {
  return runtime?.supportsBuiltinRpc?.("otto-schedules") === true;
}
