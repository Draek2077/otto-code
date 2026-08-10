export type ClientResourceBarPlacement = "hidden" | "metrics-page" | "app-shell";

/** The bar has one owner at a time so the Metrics page never duplicates the app footer. */
export function resolveClientResourceBarPlacement(
  showOnAllPages: boolean,
  resourceMonitorEnabled: boolean,
): ClientResourceBarPlacement {
  if (!resourceMonitorEnabled) return "hidden";
  return showOnAllPages ? "app-shell" : "metrics-page";
}
