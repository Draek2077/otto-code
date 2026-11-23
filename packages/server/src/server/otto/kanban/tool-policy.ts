import {
  createRetainedToolPolicy,
  retainedToolEnabled,
  type RetainedToolPolicy,
} from "../retained-tool-policy.js";
export type KanbanToolPolicy = RetainedToolPolicy;
export function retainedKanbanToolEnabled(
  value: unknown,
  name: string,
  providerId?: string,
): boolean {
  return retainedToolEnabled("kanban", value, name, providerId);
}
export function createRetainedKanbanToolPolicy(
  home: string,
  readCurrent: () => unknown = () => ({}),
): KanbanToolPolicy {
  return createRetainedToolPolicy("kanban", home, readCurrent);
}
