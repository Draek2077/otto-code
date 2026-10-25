import { test, expect } from "../support/helpers/otto-brain-owner";
import { openBrainSettings } from "../support/helpers/otto-brain";

test.use({ e2eDaemonConfig: { pluginsEnabled: true }, trace: "retain-on-failure" });
test.setTimeout(90000);
for (const compact of [false, true]) {
  test(`Brain model, profile and log operations reach the actual owner (${compact ? "compact" : "wide"})`, async ({
    page,
    brainOwner,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    await openBrainSettings(page, compact);
    await expect(page.getByRole("switch", { name: "Enable Brain", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Open Brain", exact: true }).click();
    await page.getByRole("button", { name: "Benchmark", exact: true }).click();
    await page.getByTestId("brain-bench-run").click();
    await expect(
      page.getByText("Load a model before starting a benchmark", { exact: true }),
    ).toBeVisible();
    expect((await brainOwner.jobs()).jobs).toEqual([]);

    await page.getByRole("button", { name: "Library", exact: true }).click();
    await expect(page.getByText(brainOwner.modelName, { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Models", exact: true }).click();
    await page.getByTestId(`brain-model-${brainOwner.modelId}`).click();
    const decreaseContext = page.getByTestId("brain-field-contextSize-down");
    await expect(decreaseContext).toBeEnabled();
    await decreaseContext.click();
    await expect(decreaseContext.locator("..")).toContainText("8,192");
    await expect.poll(() => brainOwner.profileContext()).toBe(8192);
    await page.getByTestId("brain-model-rename").click();
    await page.getByTestId("brain-model-rename-modal-input").fill("UI fixture model");
    await page.getByTestId("brain-model-rename-modal-submit").click();
    await expect
      .poll(
        async () =>
          (await brainOwner.inventory()).models.find((row) => row.id === brainOwner.modelId)
            ?.displayName,
      )
      .toBe("UI fixture model");
    await page.getByTestId("brain-model-load").click();
    await expect(page.getByTestId("brain-model-unload")).toBeEnabled({ timeout: 30000 });
    await expect
      .poll(async () => (await brainOwner.status()).residents.map((row) => row.modelId))
      .toEqual([brainOwner.modelId]);

    await page.getByRole("button", { name: "Logs", exact: true }).click();
    await expect(page.getByText(/brain-e2e-ready/).first()).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("brain-logs-copy").click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("brain-e2e-ready");
    await page.getByRole("button", { name: "Models", exact: true }).click();
    await page.getByTestId(`brain-model-${brainOwner.modelId}`).click();
    await page.getByTestId("brain-model-unload").click();
    await expect(page.getByTestId("brain-model-load")).toBeEnabled({ timeout: 30000 });
    await expect(
      page.getByText("No GPU detected, so there is no VRAM budget to check.", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("brain-model-operations.png") });
    await page.reload();
    await openBrainSettings(page, compact);
    await page.getByRole("button", { name: "Open Brain", exact: true }).click();
    await page.getByRole("button", { name: "Models", exact: true }).click();
    await expect(page.getByTestId(`brain-model-${brainOwner.modelId}`)).toHaveAttribute(
      "aria-label",
      "UI fixture model",
    );
    await page.getByTestId(`brain-model-${brainOwner.modelId}`).click();
    expect(await brainOwner.profileContext()).toBe(8192);
  });
}

test("canceling a running benchmark releases the actual owner job and permits loading again", async ({
  page,
  brainOwner,
}, testInfo) => {
  try {
    await openBrainSettings(page, false);
    await page.getByRole("button", { name: "Open Brain", exact: true }).click();
    await page.getByRole("button", { name: "Models", exact: true }).click();
    await page.getByTestId(`brain-model-${brainOwner.modelId}`).click();
    await page.getByTestId("brain-model-load").click();
    await expect(page.getByTestId("brain-model-unload")).toBeEnabled({ timeout: 30000 });
    await page.getByRole("button", { name: "Benchmark", exact: true }).click();
    await page.getByTestId("brain-bench-run").click();
    await expect(page.getByTestId("brain-bench-cancel")).toBeVisible({ timeout: 30000 });
    await expect
      .poll(async () =>
        (await brainOwner.jobs()).jobs.map(({ operation, state, subject }) => ({
          operation,
          state,
          modelId: subject.modelId,
        })),
      )
      .toEqual([{ operation: "benchmark", state: "running", modelId: brainOwner.modelId }]);
    await page.getByTestId("brain-bench-cancel").click();
    await expect
      .poll(async () => (await brainOwner.jobs()).jobs.map((row) => row.state))
      .toEqual(["canceled"]);
    await expect(page.getByTestId("brain-bench-cancel")).toBeHidden();
    await expect(page.getByTestId("brain-bench-run")).toBeEnabled();
    await page.getByRole("button", { name: "Models", exact: true }).click();
    await page.getByTestId(`brain-model-${brainOwner.modelId}`).click();
    await page.getByTestId("brain-model-load").click();
    await expect(page.getByTestId("brain-model-unload")).toBeEnabled({ timeout: 30000 });
    await page.getByTestId("brain-model-unload").click();
    await expect(page.getByTestId("brain-model-load")).toBeEnabled({ timeout: 30000 });
  } catch (error) {
    // Capture the live owner BEFORE the fixture restores the daemon connection.
    // The later default failure screenshot can otherwise show teardown state.
    const evidence = {
      jobs: await brainOwner.jobDiagnostics().catch(() => null),
      engine: brainOwner.engineDiagnostics(),
      status: await brainOwner
        .status()
        .then((status) => ({
          instanceId: status.instanceId,
          state: status.state,
          running: status.running,
          capabilities: status.capabilities,
          residents: status.residents.map((row) => ({
            residentId: row.residentId,
            modelId: row.modelId,
            state: row.state,
          })),
        }))
        .catch(() => null),
    };
    await testInfo
      .attach("brain-cancel-owner-state", {
        body: JSON.stringify(evidence),
        contentType: "application/json",
      })
      .catch(() => {});
    await page
      .screenshot({ path: testInfo.outputPath("brain-cancel-before-teardown.png") })
      .catch(() => {});
    throw error;
  }
});
