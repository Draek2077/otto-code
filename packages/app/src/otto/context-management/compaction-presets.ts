export const contextCompactionPresets = [
  {
    id: "context",
    label: "Compact instructions",
    instruction:
      "Compress this file: remove redundancy and duplicated guidance, and keep every distinct instruction, fact and convention intact in meaning. Preserve the structure and the headings. Do not add or invent content. The instructions in this file are load-bearing: never drop a rule.",
  },
  {
    id: "memory",
    label: "Compact memory index",
    instruction:
      "Compress this index to one line per entry. Preserve every entry and pointer. Detailed entry files are read-only unless explicitly included in the rewritable set; never claim to have moved detail into an unchanged reference.",
  },
  {
    id: "prose",
    label: "Tighten prose",
    instruction:
      "Reduce the length of this document without losing meaning. Do not introduce any new claim, fact or recommendation.",
  },
] as const;
export function contextCompactionInstruction(label: string) {
  const name = label.toLowerCase().replaceAll("\\", "/").split("/").at(-1) ?? "";
  return contextCompactionPresets[name.startsWith("memory") || name === "index.md" ? 1 : 0]
    .instruction;
}
