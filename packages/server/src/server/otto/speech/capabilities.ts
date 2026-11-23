export function speechAvailable(
  plugins: { supportsBuiltinRpc?(id: string): boolean } | undefined,
): boolean {
  return plugins?.supportsBuiltinRpc?.("otto-speech") === true;
}
