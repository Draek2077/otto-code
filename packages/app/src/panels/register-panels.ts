import { agentPanelRegistration } from "@/panels/agent-panel";
import { contextManagementPanelRegistration } from "@/panels/context-management-panel-registration";
import { artifactPanelRegistration } from "@/panels/artifact-panel";
import { browserPanelRegistration } from "@/panels/browser-panel";
import { draftPanelRegistration } from "@/panels/draft-panel";
import { filePanelRegistration } from "@/panels/file-panel";
import { fileHistoryPanelRegistration } from "@/panels/file-history-panel";
import { gitLogPanelRegistration } from "@/panels/git-log-panel";
import { orchestrationGraphPanelRegistration } from "@/panels/orchestration-graph-panel-registration";
import { registerPanel } from "@/panels/panel-registry";
import { setupPanelRegistration } from "@/panels/setup-panel";
import { terminalPanelRegistration } from "@/panels/terminal-panel";
import { visualizerPanelRegistration } from "@/panels/visualizer-panel-registration";

let panelsRegistered = false;

export function ensurePanelsRegistered(): void {
  if (panelsRegistered) {
    return;
  }
  registerPanel(draftPanelRegistration);
  registerPanel(agentPanelRegistration);
  registerPanel(setupPanelRegistration);
  registerPanel(terminalPanelRegistration);
  registerPanel(browserPanelRegistration);
  registerPanel(filePanelRegistration);
  registerPanel(artifactPanelRegistration);
  registerPanel(gitLogPanelRegistration);
  registerPanel(fileHistoryPanelRegistration);
  registerPanel(visualizerPanelRegistration);
  registerPanel(contextManagementPanelRegistration);
  registerPanel(orchestrationGraphPanelRegistration);
  panelsRegistered = true;
}
