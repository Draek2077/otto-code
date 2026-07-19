import { test, expect } from "./fixtures";
import { awaitAssistantMessage, expectAgentIdle } from "./helpers/agent-stream";
import { startRunningMockAgent } from "./helpers/composer";

// Agent chat output renders markdown correctly. The mock provider's default
// cycle stream (packages/server/src/server/agent/providers/mock-load-test-agent.ts)
// deterministically contains a "## Cycle 1" heading, a four-item bullet list,
// inline code (`onContentSizeChange`), and a closing italic marker — assert
// those render as real markdown structures, plus the spacing-rhythm rule from
// docs: containers add no margin, the markdown paragraph owns the 12px gap
// (styles/markdown-styles.ts paragraph.marginBottom = theme.spacing[3] = 12).
//
// Descoped: fenced code blocks — the mock provider's fixed script emits no
// markdown fence (its diffs travel as tool_call payloads, not markdown), and
// the provider has no free-text echo mode, so a fence cannot be produced
// deterministically without modifying server source.

test.describe("Chat markdown rendering", () => {
  test("mock stream renders heading, list, inline code, and clean spacing rhythm", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "chat-md-",
      model: "ten-second-stream",
      prompt: "Render the standard markdown stream.",
    });
    try {
      await awaitAssistantMessage(page);
      // Let the stream finish so the full first cycle (heading, list, inline
      // code, closing italics) is rendered and stable.
      await expectAgentIdle(page, 45_000);

      // The mock emits one assistant message per cycle; the end-of-stream
      // marker lands in the final message. Gate completion on the last message,
      // then assert the markdown on the first (the "Cycle 1" block).
      await expect(page.getByTestId("assistant-message").last()).toContainText(
        "(end of synthetic stream)",
        { timeout: 30_000 },
      );
      const message = page.getByTestId("assistant-message").first();

      // Heading: "## Cycle 1" is differentiated from body prose by weight
      // (Otto's chat markdown uses uniform sizing with heavier headings), so
      // the heading is at least as large and clearly bolder than body text.
      const heading = page.getByText("Cycle 1", { exact: true }).first();
      await expect(heading).toBeVisible({ timeout: 30_000 });
      const bodyText = page
        .getByText("walking through how the conversation list currently handles", { exact: false })
        .first();
      await expect(bodyText).toBeVisible();
      const headingFontSize = await heading.evaluate((element) =>
        Number.parseFloat(window.getComputedStyle(element).fontSize),
      );
      const headingFontWeight = await heading.evaluate((element) =>
        Number.parseInt(window.getComputedStyle(element).fontWeight, 10),
      );
      const bodyFontSize = await bodyText.evaluate((element) =>
        Number.parseFloat(window.getComputedStyle(element).fontSize),
      );
      expect(headingFontSize).toBeGreaterThanOrEqual(bodyFontSize);
      expect(headingFontWeight).toBeGreaterThanOrEqual(600);

      // Bullet list: the four "- " items render as rows with a bullet marker.
      await expect(
        page.getByText("is hardcoded at 80px, which feels too tight", { exact: false }).first(),
      ).toBeVisible();
      await expect(
        page
          .getByText("does not pause scroll-to-bottom while the user is actively dragging", {
            exact: false,
          })
          .first(),
      ).toBeVisible();
      await expect(page.getByText("•", { exact: true }).first()).toBeVisible();

      // Inline code keeps its monospace code surface (data-pmono marks code
      // surfaces, see styles/code-surface.ts).
      await expect(
        page.locator("[data-pmono]").filter({ hasText: "onContentSizeChange" }).first(),
      ).toBeVisible();

      // Spacing rhythm: walking up from a paragraph's text to the message
      // root, exactly one ancestor carries vertical margin — the markdown
      // paragraph itself, at 12px. Containers add none.
      const midParagraphText = page
        .getByText("Now I have a clearer picture", { exact: false })
        .first();
      await expect(midParagraphText).toBeVisible();
      const marginChain = await midParagraphText.evaluate((element) => {
        const root = element.closest('[data-testid="assistant-message"]');
        if (!root) {
          throw new Error("assistant-message root not found above paragraph text");
        }
        const chain: number[] = [];
        let node = element.parentElement;
        while (node && node !== root) {
          const style = window.getComputedStyle(node);
          const marginTop = Number.parseFloat(style.marginTop) || 0;
          const marginBottom = Number.parseFloat(style.marginBottom) || 0;
          chain.push(marginTop + marginBottom);
          node = node.parentElement;
        }
        return chain;
      });
      expect(marginChain.filter((margin) => margin !== 0)).toEqual([12]);

      // The assistant message container itself spaces with padding, never margin.
      const rootMargins = await message.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return [style.marginTop, style.marginBottom];
      });
      expect(rootMargins).toEqual(["0px", "0px"]);
    } finally {
      await agent.cleanup();
    }
  });
});
