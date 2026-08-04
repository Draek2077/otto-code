import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { BrainScreen } from "@/screens/brain/brain-screen";

export default function BrainRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <BrainScreen />
    </HostRouteBootstrapBoundary>
  );
}
