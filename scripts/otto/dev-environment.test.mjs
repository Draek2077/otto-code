import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function runLane(overrides = {}, powershell = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "otto-dev-lane-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(PASEO|OTTO)_/.test(key)),
  );
  env.OTTO_DEV_ROOT = directory;
  Object.assign(env, overrides);
  try {
    const bash =
      process.platform === "win32"
        ? path.join(process.env.ProgramFiles, "Git/bin/bash.exe")
        : "bash";
    const command = powershell ? "powershell" : bash;
    const args = powershell
      ? [
          "-NoProfile",
          "-Command",
          ". ./scripts/dev-home.ps1; Initialize-OttoDevEnvironment | ConvertTo-Json -Compress",
        ]
      : [
          "-c",
          "source scripts/dev-home.sh; configure_dev_command_env; node -e 'console.log(JSON.stringify({Home:process.env.PASEO_HOME,Listen:process.env.PASEO_LISTEN}))'",
        ];
    const output = execFileSync(command, args, { env, encoding: "utf8" });
    const result = JSON.parse(output.trim());
    const config = JSON.parse(readFileSync(path.join(result.Home, "config.json"), "utf8"));
    return { result, config, directory };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the shell dev lane seeds Otto's checkout home on 6788", () => {
  const { result, config, directory } = runLane();
  assert.equal(result.Listen, "127.0.0.1:6788");
  assert.equal(path.resolve(result.Home), path.join(directory, "packages/desktop/.dev/otto-home"));
  assert.equal(config.daemon.listen, result.Listen);
  assert.deepEqual(config.daemon.cors.allowedOrigins, ["*"]);
});

test("the Windows dev lane uses the same defaults", { skip: process.platform !== "win32" }, () => {
  const { result, config, directory } = runLane({}, true);
  assert.equal(result.Listen, "127.0.0.1:6788");
  assert.equal(path.resolve(result.Home), path.join(directory, "packages/desktop/.dev/otto-home"));
  assert.equal(config.daemon.listen, result.Listen);
});

test("explicit Otto homes are honored without rewriting their config", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "otto-explicit-home-"));
  const configFile = path.join(directory, "config.json");
  const original = '{"version":1,"daemon":{"listen":"127.0.0.1:6999"}}\n';
  writeFileSync(configFile, original);
  try {
    const { result } = runLane({ OTTO_HOME: directory, OTTO_LISTEN: "127.0.0.1:6999" });
    assert.equal(path.resolve(result.Home), directory);
    assert.equal(result.Listen, "127.0.0.1:6999");
    assert.equal(readFileSync(configFile, "utf8"), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
