import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { KanbanScreen } from "@/screens/kanban-screen";

export default function KanbanRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <KanbanScreen />
    </HostRouteBootstrapBoundary>
  );
}
