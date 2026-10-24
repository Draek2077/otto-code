/** Canonical injected library. The daemon supplies all filesystem/forge effects. */
export {
  createKanbanHandlers,
  createKanbanServerContribution,
} from "../otto/kanban/server/contribution.js";
export { prepareTargetUpdate, readProjectTarget } from "../otto/kanban/server/project-config.js";
export type {
  ProjectSnapshot,
  ProjectBoardPort,
  GitHubReadPort,
} from "../otto/kanban/server/ports.js";
