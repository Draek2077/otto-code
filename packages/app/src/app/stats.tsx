import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { StatsScreen } from "@/screens/stats-screen";

export default function StatsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <StatsScreen />
    </HostRouteBootstrapBoundary>
  );
}
