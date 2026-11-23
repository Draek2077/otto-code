import type { InteractiveViewExportFile } from "./view-bridge";
/** Native diagram reading is supported; the renderer's browser capture APIs
 * are not advertised as native export capabilities. */
export async function exportArchitecturalView(_file: InteractiveViewExportFile): Promise<void> {
  throw new Error("Diagram image export is available in Otto Desktop and web.");
}
