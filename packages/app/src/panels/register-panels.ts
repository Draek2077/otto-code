import { agentPanelRegistration } from "@/panels/agent-panel";
import { contextManagementPanelRegistration } from "@/panels/context-management-panel-registration";
import { projectKnowledgePanelRegistration } from "@/panels/project-knowledge-panel-registration";
import { artifactPanelRegistration } from "@/panels/artifact-panel";
import { architecturalViewDraftPanelRegistration } from "@/panels/architectural-view-draft-panel";
import { architecturalViewPanelRegistration } from "@/panels/architectural-view-panel";
import { browserPanelRegistration } from "@/desktop/browser/panel";
import { draftPanelRegistration } from "@/panels/draft-panel";
import { filePanelRegistration } from "@/panels/file-panel";
import { codeReferencesPanelRegistration } from "@/panels/code-references-panel";
import { codeRenamePanelRegistration } from "@/panels/code-rename-panel";
import { fileHistoryPanelRegistration } from "@/panels/file-history-panel";
import { gitLogPanelRegistration } from "@/panels/git-log-panel";
import { orchestrationGraphPanelRegistration } from "@/panels/orchestration-graph-panel-registration";
import { registerPanel } from "@/panels/panel-registry";
import { refinePanelRegistration } from "@/panels/refine-panel";
import { setupPanelRegistration } from "@/panels/setup-panel";
import { terminalPanelRegistration } from "@/panels/terminal-panel";
import { visualizerPanelRegistration } from "@/panels/visualizer-panel-registration";
import { providerSubagentPanelRegistration } from "@/panels/provider-subagent-panel";
import { communicationsRoomPanelRegistration } from "@/panels/communications-room-panel";

let panelsRegistered = false;

export function ensurePanelsRegistered(): void {
  if (panelsRegistered) {
    return;
  }
  registerPanel(draftPanelRegistration);
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
  // DEFERRED(paseoDiffTab): Paseo's diff tab is not registered here. Their
  // `diff-panel.tsx` needs a restructured `@/git/diff-pane` exporting
  // SharedDiffView / DiffFilesToolbar / resolveDiffLayout, and Otto's
  // diff-pane carries ~1,900 substantive lines theirs lacks (file history,
  // rollback, comments, tree guides), so adopting the tab means merging that
  // file properly.
  //
  // `working_diff` and `commit_diff` stay in the tab union
  // (`workspace-tabs/model.ts`) because Otto inherits Paseo's tab model
  // wholesale, but nothing can open one: `normalizeWorkspaceTabTarget`
  // (`workspace-tabs/identity.ts`) deliberately returns null for both, which is
  // what keeps the missing panel from ever becoming a dead tab. That null is
  // load-bearing - if you register a diff panel here, add the matching branches
  // there in the same change, and not before.
  panelsRegistered = true;
}
