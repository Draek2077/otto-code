import { BookOpen } from "@/components/icons/material-icons";
import { ProjectKnowledgePanel } from "@/project-knowledge/panel";
import type { PanelDescriptor } from "./panel-registry";
import { definePanel } from "@/panels/panel-registry";
function useProjectKnowledgePanelDescriptor(): PanelDescriptor {
  return {
    label: "Manage knowledge",
    tooltip: "Manage knowledge",
    subtitle: "Reviewed project facts and evidence",
    titleState: "ready",
    icon: BookOpen,
    statusBucket: null,
  };
}
export const projectKnowledgePanelRegistration = definePanel("projectKnowledge", {
  component: ProjectKnowledgePanel,
  useDescriptor: useProjectKnowledgePanelDescriptor,
  confirmClose: () => Promise.resolve(true),
});
