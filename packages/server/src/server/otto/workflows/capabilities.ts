/** Advertise the composed, loaded built-in, not just the presence of source files. */
export function ottoWorkflowsAvailable(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
) {
  return runtime?.supportsBuiltinRpc?.("otto-workflows") === true;
}
