/** Keep the handshake declarative and asset readiness with its daemon owner. */
export function architecturalViewsAvailable(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
) {
  return runtime?.supportsBuiltinRpc?.("otto-architectural-views") === true;
}
export function documentBuiltinAvailable(
  id: string,
  artifacts: object | null,
  views: { available(): boolean } | null,
): boolean {
  if (id === "otto-artifacts") return artifacts !== null;
  if (id === "otto-architectural-views") return views?.available() === true;
  return false;
}
