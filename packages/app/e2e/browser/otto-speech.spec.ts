import { test, expect } from "../support/helpers/otto-provider-settings";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { createSpeechHttpFixture } from "../support/helpers/otto-speech";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readSpeech, saveSpeech, type SpeechSnapshot } from "@getpaseo/plugin/otto/speech";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";

test.use({
  e2eDaemonConfig: {
    pluginsEnabled: true,
    features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
  },
  e2eDaemonEnvironment: { PASEO_E2E_MANAGED_SPEECH: "1" },
});
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(30000);
});
for (const compact of [false, true]) {
  test(`Speech host settings, real playback, failure and stale-save recovery (${compact ? "compact" : "wide"})`, async ({
    page,
    e2eWorker,
  }, testInfo) => {
    void e2eWorker;
    test.setTimeout(120000);
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await createSpeechHttpFixture();
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "otto-speech-ui" });
    const hostId = getServerId();
    const read = async () =>
      readSpeech.output.parse(
        await client.invokePluginRpc("otto-speech", readSpeech.name, { hostId }),
      );
    const write = async (current: SpeechSnapshot, settings: SpeechSnapshot["settings"]) =>
      saveSpeech.output.parse(
        await client.invokePluginRpc("otto-speech", saveSpeech.name, {
          hostId,
          expectedRevision: current.revision,
          settings,
          credentials: { stt: { kind: "keep" }, tts: { kind: "keep" } },
        }),
      );
    try {
      const initial = await read();
      const settings = structuredClone(initial.settings);
      settings.dictation.enabled = false;
      settings.voice = {
        enabled: true,
        turnDetection: "openai",
        stt: { provider: "openai", model: "whisper-1", language: "en" },
        tts: { provider: "openai", model: "FixtureModel", voice: "FixtureVoice", speed: 1 },
      };
      settings.openai = { sttBaseUrl: fixture.url, ttsBaseUrl: fixture.url };
      await client.invokePluginRpc("otto-speech", saveSpeech.name, {
        hostId,
        expectedRevision: initial.revision,
        settings,
        credentials: {
          stt: { kind: "replace", value: "isolated-stt-fixture-key" },
          tts: { kind: "replace", value: "isolated-tts-fixture-key" },
        },
      });
      await expect.poll(async () => (await read()).readiness.tts.available).toBe(true);
      expect((await read()).settings.voice.tts).toEqual(settings.voice.tts);
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page.locator('[data-testid="sidebar-settings"]:visible').first().click();
      } else await openSettings(page);
      await page.getByTestId("settings-host-section-plugins").click();
      await page.getByRole("button", { name: "Configure Speech", exact: true }).click();
      await expect(page.getByText("Text to speech", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Speech model", exact: true })).toHaveValue(
        "FixtureModel",
      );
      const speed = page.getByRole("textbox", { name: "Speaking speed", exact: true });
      await speed.fill("0.75");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Voice: FixtureVoice", exact: true }).click();
      await page.getByText("alloy", { exact: true }).last().click();
      await expect(page.getByRole("textbox", { name: "Custom voice ID", exact: true })).toHaveValue(
        "alloy",
      );
      await expect(page.getByRole("textbox", { name: "Speech model", exact: true })).toHaveValue(
        "FixtureModel",
      );
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Speech settings saved.", { exact: true })).toBeVisible();
      await expect
        .poll(async () => (await read()).settings.voice.tts)
        .toEqual({ provider: "openai", model: "FixtureModel", voice: "alloy", speed: 0.75 });
      await page.getByRole("button", { name: "Preview voice", exact: true }).click();
      await expect.poll(() => fixture.requests.length).toBe(1);
      expect(fixture.requests[0]).toMatchObject({
        model: "FixtureModel",
        voice: "alloy",
        speed: 0.75,
      });
      await expect(page.getByText("Playing preview…", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Stop preview", exact: true }).click();
      await expect(page.getByRole("button", { name: "Preview voice", exact: true })).toBeVisible();
      fixture.failNext();
      await page.getByRole("button", { name: "Preview voice", exact: true }).click();
      await expect(
        page.getByText(/Speech playback failed\. Check the host speech settings/),
      ).toBeVisible();
      await page.getByRole("button", { name: "Preview voice", exact: true }).click();
      await expect.poll(() => fixture.requests.length).toBe(3);
      await expect(
        page.getByText(/Speech playback failed\. Check the host speech settings/),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Stop preview", exact: true }).click();
      await speed.fill("0.8");
      const peer = await read();
      const changed = structuredClone(peer.settings);
      changed.voice.tts.speed = 1.2;
      await write(peer, changed);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText(/Your edits are retained\. Reload saved settings/)).toBeVisible();
      await expect(speed).toHaveValue("0.8");
      expect((await read()).settings.voice.tts.speed).toBe(1.2);
      page.once("dialog", (dialog) => void dialog.dismiss());
      await page.getByRole("button", { name: "Reload saved", exact: true }).click();
      await expect(speed).toHaveValue("0.8");
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Reload saved", exact: true }).click();
      await expect(speed).toHaveValue("1.2");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(await page.locator("body").innerText()).not.toContain("isolated-tts-fixture-key");
      await testInfo.attach(`Speech ${compact ? "compact" : "wide"}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    } catch (error) {
      await read()
        .then((snapshot) =>
          testInfo.attach("Speech host snapshot", {
            body: JSON.stringify(snapshot),
            contentType: "application/json",
          }),
        )
        .catch(() => undefined);
      throw error;
    } finally {
      try {
        await client.close();
      } finally {
        await fixture.close();
      }
    }
  });
}

for (const compact of [false, true]) {
  test(`Speech reads a settled reply and new chat replies without replaying history (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
    test.setTimeout(120000);
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await createSpeechHttpFixture();
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "otto-speech-chat" });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-speech-",
      title: "Speech",
      git: false,
    });
    try {
      const hostId = getServerId();
      const initial = readSpeech.output.parse(
        await client.invokePluginRpc("otto-speech", readSpeech.name, { hostId }),
      );
      const settings = structuredClone(initial.settings);
      settings.dictation.enabled = false;
      settings.voice = {
        enabled: true,
        turnDetection: "openai",
        stt: { provider: "openai", model: "whisper-1", language: "en" },
        tts: { provider: "openai", model: "FixtureModel", voice: "FixtureVoice", speed: 1 },
      };
      settings.openai = { sttBaseUrl: fixture.url, ttsBaseUrl: fixture.url };
      await client.invokePluginRpc("otto-speech", saveSpeech.name, {
        hostId,
        expectedRevision: initial.revision,
        settings,
        credentials: {
          stt: { kind: "replace", value: "isolated-fixture" },
          tts: { kind: "replace", value: "isolated-fixture" },
        },
      });
      await expect
        .poll(
          async () =>
            readSpeech.output.parse(
              await client.invokePluginRpc("otto-speech", readSpeech.name, { hostId }),
            ).readiness.tts.available,
        )
        .toBe(true);
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page.locator('[data-testid="sidebar-settings"]:visible').first().click();
      } else await openSettings(page);
      await page.getByTestId("settings-host-section-plugins").click();
      await page.getByRole("button", { name: "Configure Speech", exact: true }).click();
      await page.getByText("Agent voice cues", { exact: true }).click();
      await page.getByRole("switch", { name: "Spoken activity cues", exact: true }).click();
      await expect(
        page.getByRole("switch", { name: "Spoken activity cues", exact: true }),
      ).not.toBeChecked();
      ottoProvider.replyWith(() => "The first reply is ready to read.");
      await ottoProvider.refreshCatalog();
      const agent = await workspace.client.createAgent({
        provider: "openai-compatible",
        model: "fixture",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        initialPrompt: "Say the first reply.",
        title: "Read aloud",
      });
      await workspace.client.waitForFinish(agent.id, 20000);
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      const read = page
        .getByRole("button", { name: "Read aloud", exact: true })
        .filter({ visible: true });
      await expect(read).toHaveCount(1);
      expect(fixture.requests).toHaveLength(0);
      await read.click();
      await expect.poll(() => fixture.requests.length).toBe(1);
      expect(fixture.requests[0]).toMatchObject({ input: "The first reply is ready to read." });
      await expect(page.getByRole("button", { name: "Stop reading", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Stop reading", exact: true }).click();
      await page
        .getByRole("button", { name: "Read new replies in this chat", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Stop automatic reading in this chat", exact: true }),
      ).toBeVisible();
      ottoProvider.replyWith(() => "This new reply is read automatically.");
      const composer = page
        .getByRole("textbox", { name: "Message agent...", exact: true })
        .filter({ visible: true });
      await composer.fill("Say the next reply.");
      await composer.press("Enter");
      await expect
        .poll(
          () =>
            fixture.requests.some(
              (request) => request.input === "This new reply is read automatically.",
            ),
          { timeout: 20000 },
        )
        .toBe(true);
      await expect(page.getByRole("button", { name: "Stop reading", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Stop reading", exact: true }).click();
      const count = fixture.requests.length;
      await page.reload();
      await expect(read).toHaveCount(2);
      await expect(
        page.getByRole("button", { name: "Stop automatic reading in this chat", exact: true }),
      ).toBeVisible();
      expect(fixture.requests).toHaveLength(count);
      await testInfo.attach(`Speech chat ${compact ? "compact" : "wide"}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    } finally {
      await workspace.cleanup();
      await client.close();
      await fixture.close();
    }
  });
}
