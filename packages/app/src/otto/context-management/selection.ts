import type { ContextCategory } from "@getpaseo/plugin/otto/context-management";
export interface ContextSourceSelection {
  nodeId: string | null;
  category: ContextCategory | null;
  findingId?: string;
  line?: number;
  lineEnd?: number;
}
