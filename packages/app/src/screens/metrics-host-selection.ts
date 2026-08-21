interface MetricsHost {
  serverId: string;
}

interface ResolveMetricsHostServerIdInput {
  hosts: readonly MetricsHost[];
  selectedServerId: string | null;
  activeWorkspaceServerId: string | null;
  lastWorkspaceServerId: string | null;
  localServerId: string | null;
}

/**
 * Metrics report one host at a time. Prefer an explicit picker choice, then
 * the host behind the workspace the user is working in, before using the
 * local daemon or stored host order as a last resort.
 */
export function resolveMetricsHostServerId({
  hosts,
  selectedServerId,
  activeWorkspaceServerId,
  lastWorkspaceServerId,
  localServerId,
}: ResolveMetricsHostServerIdInput): string | null {
  const hasHost = (serverId: string | null): serverId is string =>
    serverId !== null && hosts.some((host) => host.serverId === serverId);

  if (hasHost(selectedServerId)) {
    return selectedServerId;
  }
  if (hasHost(activeWorkspaceServerId)) {
    return activeWorkspaceServerId;
  }
  if (hasHost(lastWorkspaceServerId)) {
    return lastWorkspaceServerId;
  }
  if (hasHost(localServerId)) {
    return localServerId;
  }
  return hosts[0]?.serverId ?? null;
}
