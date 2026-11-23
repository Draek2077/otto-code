import { expect, it } from "vitest";
import { endpointProfiles, modelReference, qualifyModel } from "./endpoints.js";
import { providerSettings } from "../shared/settings.js";

it("keeps primary model IDs stable and binds additional endpoint models without guessing a host", () => {
  const settings = providerSettings.schema.parse({
    baseUrl: "https://one.invalid/v1",
    endpoints: [
      {
        id: "second",
        label: "Second host",
        baseUrl: "https://two.invalid/v1",
        model: "vendor/model:free",
        apiKeyEnv: "SECOND_KEY",
      },
    ],
  });
  const profiles = endpointProfiles(settings);
  expect(profiles.map((profile) => profile.id)).toEqual(["primary", "second"]);
  expect(qualifyModel("primary", "vendor/model:free")).toBe("vendor/model:free");
  const selected = qualifyModel("second", "vendor/model:free");
  expect(modelReference(selected)).toEqual({ profileId: "second", modelId: "vendor/model:free" });
  expect(profiles[1]!.settings).toMatchObject({
    baseUrl: "https://two.invalid/v1",
    model: "vendor/model:free",
    apiKeyEnv: "SECOND_KEY",
  });
  expect(() =>
    providerSettings.schema.parse({
      endpoints: [
        { id: "second", label: "First", baseUrl: "https://one.invalid/v1" },
        { id: "second", label: "Duplicate", baseUrl: "https://two.invalid/v1" },
      ],
    }),
  ).toThrow();
  expect(() => modelReference("otto-endpoint/second/%ZZ")).toThrow("Invalid");
});
