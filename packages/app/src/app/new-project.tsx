import { Redirect, useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { NewProjectScreen } from "@/screens/new-project-screen";
import { useHosts } from "@/runtime/host-runtime";

export default function NewProjectRoute() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : undefined;

  return (
    <HostRouteBootstrapBoundary>
      <NewProjectHome serverId={serverId} />
    </HostRouteBootstrapBoundary>
  );
}

function NewProjectHome({ serverId }: { serverId: string | undefined }) {
  const hosts = useHosts();

  // The boundary above only renders us once the host registry has loaded, so an
  // empty list here genuinely means "no hosts configured". Every field on this
  // page addresses a host, so without one there is nothing to render — send the
  // user to the only surface that can add a host. Mirrors open-project.tsx.
  if (hosts.length === 0) {
    return <Redirect href="/welcome" />;
  }

  return <NewProjectScreen key={serverId ?? ""} serverId={serverId} />;
}
