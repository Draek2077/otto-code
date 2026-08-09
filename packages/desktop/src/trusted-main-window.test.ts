import { describe, expect, it } from "vitest";

import {
  createTrustedOttoOriginPolicy,
  decideTrustedMainWindowNavigation,
  isTrustedOttoRendererUrl,
  setupTrustedMainWindowNavigation,
} from "./trusted-main-window";

describe("trusted main-window origin policy", () => {
  it("allows Otto's packaged app origin only", () => {
    const policy = createTrustedOttoOriginPolicy({ packaged: true, developmentUrls: [] });

    expect(isTrustedOttoRendererUrl("otto://app/workspaces", policy)).toBe(true);
    expect(isTrustedOttoRendererUrl("otto://other/workspaces", policy)).toBe(false);
    expect(isTrustedOttoRendererUrl("https://attacker.example", policy)).toBe(false);
  });

  it("prevents attacker navigation and sends http(s) destinations to the external browser", () => {
    const policy = createTrustedOttoOriginPolicy({ packaged: true, developmentUrls: [] });
    let navigationListener: ((event: { preventDefault: () => void }, url: string) => void) | null =
      null;
    let windowOpenHandler: ((details: { url: string }) => { action: "deny" }) | null = null;
    const externalUrls: string[] = [];
    const fakeWindow = {
      webContents: {
        on: (event: string, listener: typeof navigationListener) => {
          if (event === "will-navigate") navigationListener = listener;
        },
        setWindowOpenHandler: (handler: typeof windowOpenHandler) => {
          windowOpenHandler = handler;
        },
      },
    };

    setupTrustedMainWindowNavigation(
      fakeWindow as unknown as Electron.BrowserWindow,
      policy,
      (url) => externalUrls.push(url),
    );
    const navigation = { preventDefault: () => externalUrls.push("prevented") };
    navigationListener!(navigation, "https://attacker.example/phish");

    expect(decideTrustedMainWindowNavigation("https://attacker.example/phish", policy)).toBe(
      "externalize",
    );
    expect(decideTrustedMainWindowNavigation("file:///C:/secret.txt", policy)).toBe("block");
    expect(externalUrls).toEqual(["prevented", "https://attacker.example/phish"]);
    expect(windowOpenHandler!({ url: "https://attacker.example/popup" })).toEqual({
      action: "deny",
    });
    expect(externalUrls).toEqual([
      "prevented",
      "https://attacker.example/phish",
      "https://attacker.example/popup",
    ]);
  });

  it("allows configured local development navigation for hot reload", () => {
    const policy = createTrustedOttoOriginPolicy({
      packaged: false,
      developmentUrls: ["http://localhost:8081", "http://127.0.0.1:19000"],
    });

    expect(isTrustedOttoRendererUrl("http://localhost:8081/?platform=electron", policy)).toBe(true);
    expect(isTrustedOttoRendererUrl("http://127.0.0.1:19000/_expo/loading", policy)).toBe(true);
    expect(isTrustedOttoRendererUrl("http://localhost:8082", policy)).toBe(false);
    expect(isTrustedOttoRendererUrl("https://attacker.example", policy)).toBe(false);
  });
});
