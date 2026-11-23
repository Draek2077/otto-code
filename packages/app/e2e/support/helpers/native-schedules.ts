import { test as base, expect } from "../fixtures";
import { nativeScheduleCapabilityFloor } from "./schedule-native-capability-floor";

export { expect, type Page } from "../fixtures";

// OTTO(schedules): keep the original native UI journeys as explicit old-host
// compatibility proof. Upgraded hosts use the separate Otto Schedule journeys.
export const test = base.extend<{ nativeScheduleFloor: void }>({
  nativeScheduleFloor: [
    async ({ page }, provide, info) => {
      let serverInfos = 0;
      await page.routeWebSocket(
        (url) =>
          ["localhost", "127.0.0.1"].includes(url.hostname) &&
          url.pathname === "/ws" &&
          !["6767", "6768", "6788", "6868"].includes(url.port),
        (browser) => {
          const server = browser.connectToServer();
          browser.onMessage((message) => server.send(message));
          server.onMessage((message) => {
            const projected = nativeScheduleCapabilityFloor(message);
            if (projected.serverInfo) serverInfos++;
            browser.send(projected.message);
          });
        },
      );
      await provide();
      if (info.status === "passed") expect(serverInfos).toBeGreaterThan(0);
    },
    { auto: true },
  ],
});
