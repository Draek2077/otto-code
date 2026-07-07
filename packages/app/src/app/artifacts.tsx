import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ArtifactsScreen } from "@/screens/artifacts-screen";

export default function ArtifactsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <ArtifactsScreen />
    </HostRouteBootstrapBoundary>
  );
}
