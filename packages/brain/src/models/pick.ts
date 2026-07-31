/**
 * Resolve a model from an exact catalog id or a unique case-insensitive name
 * fragment. An ambiguous fragment is an error that lists the matches — ported
 * from the original CLI's pickModel, but throwing a CommandError instead of
 * calling process.exit, so the output layer renders it.
 */
import { CommandError } from "../output/types.js";
import type { Model } from "../types.js";

export function pickModel(catalog: Model[], needle: string | undefined): Model {
  if (!needle) {
    throw new CommandError({
      code: "NO_MODEL",
      message: "specify a model with --model <name fragment>",
    });
  }

  const exact = catalog.find((m) => m.id === needle);
  if (exact) return exact;

  const lower = String(needle).toLowerCase();
  const matches = catalog.filter(
    (m) => m.displayName.toLowerCase().includes(lower) || m.id.toLowerCase().includes(lower),
  );

  if (!matches.length) {
    throw new CommandError({
      code: "NO_MATCH",
      message: `no model matches "${needle}"`,
      details: "run `otto brain scan` to list them",
    });
  }
  if (matches.length > 1) {
    throw new CommandError({
      code: "AMBIGUOUS_MODEL",
      message: `"${needle}" matches ${matches.length} models`,
      details: matches.map((m) => m.displayName).join(", "),
    });
  }
  return matches[0];
}
