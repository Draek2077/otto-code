import { unassignedRoster } from "../support/helpers/otto-provider-roster"; // OTTO(profiles)
import {
  test,
  verifyProviderSettings,
  verifyNewWorkspaceModelIcon,
  verifyCompactModelIcon,
  verifyExistingAgentModelIcon,
} from "../support/helpers/plugin-provider-icons";

test.use({ e2eDaemonConfig: { daemon: unassignedRoster } });

test("plugin provider icons follow the model through settings and wide and compact composers", async ({
  providerIcons,
}) => {
  await verifyProviderSettings(providerIcons);
  await verifyNewWorkspaceModelIcon(providerIcons);
  await verifyCompactModelIcon(providerIcons);
  await verifyExistingAgentModelIcon(providerIcons);
});
