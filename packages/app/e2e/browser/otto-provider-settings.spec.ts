import {
  test,
  expect,
  openOttoProviderSettings,
  openOttoProviderDetails,
} from "../support/helpers/otto-provider-settings";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });

for (const compact of [false, true]) {
  test(`unconfigured provider opens its endpoint editor and discovers models (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    await ottoProvider.update({ baseUrl: "", model: "", endpoints: [] });
    await openOttoProviderDetails(page, compact);
    // Compact sheets put testID on the header; use the visible action in the body.
    const configure = page.getByRole("button", { name: "Configure endpoint", exact: true });
    await expect(configure).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("endpoint-setup-entry.png") });
    await configure.click();
    await expect(page.getByTestId("provider-settings-sheet")).not.toBeVisible();
    const url = page.getByRole("textbox", { name: "API base URL", exact: true });
    await expect(url).toHaveValue("");
    await url.fill(ottoProvider.url);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const key = page.getByLabel("API key", { exact: true });
    await expect(key).toBeEnabled();
    await key.fill("synthetic-first-setup-key");
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    await expect(
      page.getByText("Using the key stored privately on this host.", { exact: true }),
    ).toBeVisible();
    await expect(key).toHaveValue("");
    await openOttoProviderDetails(page, compact);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("fixture", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("endpoint-setup-models.png") });
  });
}

test("Otto endpoint profiles and private keys survive reload without exposing the saved key", async ({
  page,
  ottoProvider,
}, testInfo) => {
  await openOttoProviderSettings(page);
  await page.getByRole("textbox", { name: "New endpoint name", exact: true }).fill("Second host");
  await page.getByRole("button", { name: "Add endpoint", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Endpoint name", exact: true })).toHaveValue(
    "Second host",
  );
  await page
    .getByRole("textbox", { name: "API base URL", exact: true })
    .fill(`${ottoProvider.url}/secondary`);
  await page.getByRole("textbox", { name: "Model ID", exact: true }).fill("fixture");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const keyInput = page.getByLabel("API key", { exact: true });
  await expect(keyInput).toBeEnabled();
  await keyInput.fill("synthetic-wide-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(
    page.getByText("Using the key stored privately on this host.", { exact: true }),
  ).toBeVisible();
  await expect(keyInput).toHaveValue("");
  await page.reload();
  await page.getByRole("button", { name: "Endpoint: Primary endpoint", exact: true }).click();
  await page.getByRole("menuitem", { name: "Second host", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "API base URL", exact: true })).toHaveValue(
    `${ottoProvider.url}/secondary`,
  );
  await expect(keyInput).toHaveValue("");
  await expect(
    page.getByText("Using the key stored privately on this host.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Available for new chats", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => (await ottoProvider.read()).values.endpoints?.[0]?.enabled)
    .toBe(false);
  await expect(page.getByRole("textbox", { name: "API base URL", exact: true })).toHaveValue(
    `${ottoProvider.url}/secondary`,
  );
  await page.screenshot({ path: testInfo.outputPath("otto-provider-wide.png") });
});

test.describe("compact Otto provider settings", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("conflicting connection and key saves keep both drafts editable", async ({
    page,
    ottoProvider,
  }, testInfo) => {
    await openOttoProviderSettings(page, true);
    const url = page.getByRole("textbox", { name: "API base URL", exact: true });
    await url.fill(`${ottoProvider.url}/draft`);
    await ottoProvider.update({ model: "changed-by-peer" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/Settings changed on another client/)).toBeVisible();
    await expect(url).toHaveValue(`${ottoProvider.url}/draft`);
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(url).toHaveValue(ottoProvider.url);
    await expect(page.getByRole("textbox", { name: "Model ID", exact: true })).toHaveValue(
      "changed-by-peer",
    );
    const key = page.getByLabel("API key", { exact: true });
    await expect(key).toBeEnabled();
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeEnabled();
    await key.fill("synthetic-kept-draft");
    await ottoProvider.saveKey("primary", "synthetic-peer-key");
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    await expect(page.getByText(/Host credentials changed/)).toBeVisible();
    await expect(key).toHaveValue("synthetic-kept-draft");
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save key", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    await expect(page.getByText("Host credentials updated.", { exact: true })).toBeVisible();
    await expect(key).toHaveValue("");
    await key.fill("synthetic-endpoint-bound-draft");
    await ottoProvider.update({ baseUrl: `${ottoProvider.url}/changed` });
    await expect(page.getByText(/Connection changed while editing/)).toBeVisible();
    await expect(key).toHaveValue("synthetic-endpoint-bound-draft");
    await expect(page.getByRole("button", { name: "Save key", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Discard key", exact: true }).click();
    await expect(key).toHaveValue("");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("otto-provider-compact.png") });
  });
});
