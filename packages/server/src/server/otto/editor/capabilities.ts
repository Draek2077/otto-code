export function editorAvailable(runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined) {
  return runtime?.supportsBuiltinRpc?.("otto-editor") === true;
}
