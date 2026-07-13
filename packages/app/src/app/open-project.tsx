import { Redirect } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { OpenProjectScreen } from "@/screens/open-project-screen";
import { useHosts } from "@/runtime/host-runtime";

export default function OpenProjectRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <OpenProjectHome />
    </HostRouteBootstrapBoundary>
  );
}

function OpenProjectHome() {
  const hosts = useHosts();

  // The boundary above only renders us once the host registry has loaded, so an
  // empty list here genuinely means "no hosts configured". Without a host every
  // tile on the home screen (add project, set up providers, pair device) dead-ends
  // into a "connect a host first" chooser with no way back, and the app can land
  // here directly on a fresh start (e.g. a restored web/desktop URL). Send the user
  // back to the first-run welcome screen — the only surface that can add a host.
  if (hosts.length === 0) {
    return <Redirect href="/welcome" />;
  }

  return <OpenProjectScreen />;
}
