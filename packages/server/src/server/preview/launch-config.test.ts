import { describe, expect, test } from "vitest";

import { LaunchConfigurationSchema } from "./launch-config.js";

const configuration = { name: "web", runtimeExecutable: "npm", port: 3002 };

describe("launch configuration URL", () => {
  test("keeps existing configurations valid without a URL", () => {
    expect(LaunchConfigurationSchema.parse(configuration).url).toBeUndefined();
  });

  test.each([
    "http://localhost:3002/",
    "https://preview.example.test/app?mode=preview#home",
    "http://[::1]:3002/",
  ])("preserves the explicit address %s", (url) => {
    expect(LaunchConfigurationSchema.parse({ ...configuration, url }).url).toBe(url);
  });

  test.each(["", "/app", "localhost:3002", "file:///tmp/page.html", "javascript:alert(1)"])(
    "rejects invalid or non-HTTP browser URLs: %s",
    (url) => {
      const result = LaunchConfigurationSchema.safeParse({ ...configuration, url });
      expect(result.success).toBe(false);
    },
  );
});
