import { agentPanelRegistration } from "@/panels/agent-panel";
import { contextManagementPanelRegistration } from "@/panels/context-management-panel-registration";
import { projectKnowledgePanelRegistration } from "@/panels/project-knowledge-panel-registration";
import { artifactPanelRegistration } from "@/panels/artifact-panel";
import { architecturalViewDraftPanelRegistration } from "@/panels/architectural-view-draft-panel";
import { architecturalViewPanelRegistration } from "@/panels/architectural-view-panel";
import { browserPanelRegistration } from "@/desktop/browser/panel";
import {
  changesTreePanelRegistration,
  commitDiffPanelRegistration,
  workingDiffPanelRegistration,
} from "@/panels/diff-panel";
import { draftPanelRegistration } from "@/panels/draft-panel";
import { filePanelRegistration } from "@/panels/file-panel";
import { codeReferencesPanelRegistration } from "@/panels/code-references-panel";
import { codeRenamePanelRegistration } from "@/panels/code-rename-panel";
import { fileHistoryPanelRegistration } from "@/panels/file-history-panel";
import { gitLogPanelRegistration } from "@/panels/git-log-panel";
import { orchestrationGraphPanelRegistration } from "@/panels/workflow-graph-panel-registration";
import { filesPanelRegistration } from "@/panels/files-panel";
import { registerPanel } from "@/panels/panel-registry";
import { refinePanelRegistration } from "@/panels/refine-panel";
import { setupPanelRegistration } from "@/panels/setup-panel";
import { terminalPanelRegistration } from "@/panels/terminal-panel";
import { visualizerPanelRegistration } from "@/panels/visualizer-panel-registration";
import { providerSubagentPanelRegistration } from "@/panels/provider-subagent-panel";
import { communicationsRoomPanelRegistration } from "@/panels/communications-room-panel";
import { pullRequestPanelRegistration } from "@/panels/pull-request-panel";
import { pluginPanelRegistration } from "@/plugins/workspace-panels/panel";
import { newTabPanelRegistration } from "@/panels/new-tab-panel";

let panelsRegistered = false;

export function ensurePanelsRegistered(): void {
  if (panelsRegistered) {
    return;
  }
  registerPanel(draftPanelRegistration);
  registerPanel(newTabPanelRegistration);
  registerPanel(agentPanelRegistration);
  registerPanel(providerSubagentPanelRegistration);
  registerPanel(setupPanelRegistration);
  registerPanel(terminalPanelRegistration);
  registerPanel(browserPanelRegistration);
  registerPanel(filePanelRegistration);
  registerPanel(artifactPanelRegistration);
  registerPanel(architecturalViewDraftPanelRegistration);
  registerPanel(architecturalViewPanelRegistration);
  registerPanel(gitLogPanelRegistration);
  registerPanel(fileHistoryPanelRegistration);
  registerPanel(codeReferencesPanelRegistration);
  registerPanel(codeRenamePanelRegistration);
  registerPanel(refinePanelRegistration);
  registerPanel(visualizerPanelRegistration);
  registerPanel(contextManagementPanelRegistration);
  registerPanel(projectKnowledgePanelRegistration);
  registerPanel(orchestrationGraphPanelRegistration);
  registerPanel(communicationsRoomPanelRegistration);
  // `working_diff` and `commit_diff` are registered below and render through
  // Otto's own Changes view, so `normalizeWorkspaceTabTarget`
  // (`workspace-tabs/identity.ts`) accepts both. A panel registered here
  // without its branch there is a tab nothing can open.
  registerPanel(filesPanelRegistration);
  registerPanel(pullRequestPanelRegistration);
  registerPanel(commitDiffPanelRegistration);
  registerPanel(workingDiffPanelRegistration);
  registerPanel(changesTreePanelRegistration);
  registerPanel(pluginPanelRegistration);
  panelsRegistered = true;
}
