/** Registration is inert. Native graphics and operational panels load only on render. */
import { lazy, Suspense } from "react";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import type { InstalledPlugin } from "@/plugins/types";
import { BrainRpc } from "./rpc";
import { BrainConnectionState } from "./connection-state";
import { BrainSettingsFacade } from "./settings-port";
import { BrainScreenFacade } from "./screen-port";

type Installation = Pick<InstalledPlugin, "serverId" | "invoke" | "lifetime">;
export interface BrainUiContext {
  screen: BrainScreenFacade;
  settings: BrainSettingsFacade;
  navigation: { openBrain(): void; openSettings(): void };
}
type Presentation = typeof import("@getpaseo/plugin/client/otto-brain");

export function createBrainPluginUi(
  installation: Installation,
  navigation: BrainUiContext["navigation"],
): Presentation {
  const host = { serverId: installation.serverId, label: installation.serverId };
  const core = new BrainConnectionState(new BrainRpc(installation.invoke));
  const screen = new BrainScreenFacade(core, host, navigation);
  const settings = new BrainSettingsFacade(core, host, navigation.openBrain);
  const close = () => {
    screen.close();
    settings.close();
    core.close();
  };
  if (installation.lifetime.signal.aborted) close();
  else installation.lifetime.signal.addEventListener("abort", close, { once: true });

  let loaded: Promise<Presentation> | null = null;
  const presentation = () =>
    (loaded ??= import("./plugin-ui").then((module) =>
      module.createBrainUiComponents({ screen, settings, navigation }),
    ));
  const Screen = lazy(async () => ({ default: (await presentation()).BrainScreen }));
  const Settings = lazy(async () => ({ default: (await presentation()).BrainSettings }));
  const Sidebar = lazy(async () => ({ default: (await presentation()).BrainSidebar }));
  function BrainScreen(props: PluginScreenProps) {
    return (
      <Suspense fallback={null}>
        <Screen {...props} />
      </Suspense>
    );
  }
  function BrainSettings(props: PluginSurfaceProps) {
    return (
      <Suspense fallback={null}>
        <Settings {...props} />
      </Suspense>
    );
  }
  function BrainSidebar(props: PluginSidebarItemProps) {
    return (
      <Suspense fallback={null}>
        <Sidebar {...props} />
      </Suspense>
    );
  }
  return { BrainScreen, BrainSettings, BrainSidebar };
}
