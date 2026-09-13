/** Otto scoped sessions retain their RPC ceiling alongside daemon permissions. */
export function isSessionRpcAllowed(scopes: readonly string[], rpcName: string): boolean {
  return scopes.some((scope) => {
    if (scope === "*" || scope === rpcName) return true;
    if (!scope.endsWith(".*")) return false;
    return rpcName.startsWith(scope.slice(0, -1));
  });
}
