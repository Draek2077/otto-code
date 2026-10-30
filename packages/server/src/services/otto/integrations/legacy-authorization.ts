import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/** Optional display metadata only. Never migrate, repair or rewrite the 0.9
 * registry; grants continue to use the original host/integration/connection tuple. */
export async function legacyIntegrationAccount(
  home: string,
  integrationId: string,
  connectionId: string,
): Promise<string | null> {
  try {
    const bytes = await readFile(path.join(home, "integration-authorizations.json"), "utf8");
    if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) return null;
    const rows = z.array(z.unknown()).parse(JSON.parse(bytes));
    const record = z.object({
      integrationId: z.string(),
      connectionId: z.string(),
      accountLabel: z.string().max(512).nullable().optional(),
    });
    for (const row of rows) {
      const parsed = record.safeParse(row);
      if (
        parsed.success &&
        parsed.data.integrationId === integrationId &&
        parsed.data.connectionId === connectionId
      )
        return parsed.data.accountLabel ?? null;
    }
  } catch {
    /* Missing or unrecognized labels never destroy access to a saved grant. */
  }
  return null;
}
