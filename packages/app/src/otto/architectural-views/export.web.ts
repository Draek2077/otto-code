import type { InteractiveViewExportFile } from "./view-bridge";
export async function exportArchitecturalView(file: InteractiveViewExportFile): Promise<void> {
  const response = await fetch(file.dataUrl);
  const url = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
