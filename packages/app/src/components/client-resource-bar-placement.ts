export type ClientResourceBarPlacement = "metrics-page" | "app-shell";

/** The bar has one owner at a time so the Metrics page never duplicates the app footer. */
export function resolveClientResourceBarPlacement(
  showOnAllPages: boolean,
): ClientResourceBarPlacement {
  return showOnAllPages ? "app-shell" : "metrics-page";
}
