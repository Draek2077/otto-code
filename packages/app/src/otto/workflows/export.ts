import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
export async function exportWorkflow(json: string, id: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error("Invalid export ID.");
  if (!(await isAvailableAsync())) throw new Error("Sharing is unavailable on this device.");
  const file = new File(Paths.cache, `otto-workflow-${id}.json`);
  try {
    file.write(json);
    await shareAsync(file.uri, { mimeType: "application/json" });
  } finally {
    if (file.exists) file.delete();
  }
}
