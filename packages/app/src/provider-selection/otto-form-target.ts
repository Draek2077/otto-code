/** Otto global creation dialogs initialize a host once, before a project is chosen. */
export function resolveOttoFormHost(input: {
  selectedServerId: string | null;
  seedServerId: string | null;
  onlineServerIds: readonly string[];
}): string | null {
  return input.selectedServerId ?? input.seedServerId ?? input.onlineServerIds[0] ?? null;
}
