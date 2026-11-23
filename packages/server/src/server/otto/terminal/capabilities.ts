export function terminalAvailable(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
) {
  return runtime?.supportsBuiltinRpc?.("otto-terminal") === true;
}
