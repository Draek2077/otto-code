import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withBrowserAutomationFocus } from "./focus-guard.web";

let host: HTMLDivElement;
let chat: HTMLTextAreaElement;
let menuItem: HTMLButtonElement;
let guest: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  host.innerHTML = `<textarea>keep typing</textarea><button>Responsive</button>
    <div tabindex="0" data-otto-browser-id="browser"></div>`;
  document.body.appendChild(host);
  chat = host.querySelector("textarea")!;
  menuItem = host.querySelector("button")!;
  guest = host.querySelector("[data-otto-browser-id]")!;
  chat.focus();
});

afterEach(() => host.remove());

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
