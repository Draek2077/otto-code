import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
export async function exportArtifact(html: string, id: string): Promise<void> {
  if (!(await isAvailableAsync())) throw new Error("Sharing is unavailable on this device.");
  const file = new File(Paths.cache, `otto-artifact-${id}.html`);
  try {
    file.write(html);
    await shareAsync(file.uri, { mimeType: "text/html", UTI: "public.html" });
  } finally {
    if (file.exists) file.delete();
  }
}
