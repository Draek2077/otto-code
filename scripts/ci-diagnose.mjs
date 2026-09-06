import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const suites = {
  "app-unit": { workspace: "app", project: "unit", pattern: /^src\/.*\.(?:test|spec)\.tsx?$/ },
  "app-browser": {
    workspace: "app",
    project: "browser",
    pattern: /^src\/.*\.browser\.(?:test|spec)\.tsx?$/,
  },
  server: { workspace: "server", pattern: /^src\/.*\.(?:test|spec)\.tsx?$/ },
  playwright: { workspace: "app", pattern: /^e2e\/browser\/.*\.spec\.ts$/ },
  desktop: { workspace: "desktop", pattern: /^e2e\/.*\.spec\.ts$/ },
};

function validateTestFile(suite, file, repoRoot) {
  const definition = suites[suite];
  if (!definition) throw new Error(`Choose a suite: ${Object.keys(suites).join(", ")}`);
  const prefix = `packages/${definition.workspace}/`;
  if (!file?.startsWith(prefix) || file.includes("\\") || file.split("/").includes("..")) {
    throw new Error(`Pass one repository-relative test file under ${prefix}`);
  }
  const relativeFile = file.slice(prefix.length);
  if (!definition.pattern.test(relativeFile) || /[[\]*?{}]/.test(file)) {
    throw new Error("Pass one exact test file, without globs.");
  }
  if (suite === "app-unit" && relativeFile.includes(".browser.")) {
    throw new Error("Use app-browser for a browser test.");
  }
  if (/\.(?:real|local)\.(?:e2e\.test|spec)\./.test(file)) {
    throw new Error("Provider/local-resource suites use their documented dedicated harness.");
  }
  const cwd = path.resolve(repoRoot, prefix);
  const absoluteFile = path.resolve(repoRoot, file);
  if (
    !existsSync(absoluteFile) ||
    !realpathSync(absoluteFile).startsWith(`${realpathSync(cwd)}${path.sep}`)
  ) {
    throw new Error("The test must exist inside its workspace.");
  }
  return { cwd, relativeFile, definition };
}

export function diagnosticCommand({ suite, file, testName }, repoRoot = root) {
  const { cwd, relativeFile, definition } = validateTestFile(suite, file, repoRoot);
  const browser = suite === "playwright" || suite === "desktop";
  const args = browser
    ? ["test", relativeFile, "--workers=1", "--max-failures=1", "--retries=0"]
    : ["run", relativeFile, "--bail=1", "--maxWorkers=1"];
  if (definition.project) args.push("--project", definition.project);
  if (suite === "playwright") args.push("--project=browser");
  if (suite === "desktop") args.push("--project=desktop");
  if (testName) args.push(browser ? "--grep" : "--testNamePattern", testName);
  return {
    cwd,
    runner: browser ? path.join(repoRoot, "scripts/run-playwright.mjs") : "vitest",
    args,
  };
}

function diagnosticEnvironment(suite) {
  const env = { ...process.env, ...(suite === "desktop" ? { E2E_DESKTOP_RUNTIME: "1" } : {}) };
  if (!["server", "playwright", "desktop"].includes(suite)) return env;
  mkdirSync(path.join(root, ".tmp"), { recursive: true });
  const home = mkdtempSync(path.join(root, ".tmp/ci-diagnostic-"));
  const metroTemp = path.join(root, ".tmp/ci-metro-cache");
  mkdirSync(metroTemp, { recursive: true });
  for (const directory of ["AppData/Roaming", "AppData/Local", "temp", "otto-home"]) {
    mkdirSync(path.join(home, directory), { recursive: true });
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    APPDATA: path.join(home, "AppData/Roaming"),
    LOCALAPPDATA: path.join(home, "AppData/Local"),
    TEMP: path.join(home, "temp"),
    TMP: path.join(home, "temp"),
    TMPDIR: path.join(home, "temp"),
    OTTO_HOME: path.join(home, "otto-home"),
    E2E_OUTPUT_DIR: path.join(home, "reports", "test-results"),
    E2E_HTML_REPORT_DIR: path.join(home, "reports", "playwright-report"),
    E2E_REPORT_DIR: path.join(home, "reports", "qa-report"),
    E2E_METRO_TEMP_DIR: metroTemp,
    E2E_METRO_COLD_START: "1",
  });
  console.log(`Isolated test home: ${home}`);
  return env;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({
      options: {
        suite: { type: "string", default: process.env.CI_DIAG_SUITE },
        file: { type: "string", default: process.env.CI_DIAG_FILE },
        "test-name": { type: "string", default: process.env.CI_DIAG_TEST_NAME },
        "dry-run": { type: "boolean", default: false },
      },
    });
    const command = diagnosticCommand({
      suite: values.suite,
      file: values.file,
      testName: values["test-name"],
    });
    console.log(JSON.stringify({ executable: process.execPath, ...command }, null, 2));
    if (!values["dry-run"]) {
      const env = diagnosticEnvironment(values.suite);
      const runner =
        command.runner === "vitest"
          ? path.join(
              path.dirname(
                createRequire(path.join(command.cwd, "package.json")).resolve(
                  "vitest/package.json",
                ),
              ),
              "vitest.mjs",
            )
          : command.runner;
      const result = spawnSync(process.execPath, [runner, ...command.args], {
        cwd: command.cwd,
        stdio: "inherit",
        env,
      });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
