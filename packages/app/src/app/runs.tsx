import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { RunsScreen } from "@/screens/runs-screen";

export default function RunsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <RunsScreen />
    </HostRouteBootstrapBoundary>
  );
}
