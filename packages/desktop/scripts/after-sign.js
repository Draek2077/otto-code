const path = require("node:path");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");

const EXECUTABLE_NAME = "Otto"; // OTTO(identity)

exports.default = async function afterSign(context) {
  if (process.env.PASEO_DESKTOP_SMOKE !== "1") {
    return;
  }

  if (context.electronPlatformName !== "darwin") {
    return;
  }

  await smokePackagedDesktopApp({
    appPath: path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`),
  });
};
