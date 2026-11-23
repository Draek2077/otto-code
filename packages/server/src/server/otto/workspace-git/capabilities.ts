export function gitFetchAvailable(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
) {
  return runtime?.supportsBuiltinRpc?.("otto-workspace-git") === true;
}
