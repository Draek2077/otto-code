import { agentPanelRegistration } from "@/panels/agent-panel";
import { contextManagementPanelRegistration } from "@/panels/context-management-panel-registration";
import { artifactPanelRegistration } from "@/panels/artifact-panel";
import { browserPanelRegistration } from "@/panels/browser-panel";
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
  registerPanel(gitLogPanelRegistration);
  registerPanel(fileHistoryPanelRegistration);
  registerPanel(codeReferencesPanelRegistration);
  registerPanel(codeRenamePanelRegistration);
  registerPanel(refinePanelRegistration);
  registerPanel(visualizerPanelRegistration);
  registerPanel(contextManagementPanelRegistration);
  registerPanel(orchestrationGraphPanelRegistration);
  // DEFERRED(paseoDiffTab): Paseo's diff tab is not registered here. Their
  // `diff-panel.tsx` needs a restructured `@/git/diff-pane` exporting
  // SharedDiffView / DiffFilesToolbar / resolveDiffLayout, and Otto's
  // diff-pane carries ~1,900 substantive lines theirs lacks (file history,
  // rollback, comments, tree guides), so adopting the tab means merging that
  // file properly.
  //
  // `working_diff` and `commit_diff` are LIVE tab kinds, not dormant ones:
  // they are in the union (`workspace-tabs/model.ts`), they have identity
  // builders (`workspace-tabs/identity.ts`), and the tab menu can open them.
  // With no registered panel, opening one yields a dead tab. Either register a
  // panel or remove the kinds from the union — leaving both halves as they are
  // is the state that produces the dead tab.
  panelsRegistered = true;
}
