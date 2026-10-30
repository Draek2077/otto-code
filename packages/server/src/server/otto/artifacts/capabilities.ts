/** Keep the Paseo handshake seam declarative and advertise only a composed owner. */
export function ottoArtifactsAvailable(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
) {
  return runtime?.supportsBuiltinRpc?.("otto-artifacts") === true;
}
