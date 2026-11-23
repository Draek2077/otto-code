import { activityPluginId } from "@getpaseo/protocol/otto/activity";

export function activityAvailable(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
): boolean {
  return runtime?.supportsBuiltinRpc?.(activityPluginId) === true;
}
