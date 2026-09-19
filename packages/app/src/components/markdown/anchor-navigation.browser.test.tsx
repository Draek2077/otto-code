import React, { act, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScrollView, Text, View } from "react-native";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownAnchorLandingHighlight } from "./anchor-targets";
import { createMarkdownDocumentAnnotationRules, MarkdownRenderer } from "./renderer";
import { useMarkdownAnchorNavigation } from "./use-markdown-anchor-navigation";

// Imports react-native's ToastAndroid, which react-native-web does not export;
// nothing here raises a toast.
vi.mock("@/components/toast-host", () => ({
  useToastHost: () => ({}),
  ToastViewport: () => null,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

// A route-os-shaped document: a long requirements table whose rows carry
// explicit anchors, a heading far below it, and an anchor in running text.
const rows = Array.from({ length: 60 }, (_, index) => {
  const id = `ros-ac-${index + 1}`;
  return `| ROS-AC-${index + 1} | <a id="${id}"></a>Criterion ${index + 1} text | Evidence |`;
});
const body = [
  "# Verification",
  "",
  "| ID | Criterion | Evidence |",
  "| --- | --- | --- |",
  ...rows,
  "",
  ...Array.from({ length: 40 }, (_, index) => `Filler paragraph ${index + 1}.\n`),
  '<span id="inline-target"></span>Inline target paragraph.',
  "",
  ...Array.from({ length: 20 }, (_, index) => `More filler ${index + 1}.\n`),
  "## FP-02 Durable messaging and controlled scale",
  "",
  "Heading body.",
  "",
  ...Array.from({ length: 40 }, (_, index) => `Trailing filler ${index + 1}.\n`),
].join("\n");

const SCROLL_STYLE = { height: 300 };

function Reader({
  fragment,
  revision,
  lateContentHeight = 0,
}: {
  fragment: string | null;
  revision: number;
  lateContentHeight?: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const navigation = useMarkdownAnchorNavigation({
    body,
    fragment,
    navigationRevision: revision,
    scrollRef,
    contentRef,
  });
  const lateContentStyle = useMemo(() => ({ height: lateContentHeight }), [lateContentHeight]);
  const rules = useMemo(
    () =>
      createMarkdownDocumentAnnotationRules({
        text: body,
        anchorTargets: navigation.anchorTargets,
      }),
    [navigation.anchorTargets],
  );
  return (
    <ScrollView
      ref={scrollRef}
      testID="reader"
      style={SCROLL_STYLE}
      onContentSizeChange={navigation.handleContentSizeChange}
    >
      <View ref={contentRef}>
        {navigation.anchorMissing ? <Text testID="anchor-missing">missing</Text> : null}
        {/* Stands in for an image or diagram above the target that lays out late. */}
        <View style={lateContentStyle} />
        <MarkdownRenderer text={body} rules={rules} remoteImages="altText" htmlAnchors />
        {navigation.landing ? (
          <MarkdownAnchorLandingHighlight landing={navigation.landing} animated={false} />
        ) : null}
      </View>
    </ScrollView>
  );
}

let root: Root;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function render(fragment: string | null, revision = 0, lateContentHeight = 0) {
  act(() =>
    root.render(
      <Reader fragment={fragment} revision={revision} lateContentHeight={lateContentHeight} />,
    ),
  );
}

function mount(fragment: string | null, revision = 0) {
  container = document.createElement("div");
  container.style.cssText = "position:fixed;left:0;top:0;width:640px;height:300px";
  document.body.appendChild(container);
  root = createRoot(container);
  render(fragment, revision);
}

function reader(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-testid="reader"]')!;
}

function elementWithText(text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>("*")).find(
    (element) => element.childElementCount === 0 && element.textContent === text,
  );
  if (!match) throw new Error(`No element with text ${text}`);
  return match;
}

/** Where `text` sits relative to the top of the reader's viewport. */
function offsetInReader(text: string): number {
  return elementWithText(text).getBoundingClientRect().top - reader().getBoundingClientRect().top;
}

async function expectLandedOn(text: string) {
  await expect.poll(() => offsetInReader(text), { timeout: 3000 }).toBeGreaterThanOrEqual(-1);
  await expect.poll(() => offsetInReader(text), { timeout: 3000 }).toBeLessThan(40);
}

function landingHighlight(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="markdown-anchor-landing"]');
}

it("scrolls to an explicit anchor inside a table cell and highlights its row", async () => {
  mount("ros-ac-40");
  await expectLandedOn("Criterion 40 text");
  expect(reader().scrollTop).toBeGreaterThan(0);

  await expect.poll(() => landingHighlight()).not.toBeNull();
  const band = landingHighlight()!.getBoundingClientRect();
  const row = elementWithText("Criterion 40 text").getBoundingClientRect();
  expect(band.top).toBeLessThanOrEqual(row.top + 1);
  expect(band.bottom).toBeGreaterThanOrEqual(row.bottom - 1);
});

it("never renders the anchor as HTML or leaks its markup as text", async () => {
  mount(null);
  await expect.poll(() => container.textContent).toContain("Criterion 18 text");
  expect(container.textContent).not.toContain("<a");
  expect(container.querySelector("a[id], a[name], [id^='ros-ac']")).toBeNull();
});

it("scrolls to a heading slug and to an anchor in running text", async () => {
  mount("fp-02-durable-messaging-and-controlled-scale");
  await expectLandedOn("FP-02 Durable messaging and controlled scale");

  render("inline-target", 1);
  await expectLandedOn("Inline target paragraph.");
});

it("lands again when the same link is followed after scrolling away", async () => {
  mount("ros-ac-25");
  await expectLandedOn("Criterion 25 text");

  act(() => {
    reader().scrollTop = 0;
  });
  await expect.poll(() => reader().scrollTop).toBe(0);

  render("ros-ac-25", 1);
  await expectLandedOn("Criterion 25 text");
});

it("reports a missing target instead of scrolling", async () => {
  mount("ros-ac-99");
  await expect.poll(() => container.querySelector('[data-testid="anchor-missing"]')).not.toBeNull();
  expect(reader().scrollTop).toBe(0);
  expect(landingHighlight()).toBeNull();
});

it("keeps the target and its highlight together when content above lays out late", async () => {
  mount("ros-ac-30");
  await expectLandedOn("Criterion 30 text");
  await expect.poll(() => landingHighlight()).not.toBeNull();

  render("ros-ac-30", 0, 600);
  await expectLandedOn("Criterion 30 text");
  await expect
    .poll(() => {
      const band = landingHighlight()?.getBoundingClientRect();
      const row = elementWithText("Criterion 30 text").getBoundingClientRect();
      return band ? Math.abs(band.top - row.top) < 20 : false;
    })
    .toBe(true);
});
