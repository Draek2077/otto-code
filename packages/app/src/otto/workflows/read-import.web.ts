import { getDocumentAsync } from "expo-document-picker";
export async function readWorkflowImport(): Promise<string | null> {
  const picked = await getDocumentAsync({ type: "application/json", multiple: false });
  if (picked.canceled) return null;
  const file = picked.assets[0].file;
  if (!file) throw new Error("The selected import file could not be read.");
  if (file.size > 2000000) throw new Error("Import exceeds 2 MB.");
  return file.text();
}
