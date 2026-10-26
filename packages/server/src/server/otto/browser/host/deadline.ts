import { createBrowserToolsRequestError } from "../../../browser-tools/errors.js";
/** Page evaluation has no Playwright timeout. A deadline closes only this owned page, without retries. */
export async function hostBrowserDeadline<T>(
  operation: () => Promise<T>,
  closePage: () => Promise<void>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void closePage().catch(() => {});
      reject(
        createBrowserToolsRequestError({
          code: "browser_timeout",
          message:
            "This Host Browser operation exceeded its deadline. The owned page is being closed; reopen it explicitly before continuing.",
        }),
      );
    }, milliseconds);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
