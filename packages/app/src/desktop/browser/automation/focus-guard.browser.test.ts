import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  isBrowserAutomationEditorFocused,
  mountBrowserAutomationFocusGuard,
  withBrowserAutomationFocus,
} from "./focus-guard.web";

let host: HTMLDivElement;
let chat: HTMLTextAreaElement;
let menuItem: HTMLButtonElement;
let guest: HTMLElement;
const releaseGuards: (() => void)[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.innerHTML = `<textarea>keep typing</textarea><button>Responsive</button>
    <div tabindex="0" data-otto-browser-id="browser">Browser</div>`;
  document.body.appendChild(host);
  chat = host.querySelector("textarea")!;
  menuItem = host.querySelector("button")!;
  guest = host.querySelector("[data-otto-browser-id]")!;
  chat.focus();
});

afterEach(() => {
  releaseGuards.splice(0).forEach((release) => release());
  host.remove();
});

it("keeps chat focus and selection and does not activate the browser pane", async () => {
  const activatePane = vi.fn();
  guest.addEventListener("focus", activatePane);
  chat.setSelectionRange(2, 7);
  await withBrowserAutomationFocus("browser", async () => {
    guest.focus();
    expect(document.activeElement).toBe(chat);
    expect([chat.selectionStart, chat.selectionEnd]).toEqual([2, 7]);
  });
  expect(activatePane).not.toHaveBeenCalled();
  guest.focus();
  expect(document.activeElement).toBe(guest);
  expect(activatePane).toHaveBeenCalledOnce();
});

it("follows a control the user focuses while automation is running", async () => {
  await withBrowserAutomationFocus("browser", async () => {
    menuItem.focus();
    guest.focus();
    expect(document.activeElement).toBe(menuItem);
  });
  expect(document.activeElement).toBe(menuItem);
});

it("keeps the guard until overlapping commands finish and releases it after a failure", async () => {
  await withBrowserAutomationFocus("browser", async () => {
    await expect(
      withBrowserAutomationFocus("browser", async () => {
        guest.focus();
        throw new Error("navigation failed");
      }),
    ).rejects.toThrow("navigation failed");
    guest.focus();
    expect(document.activeElement).toBe(chat);
  });
  guest.focus();
  expect(document.activeElement).toBe(guest);
});

it("does not refocus a removed control or interfere with another browser", async () => {
  const otherGuest = document.createElement("button");
  otherGuest.setAttribute("data-otto-browser-id", "other");
  host.appendChild(otherGuest);
  await withBrowserAutomationFocus("browser", async () => {
    otherGuest.focus();
    expect(document.activeElement).toBe(otherGuest);
    otherGuest.remove();
    guest.focus();
    expect(document.activeElement).toBe(guest);
  });
});

it("allows automation of the browser that already owns focus", async () => {
  guest.focus();
  await withBrowserAutomationFocus("browser", async () => {
    guest.dispatchEvent(new Event("focus"));
    expect(document.activeElement).toBe(guest);
  });
});

it("retains editor ownership between commands and for newly attached guests", async () => {
  releaseGuards.push(mountBrowserAutomationFocusGuard());
  chat.setSelectionRange(2, 7);
  await withBrowserAutomationFocus("browser", async () => {});
  // A reply is not a fence for Electron focus IPC or a page's delayed autofocus.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  guest.focus();
  expect(document.activeElement).toBe(chat);
  const newGuest = guest.cloneNode() as HTMLElement;
  newGuest.setAttribute("data-otto-browser-id", "new-browser");
  host.appendChild(newGuest);
  newGuest.focus();
  expect(document.activeElement).toBe(chat);
  expect([chat.selectionStart, chat.selectionEnd]).toEqual([2, 7]);
  expect(isBrowserAutomationEditorFocused()).toBe(true);
});

it("lets a real user click take ownership while automation remains connected", async () => {
  releaseGuards.push(mountBrowserAutomationFocusGuard());
  await userEvent.click(guest);
  expect(document.activeElement).toBe(guest);
  expect(isBrowserAutomationEditorFocused()).toBe(false);
  await userEvent.click(chat);
  guest.focus();
  expect(document.activeElement).toBe(chat);
});

it("lets keyboard navigation enter the browser and resumes protection on returning", async () => {
  releaseGuards.push(mountBrowserAutomationFocusGuard());
  await userEvent.keyboard("{Tab}{Tab}");
  expect(document.activeElement).toBe(guest);
  await userEvent.keyboard("{Shift>}{Tab}{Tab}{/Shift}");
  expect(document.activeElement).toBe(chat);
  guest.focus();
  expect(document.activeElement).toBe(chat);
});

it("allows keyboard activation of a browser control without releasing ordinary typing", async () => {
  releaseGuards.push(mountBrowserAutomationFocusGuard());
  await userEvent.keyboard("x");
  guest.focus();
  expect(document.activeElement).toBe(chat);
  menuItem.addEventListener("click", () => guest.focus());
  menuItem.focus();
  await userEvent.keyboard("{Enter}");
  expect(document.activeElement).toBe(guest);
});

it("retains ownership until every connection unmounts and cleans up idempotently", () => {
  const first = mountBrowserAutomationFocusGuard();
  const second = mountBrowserAutomationFocusGuard();
  releaseGuards.push(first, second);
  first();
  first();
  guest.focus();
  expect(document.activeElement).toBe(chat);
  second();
  guest.focus();
  expect(document.activeElement).toBe(guest);
});
