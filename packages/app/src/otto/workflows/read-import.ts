import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";
export async function readWorkflowImport(): Promise<string | null> {
  const picked = await getDocumentAsync({
    type: "application/json",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if ((asset.size ?? 0) > 2000000) throw new Error("Import exceeds 2 MB.");
  const file = new File(asset.uri);
  try {
    return await file.text();
  } finally {
    if (file.exists) file.delete();
  }
}
