import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

async function ownedDisplay(inspectorPort) {
  const [target] = await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error("Private Electron display lookup timed out")), 10000);
      socket.addEventListener("error", reject, { once: true });
      socket.addEventListener("message", ({ data }) => {
        const response = JSON.parse(data);
        if (response.id !== 1) return;
        const environment = response.result?.result?.value;
        if (
          response.error ||
          response.result?.exceptionDetails ||
          typeof environment?.display !== "string" ||
          !/^:\d+(?:\.\d+)?$/.test(environment.display) ||
          typeof environment.authority !== "string" ||
          !path.isAbsolute(environment.authority) ||
          environment.authority.includes("\0")
        )
          reject(Error("Missing private Xvfb display authorization"));
        else resolve({ DISPLAY: environment.display, XAUTHORITY: environment.authority });
      });
      socket.addEventListener(
        "open",
        () =>
          socket.send(
            JSON.stringify({
              id: 1,
              method: "Runtime.evaluate",
              params: {
                expression: "({ display: process.env.DISPLAY, authority: process.env.XAUTHORITY })",
                returnByValue: true,
              },
            }),
          ),
        { once: true },
      );
    });
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}
async function answerOwnedDialog(displayEnvironment, key) {
  // This display belongs to the Electron process just launched by this test, never the user's desktop.
  const env = { ...process.env, ...displayEnvironment };
  let windowId;
  await expect
    .poll(
      () => {
        try {
          windowId = execFileSync(
            "xdotool",
            ["search", "--onlyvisible", "--name", "Clear browsing history"],
            { env, encoding: "utf8" },
          )
            .trim()
            .split("\n")
            .at(-1);
          return /^\d+$/.test(windowId ?? "");
        } catch {
          return false;
        }
      },
      { timeout: 10000 },
    )
    .toBe(true);
  execFileSync("xdotool", ["windowfocus", "--sync", windowId, "key", key], { env });
}
async function openClear(page) {
  await page.getByTestId("browser-more-actions").filter({ visible: true }).click();
  await page.getByTestId("browser-history-clear").click();
}
export async function runBrowserHistoryRegression({
  page,
  execute,
  browserId,
  targetUrl,
  home,
  projectId,
  inspectorPort,
  artifactDir,
}) {
  if (process.platform !== "linux")
    throw Error("Native history dialog acceptance requires the CI-owned Linux/Xvfb lane.");
  const display = await ownedDisplay(inspectorPort);
  const visited = new URL(targetUrl);
  visited.searchParams.set("history-proof", "otto-owned-visit");
  const url = visited.href;
  const file = path.join(
    home,
    "browser-history",
    createHash("sha256").update(projectId).digest("hex") + ".json",
  );
  await execute("browser_navigate", { browserId, url });
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await readFile(file, "utf8")).some((entry) => entry.url === url);
        } catch {
          return false;
        }
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await execute("browser_evaluate", {
    browserId,
    function:
      "() => { document.cookie = 'otto_history_fixture=retained; SameSite=Lax; path=/'; return document.cookie.includes('otto_history_fixture=retained'); }",
  });
  const address = page.getByLabel("Browser URL", { exact: true }).filter({ visible: true });
  await address.fill("history-proof");
  const list = page.getByRole("listbox", { name: "Browsing history" });
  await expect(list).toBeVisible();
  await expect(list.getByText(url, { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifactDir, "otto-history-suggestions.png") });
  const previousVisit = JSON.parse(await readFile(file, "utf8")).find(
    (entry) => entry.url === url,
  )?.visitedAt;
  await address.press("ArrowDown");
  await address.press("Enter");
  await expect(address).toHaveValue(url);
  await expect(list).toBeHidden();
  // Wait for the real visit write, not just the immediate address draft, before
  // replacing this test-owned file to exercise failure recovery.
  await expect
    .poll(
      async () => {
        const entry = JSON.parse(await readFile(file, "utf8")).find((item) => item.url === url);
        return Boolean(entry && entry.visitedAt !== previousVisit);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await openClear(page);
  await answerOwnedDialog(display, "Escape");
  expect(JSON.parse(await readFile(file, "utf8")).some((entry) => entry.url === url)).toBe(true);
  await page.keyboard.press("Escape");
  const original = await readFile(file, "utf8");
  const corrupt = "invalid-history-fixture";
  try {
    await writeFile(file, corrupt);
    await openClear(page);
    await answerOwnedDialog(display, "Return");
    const feedback = page.getByTestId("browser-history-feedback");
    await expect(feedback).toContainText("Could not clear browsing history");
    expect(await readFile(file, "utf8")).toBe(corrupt);
    await page.screenshot({ path: path.join(artifactDir, "otto-history-clear-error.png") });
    await writeFile(file, original);
    await page.keyboard.press("Escape");
    await openClear(page);
    await answerOwnedDialog(display, "Return");
    await expect(feedback).toContainText("Browsing history cleared.");
    await expect.poll(async () => JSON.parse(await readFile(file, "utf8"))).toEqual([]);
    const cookie = await execute("browser_evaluate", {
      browserId,
      function: "() => document.cookie.includes('otto_history_fixture=retained')",
    });
    expect(JSON.parse(cookie.resultJson)).toBe(true);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: path.join(artifactDir, "otto-history-cleared.png") });
    return {
      suggestions: "passed",
      nativeConfirmation: "passed",
      preservedOnFailure: "passed",
      explicitRetry: "passed",
      cookiesRetained: "passed",
    };
  } finally {
    if ((await readFile(file, "utf8")) === corrupt) await writeFile(file, original);
  }
}
