import {
  test,
  expect,
  openOttoProviderSettings,
  openOttoProviderDetails,
} from "../support/helpers/otto-provider-settings";
test.use({ e2eDaemonConfig: { pluginsEnabled: true } });

for (const compact of [false, true]) {
  test(`fresh connection needs only URL, key and one Save (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    await ottoProvider.update({ baseUrl: "", model: "", endpoints: [] });
    await openOttoProviderDetails(page, compact);
    await page.getByRole("button", { name: "Configure endpoint", exact: true }).click();
    const url = page.getByRole("textbox", { name: "API URL", exact: true });
    const key = page.getByLabel("API key", { exact: true });
    await expect(url).toHaveValue("");
    await expect(page.getByRole("textbox", { name: "Model ID", exact: true })).not.toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "API key environment variable", exact: true }),
    ).not.toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath("connection-form.png") });
    await url.fill(ottoProvider.url);
    await key.fill("synthetic-first-setup-key");
    await page.getByRole("button", { name: "Save connection", exact: true }).click();
    await expect(page.getByText("Connection saved.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add connection", exact: true })).toBeVisible();
    await expect(key).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("saved-connections.png") });
    await openOttoProviderDetails(page, compact);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByText(`${new URL(ottoProvider.url).host} / fixture`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Configure endpoint", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByTestId("provider-settings-sheet")).toContainText(
      "OpenAI Compatible API",
    );
  });
}

test("manages multiple connections with edit, reload, disabled state, removal confirmation and key privacy", async ({
  page,
  ottoProvider,
}, testInfo) => {
  await openOttoProviderSettings(page);
  for (const name of ["Second", "Third"]) {
    await page.getByRole("button", { name: "Add connection", exact: true }).click();
    await page
      .getByRole("textbox", { name: "API URL", exact: true })
      .fill(`${ottoProvider.url}/${name.toLowerCase()}`);
    await page.getByLabel("API key", { exact: true }).fill(`synthetic-${name}-key`);
    await page.getByRole("button", { name: "Advanced options", exact: true }).click();
    await page.getByRole("textbox", { name: "Connection name", exact: true }).fill(name);
    await page.getByRole("button", { name: "Save connection", exact: true }).click();
    await expect(page.getByText("Connection saved.", { exact: true })).toBeVisible();
  }
  const second = (await ottoProvider.read()).values.endpoints!.find(
    (entry) => entry.label === "Second",
  )!;
  const row = page.getByTestId(`otto-connection-${second.id}`);
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const key = page.getByLabel("API key", { exact: true });
  await expect(key).toHaveValue("");
  await expect(
    page.getByText("A host key is configured. Leave empty to keep it.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Advanced options", exact: true }).click();
  await page.getByRole("switch", { name: "Available for new chats", exact: true }).click();
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await ottoProvider.read()).values.endpoints?.find((entry) => entry.id === second.id)
          ?.enabled,
    )
    .toBe(false);
  await page.reload();
  await expect(row).toContainText("Disabled for new chats");
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByText(
      "Disconnect this connection and remove its saved key. Chat history will be kept.",
      { exact: true },
    ),
  ).toBeVisible();
  // A confirmation stays bound to what was reviewed, even if another client edits the host.
  await ottoProvider.update({ maxToolRounds: 12 });
  await page.getByRole("button", { name: "Remove connection", exact: true }).click();
  await expect(page.getByText(/Host connection settings changed/)).toBeVisible();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Review latest", exact: true }).click();
  await expect(page.getByText(/Latest host values loaded/)).toBeVisible();
  await page.getByRole("button", { name: "Remove connection", exact: true }).click();
  await expect(row).not.toBeVisible();
  await expect(page.getByText("Third", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await ottoProvider.read()).values.endpoints?.map((entry) => entry.label))
    .toEqual(["Third"]);
  await page.screenshot({ path: testInfo.outputPath("connections-managed.png") });
});

test.describe("compact connection conflicts", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("retains URL and key drafts and reviews peer changes before retrying one Save", async ({
    page,
    ottoProvider,
  }) => {
    await openOttoProviderSettings(page, true);
    await page
      .getByTestId("otto-connection-primary")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const url = page.getByRole("textbox", { name: "API URL", exact: true });
    const key = page.getByLabel("API key", { exact: true });
    await url.fill(`${ottoProvider.url}/draft`);
    await key.fill("synthetic-kept-draft");
    await ottoProvider.update({ model: "changed-by-peer" });
    await page.getByRole("button", { name: "Save connection", exact: true }).click();
    await expect(page.getByText(/Settings changed on another client/)).toBeVisible();
    await expect(url).toHaveValue(`${ottoProvider.url}/draft`);
    await expect(key).toHaveValue("synthetic-kept-draft");
    await page.getByRole("button", { name: "Review latest", exact: true }).click();
    await expect(page.getByText(/Latest host values loaded/)).toBeVisible();
    await page.getByRole("button", { name: "Save connection", exact: true }).click();
    await expect(page.getByText("Connection saved.", { exact: true })).toBeVisible();
    await expect.poll(async () => (await ottoProvider.read()).values.model).toBe("changed-by-peer");
  });

  test("retains a key draft when its separate private write conflicts", async ({
    page,
    ottoProvider,
  }) => {
    await openOttoProviderSettings(page, true);
    await page
      .getByTestId("otto-connection-primary")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const key = page.getByLabel("API key", { exact: true });
    await expect(page.getByRole("button", { name: "Save connection", exact: true })).toBeEnabled();
    await key.fill("synthetic-draft-key");
    await ottoProvider.saveKey("primary", "synthetic-peer-key");
    await page.getByRole("button", { name: "Save connection", exact: true }).click();
    await expect(page.getByText(/API key was not saved/)).toBeVisible();
    await expect(key).toHaveValue("synthetic-draft-key");
    await page.getByRole("button", { name: "Review latest", exact: true }).click();
    await expect(page.getByText(/Latest host values loaded/)).toBeVisible();
    await page.getByRole("button", { name: "Save connection", exact: true }).click();
    await expect(page.getByText("Connection saved.", { exact: true })).toBeVisible();
    await expect(key).not.toBeVisible();
  });
});
