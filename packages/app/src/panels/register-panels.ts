import { agentPanelRegistration } from "@/panels/agent-panel";
import { artifactPanelRegistration } from "@/panels/artifact-panel";
import { browserPanelRegistration } from "@/panels/browser-panel";
import { draftPanelRegistration } from "@/panels/draft-panel";
import { filePanelRegistration } from "@/panels/file-panel";
import { gitLogPanelRegistration } from "@/panels/git-log-panel";
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
  registerPanel(visualizerPanelRegistration);
  panelsRegistered = true;
}
