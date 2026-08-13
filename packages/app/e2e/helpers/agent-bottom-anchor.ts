import { expect, type Page } from "@playwright/test";

const NEAR_BOTTOM_THRESHOLD_PX = 72;
const DEFAULT_SCROLL_TOLERANCE_PX = 24;

export interface ScrollMetrics {
  offsetY: number;
  contentHeight: number;
  viewportHeight: number;
  distanceFromBottom: number;
}

function getVisibleChatScroll(page: Page) {
  // Workspace tab retention can leave an inactive stream surface mounted while
  // its active sibling receives the new timeline rows. Both surfaces are
  // technically visible to Playwright during the handoff, so choosing the
  // first one made the scroll assertions measure an empty transcript and
  // report a permanent 0px scroll range. These helpers are only called after
  // a user or assistant row has rendered; bind the measurement to that
  // transcript rather than DOM order.
  return page
    .locator('[data-testid="agent-chat-scroll"]:visible')
    .filter({
      has: page.locator('[data-testid="assistant-message"], [data-testid="user-message"]'),
    })
    .first();
}

export async function readScrollMetrics(page: Page): Promise<ScrollMetrics> {
  return getVisibleChatScroll(page).evaluate((root: Element) => {
    const candidates = [root, ...Array.from(root.querySelectorAll("*"))]
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter((element) => {
        const tagName = element.tagName.toLowerCase();
        const isEditable =
          tagName === "textarea" ||
          tagName === "input" ||
          element.getAttribute("contenteditable") === "true";
        return !isEditable && element.scrollHeight - element.clientHeight > 1;
      });
    // Prefer the scrollable box that actually holds the transcript, identified
    // by containing chat messages. Ranking purely by scrollable distance let a
    // small nested scroller impersonate the chat: a ~64px task/tool card
    // holding ~800px of content out-scores a transcript that has not overflowed
    // yet. Worse, the winner could CHANGE mid-test once the transcript grew, so
    // consecutive samples described different elements and "the scroll position
    // stayed fixed" compared two unrelated boxes.
    const holdsMessages = (element: HTMLElement): boolean =>
      element.querySelector('[data-testid="assistant-message"], [data-testid="user-message"]') !==
      null;
    const byScrollableDistance = (left: HTMLElement, right: HTMLElement): number =>
      right.scrollHeight - right.clientHeight - (left.scrollHeight - left.clientHeight);
    // No fallback to "any scrollable box": before the first message renders,
    // falling back would measure the impostor card and satisfy
    // waitForScrollableChat against it, so the baseline was captured from the
    // wrong element and every later sample silently switched. Measuring the
    // root instead reports ~0 scrollable distance until the transcript itself
    // overflows, which is exactly what these specs mean to wait for.
    const scrollElement =
      candidates.filter(holdsMessages).sort(byScrollableDistance)[0] ?? (root as HTMLElement);

    const offsetY = Math.max(0, scrollElement.scrollTop);
    const contentHeight = Math.max(0, scrollElement.scrollHeight);
    const viewportHeight = Math.max(0, scrollElement.clientHeight);
    const distanceFromBottom = Math.max(0, contentHeight - (offsetY + viewportHeight));

    return {
      offsetY,
      contentHeight,
      viewportHeight,
      distanceFromBottom,
    };
  });
}

export async function expectNearBottom(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const metrics = await readScrollMetrics(page);
      return metrics.distanceFromBottom;
    })
    .toBeLessThanOrEqual(NEAR_BOTTOM_THRESHOLD_PX);
}

export async function scrollAgentChatToBottom(page: Page): Promise<void> {
  const chatScroll = getVisibleChatScroll(page);
  await chatScroll.evaluate((root: Element) => {
    const scrollElement = root as HTMLElement;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  });
  await expect
    .poll(async () =>
      chatScroll.evaluate((root: Element) => {
        const scrollElement = root as HTMLElement;
        return Math.max(
          0,
          scrollElement.scrollHeight - (scrollElement.scrollTop + scrollElement.clientHeight),
        );
      }),
    )
    .toBeLessThanOrEqual(NEAR_BOTTOM_THRESHOLD_PX);
}

/**
 * Which box `readScrollMetrics` measured, and what it passed over. "the
 * transcript never grew" is unactionable on its own: the same symptom comes
 * from a stalled stream, from measuring the non-scrollable root fallback, and
 * from a nested scroller winning the pick. Every wait below attaches this to
 * its failure so the message says which one it was.
 */
async function readScrollDiagnostics(page: Page): Promise<string> {
  const diagnostics = await getVisibleChatScroll(page).evaluate((root: Element) => {
    const describe = (element: HTMLElement, isRoot: boolean) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      testId: element.getAttribute("data-testid") ?? undefined,
      isRoot,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      holdsMessages:
        element.querySelector('[data-testid="assistant-message"], [data-testid="user-message"]') !==
        null,
    });
    const all = [root, ...Array.from(root.querySelectorAll("*"))].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    return {
      root: describe(root as HTMLElement, true),
      scrollableCandidates: all
        .filter((element) => element.scrollHeight - element.clientHeight > 1)
        .slice(0, 8)
        .map((element) => describe(element, element === root)),
      assistantMessages: root.querySelectorAll('[data-testid="assistant-message"]').length,
      userMessages: root.querySelectorAll('[data-testid="user-message"]').length,
    };
  });
  return JSON.stringify(diagnostics);
}

export async function waitForContentGrowth(
  page: Page,
  previousContentHeight: number,
  input?: { timeout?: number },
): Promise<ScrollMetrics> {
  try {
    await expect
      .poll(
        async () => {
          const metrics = await readScrollMetrics(page);
          return metrics.contentHeight;
        },
        { timeout: input?.timeout },
      )
      .toBeGreaterThan(previousContentHeight);
  } catch (error) {
    throw new Error(
      `Transcript never grew past ${previousContentHeight}px. ${await readScrollDiagnostics(page)}`,
      { cause: error },
    );
  }
  return readScrollMetrics(page);
}

export async function waitForScrollableChat(
  page: Page,
  input: { minScrollableDistance: number; timeout?: number },
): Promise<void> {
  await expect
    .poll(
      async () => {
        const metrics = await readScrollMetrics(page);
        return metrics.contentHeight - metrics.viewportHeight;
      },
      { timeout: input.timeout },
    )
    .toBeGreaterThan(input.minScrollableDistance);
}

export async function scrollChatAwayFromBottom(
  page: Page,
  input: { deltaY: number; minDistanceFromBottom: number },
): Promise<ScrollMetrics> {
  const scroll = getVisibleChatScroll(page);
  const box = await scroll.boundingBox();
  if (!box) {
    throw new Error("Agent chat scroll container is not visible");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, input.deltaY);

  await expect
    .poll(async () => {
      const metrics = await readScrollMetrics(page);
      return metrics.distanceFromBottom;
    })
    .toBeGreaterThan(input.minDistanceFromBottom);

  return readScrollMetrics(page);
}

export async function clickToolCallBesideScrollToBottomButton(page: Page): Promise<{
  outsideButton: boolean;
  toolCallReceivesPointer: boolean;
  withinButtonBand: boolean;
}> {
  await scrollChatAwayFromBottom(page, {
    deltaY: -900,
    minDistanceFromBottom: 300,
  });

  const scrollToBottomButton = page.getByRole("button", { name: "Scroll to bottom" });
  await expect(scrollToBottomButton).toBeVisible();

  const buttonBounds = await scrollToBottomButton.boundingBox();
  expect(buttonBounds, "Expected visible scroll-to-bottom button bounds").not.toBeNull();
  const visibleButtonBounds = buttonBounds!;

  // A settled transcript folds a run of tool calls into one action group, so a
  // finished stream has `action-group-badge` rows where a live one has
  // `tool-call-badge` rows. Both are tool-call rows for the purpose of this
  // check - it is about the scroll button's hit area, not about which row kind
  // happens to be beside it - and matching only the ungrouped kind is why this
  // found zero candidates on a stream the test had already waited to finish.
  const toolCalls = page.locator(
    '[data-testid="tool-call-badge"] [role="button"], [data-testid="action-group-badge"] [role="button"]',
  );
  const toolCallBounds = await Promise.all(
    Array.from({ length: await toolCalls.count() }, async (_, index) => ({
      index,
      bounds: await toolCalls.nth(index).boundingBox(),
    })),
  );
  const buttonCenterY = visibleButtonBounds.y + visibleButtonBounds.height / 2;
  const candidate = toolCallBounds
    .filter(
      (entry): entry is { index: number; bounds: NonNullable<typeof entry.bounds> } =>
        entry.bounds !== null && entry.bounds.width > 0,
    )
    .sort(
      (left, right) =>
        Math.abs(left.bounds.y + left.bounds.height / 2 - buttonCenterY) -
        Math.abs(right.bounds.y + right.bounds.height / 2 - buttonCenterY),
    )[0];
  expect(
    candidate,
    // Report the badge count separately from the interactive-child count: "no
    // tool calls in this transcript" and "badges rendered but none exposes a
    // button role" are different bugs, and the bounds array alone cannot tell
    // them apart.
    `Expected at least one rendered tool-call badge: ${JSON.stringify({
      actionGroupCount: await page.locator('[data-testid="action-group-badge"]').count(),
      badgeCount: await page.locator('[data-testid="tool-call-badge"]').count(),
      buttonBounds,
      scrollMetrics: await readScrollMetrics(page),
      toolCallBounds,
    })}`,
  ).toBeDefined();
  const visibleToolCall = candidate!;
  const initialToolCallCenterY = visibleToolCall.bounds.y + visibleToolCall.bounds.height / 2;
  await getVisibleChatScroll(page).evaluate((scroll, deltaY) => {
    (scroll as HTMLElement).scrollTop += deltaY;
  }, initialToolCallCenterY - buttonCenterY);

  const alignedToolCall = toolCalls.nth(visibleToolCall.index);
  await expect
    .poll(async () => {
      const [currentButtonBounds, currentToolCallBounds] = await Promise.all([
        scrollToBottomButton.boundingBox(),
        alignedToolCall.boundingBox(),
      ]);
      if (!currentButtonBounds || !currentToolCallBounds) {
        return false;
      }
      const toolCallCenterY = currentToolCallBounds.y + currentToolCallBounds.height / 2;
      return (
        toolCallCenterY >= currentButtonBounds.y &&
        toolCallCenterY <= currentButtonBounds.y + currentButtonBounds.height
      );
    })
    .toBe(true);

  const [alignedButtonBounds, visibleToolCallBounds] = await Promise.all([
    scrollToBottomButton.boundingBox(),
    alignedToolCall.boundingBox(),
  ]);
  expect(alignedButtonBounds, "Expected scroll-to-bottom button to remain visible").not.toBeNull();
  expect(
    visibleToolCallBounds,
    "Expected aligned tool-call badge to remain visible",
  ).not.toBeNull();
  const finalButtonBounds = alignedButtonBounds!;
  const finalToolCallBounds = visibleToolCallBounds!;

  const clickPoint = {
    x: finalToolCallBounds.x + 24,
    y: finalToolCallBounds.y + finalToolCallBounds.height / 2,
  };
  const toolCallReceivesPointer = await alignedToolCall.evaluate((toolCall, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return hit !== null && toolCall.contains(hit);
  }, clickPoint);
  const hitArea = {
    clickPoint,
    outsideButton:
      clickPoint.x < finalButtonBounds.x ||
      clickPoint.x > finalButtonBounds.x + finalButtonBounds.width,
    toolCallReceivesPointer,
    withinButtonBand:
      clickPoint.y >= finalButtonBounds.y &&
      clickPoint.y <= finalButtonBounds.y + finalButtonBounds.height,
  };
  await page.mouse.click(hitArea.clickPoint.x, hitArea.clickPoint.y);
  return {
    outsideButton: hitArea.outsideButton,
    toolCallReceivesPointer: hitArea.toolCallReceivesPointer,
    withinButtonBand: hitArea.withinButtonBand,
  };
}

export async function expectScrollStaysFixed(
  page: Page,
  baseline: ScrollMetrics,
  input?: { durationMs?: number; sampleIntervalMs?: number; tolerancePx?: number },
): Promise<void> {
  const durationMs = input?.durationMs ?? 2_000;
  const sampleIntervalMs = input?.sampleIntervalMs ?? 250;
  const tolerancePx = input?.tolerancePx ?? DEFAULT_SCROLL_TOLERANCE_PX;
  const samples: Array<{ elapsedMs: number; offsetY: number; contentHeight: number }> = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    await page.waitForTimeout(sampleIntervalMs);
    const metrics = await readScrollMetrics(page);
    samples.push({
      elapsedMs: Date.now() - startedAt,
      offsetY: metrics.offsetY,
      contentHeight: metrics.contentHeight,
    });
    expect(
      metrics.offsetY,
      JSON.stringify({ baseline, samples: samples.slice(-12) }),
    ).toBeLessThanOrEqual(baseline.offsetY + tolerancePx);
  }
}
