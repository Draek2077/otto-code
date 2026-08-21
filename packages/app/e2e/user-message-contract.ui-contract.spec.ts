import { expect, test, type Page } from "./fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import {
  composerLocator,
  expectComposerEditable,
  expectComposerVisible,
  fillComposerDraft,
  submitMessage,
} from "./helpers/composer";

async function expectUserMessageCount(page: Page, expected: number): Promise<void> {
  await expect(page.getByTestId("user-message")).toHaveCount(expected, { timeout: 15_000 });
}

function readClipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function expectIdleComposer(page: Page): Promise<void> {
  await expectComposerEditable(page);
  await expect(page.getByRole("button", { name: /stop|cancel/i })).toHaveCount(0, {
    timeout: 15_000,
  });
}

async function expectNoLoadingRegressionAfterIdle(page: Page): Promise<void> {
  await expectIdleComposer(page);
  await page.waitForTimeout(1_000);
  await expectIdleComposer(page);
}

test.describe("User message UI contract", () => {
  test("dedupes mock provider user_message echoes across multi-turn sends", async ({ page }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "user-message-contract-e2e-",
      title: "User message contract e2e",
    });
    const prompts = [
      "emit 1 coalesced agent stream updates for user message contract turn one.",
      "emit 1 coalesced agent stream updates for user message contract turn two.",
      "emit 1 coalesced agent stream updates for user message contract turn three.",
    ];

    try {
      await openAgentRoute(page, session);
      await expectComposerVisible(page);

      for (let index = 0; index < prompts.length; index += 1) {
        const prompt = prompts[index]!;
        await submitMessage(page, prompt);
        await expect(page.getByText(prompt, { exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("stress-update-0", { exact: true }).first()).toBeVisible({
          timeout: 15_000,
        });
        await expectUserMessageCount(page, index + 1);
        await expectNoLoadingRegressionAfterIdle(page);
      }

      await fillComposerDraft(page, "append");
      await composerLocator(page).evaluate((element) => element.blur());
      await expectUserMessageCount(page, 3);
      await expectIdleComposer(page);
    } finally {
      await session.cleanup();
    }
  });

  test("renders prompt markdown as a code block while copy keeps the raw text", async ({
    context,
    page,
  }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "user-message-markdown-e2e-",
      title: "User message markdown e2e",
    });
    // A quoted path plus a tagged fence: the two halves of "render my prompt
    // like the agent's reply". Typed, not picked - picking a file now attaches a
    // pill instead of inserting quoted text - but the rendering contract for a
    // quoted path someone typed themselves is unchanged.
    const prompt = [
      'Guard "src/user-message-e2e.ts" before it ships.',
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n");

    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await openAgentRoute(page, session);
      await expectComposerVisible(page);

      await submitMessage(page, prompt);
      const bubble = page.getByTestId("user-message").first();
      await expect(bubble).toBeVisible({ timeout: 15_000 });

      // The fence renders as a real code surface, not literal backticks.
      await expect(
        bubble.locator("[data-pmono]").filter({ hasText: "const answer = 42;" }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(bubble).not.toContainText("```");

      // Straight quotes survive: the user parser runs with typographer off, so a
      // quoted mention is never redrawn as curly quotes nobody typed.
      const rendered = await bubble.innerText();
      expect(rendered).toContain('"src/user-message-e2e.ts"');
      expect(rendered).not.toContain("\u201C");
      expect(rendered).not.toContain("\u201D");

      // Display is not the message. Copy still yields the exact typed string.
      await bubble.getByRole("button", { name: "Copy message" }).click();
      await expect.poll(() => readClipboardText(page), { timeout: 10_000 }).toBe(prompt);
    } finally {
      await session.cleanup();
    }
  });
});
