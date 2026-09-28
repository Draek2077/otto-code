import { describe, expect, test } from "vitest";
import { browserErrorText, isErrorPageUrl, isPageLoadFailure } from "./page-load-errors.js";

const ESCAPE = String.fromCharCode(27);

function timeout(): Error {
  const error = new Error("page.goto: Timeout 20000ms exceeded.");
  error.name = "TimeoutError";
  return error;
}

describe("hosted page load errors", () => {
  test("a page that would not load is left to the page to report", () => {
    expect(
      isPageLoadFailure(
        new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3001/"),
      ),
    ).toBe(true);
    expect(isPageLoadFailure(new Error("page.reload: net::ERR_NAME_NOT_RESOLVED"))).toBe(true);
    expect(isPageLoadFailure(timeout())).toBe(true);
  });

  test("a failure of the host or the stream is still reported", () => {
    expect(isPageLoadFailure(new Error("Target page, context or browser has been closed"))).toBe(
      false,
    );
    expect(isPageLoadFailure(new Error("Only HTTP and HTTPS pages can be opened."))).toBe(false);
    expect(isPageLoadFailure("net::ERR_FAILED")).toBe(false);
  });

  test("a reported error loses its call log and colour codes", () => {
    const raw =
      "page.goto: Target closed\nCall log:\n" +
      `${ESCAPE}[2m  - navigating to "http://localhost:3001/"${ESCAPE}[22m`;
    expect(browserErrorText(new Error(raw))).toBe("page.goto: Target closed");
    expect(browserErrorText(new Error(`${ESCAPE}[31mfailed${ESCAPE}[39m`))).toBe("failed");
    expect(browserErrorText("plain")).toBe("plain");
  });

  test("recognises the address of Chromium's error page", () => {
    expect(isErrorPageUrl("chrome-error://chromewebdata/")).toBe(true);
    expect(isErrorPageUrl("http://localhost:3001/")).toBe(false);
  });
});
