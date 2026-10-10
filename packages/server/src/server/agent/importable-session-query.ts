import { basename } from "node:path";
import type { ImportableProviderSession } from "./agent-sdk-types.js";

// Free-text filter for the Import session picker: matches title, first/last
// prompt preview, or the session folder's name, case-insensitively.
export function matchesImportableSessionQuery(
  session: ImportableProviderSession,
  rawQuery: string | undefined,
): boolean {
  const query = rawQuery?.trim().toLowerCase();
  if (!query) return true;
  const cwdBasename = basename(session.cwd.replaceAll("\\", "/"));
  return [session.title, session.firstPromptPreview, session.lastPromptPreview, cwdBasename].some(
    (value) => value?.toLowerCase().includes(query),
  );
}
