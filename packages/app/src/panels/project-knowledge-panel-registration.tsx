import { BookOpen } from "@/components/icons/material-icons";
import { ProjectKnowledgePanel } from "@/project-knowledge/panel";
import type { PanelDescriptor, PanelRegistration } from "./panel-registry";
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
export const projectKnowledgePanelRegistration: PanelRegistration<"projectKnowledge"> = {
  kind: "projectKnowledge",
  component: ProjectKnowledgePanel,
  useDescriptor: useProjectKnowledgePanelDescriptor,
  confirmClose: () => Promise.resolve(true),
};
