/** Removes filename-only qualifiers from a quant label shown in the app. */
export function formatQuantLabel(quant: string | null): string {
  return quant?.replace(/^UD-/i, "") ?? "";
}
