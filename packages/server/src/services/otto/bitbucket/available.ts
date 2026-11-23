export function ottoBitbucketAvailable(
  runtime: { supportsBuiltinRpc?: (id: string) => boolean } | null | undefined,
): boolean {
  return runtime?.supportsBuiltinRpc?.("otto-integrations") === true;
}
