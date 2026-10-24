import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BrainScreen, BrainSettings, BrainSidebar } from "@getpaseo/plugin/client/otto-brain";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: "brain", title: "Brain", Component: BrainScreen }),
    client.addSettingsScreen({
      id: "brain",
      title: "Brain",
      icon: "Brain",
      Component: BrainSettings,
    }),
    client.addSidebarFooterItem({ id: "brain", title: "Brain", Component: BrainSidebar }),
    client.addCommandCenterItem({
      id: "open-brain",
      context: "global",
      title: "Open Brain",
      icon: "Brain",
      onSelect: () => client.openScreen({ screenId: "brain" }),
    }),
  ];
  return async () => {
    for (const remove of removers.toReversed()) await remove();
  };
}
