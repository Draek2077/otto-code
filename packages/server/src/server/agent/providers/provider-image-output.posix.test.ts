import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { withTemporaryOttoHome } from "../../../test-utils/temp-otto-home.js";
import { materializeProviderImage } from "./provider-image-output.js";

describe.skipIf(process.platform === "win32")("materializeProviderImage", () => {
  // Images land under $OTTO_HOME now, so the suite has to own one - otherwise a
  // test run writes into (and this test's cleanup deletes from) the developer's
  // real ~/.otto.
  const getOttoHome = withTemporaryOttoHome("otto-home-image-posix-test");

  test("writes image attachments under a private directory", () => {
    const materialized = materializeProviderImage({
      data: "YWJjMTIz",
      mimeType: "image/png",
    });
    const attachmentDir = path.dirname(materialized.path);

    expect(attachmentDir).toBe(path.join(getOttoHome(), "attachments"));
    expect(existsSync(materialized.path)).toBe(true);
    expect(statSync(attachmentDir).mode & 0o777).toBe(0o700);
    expect(statSync(materialized.path).mode & 0o777).toBe(0o600);
  });
});
