#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Turns raw demo captures (demo/.out/<scenario>/) into site-ready assets in
// packages/website/public/demos/<scenario>/: step screenshots, an MP4 + WebM
// of the recording, and a manifest.json with per-step video offsets so the
// website can render slideshows or chaptered video. The output directory is
// gitignored — assets are regenerated and uploaded as part of site deploy.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outRoot = path.resolve(scriptDir, "../.out");
const siteRoot = path.resolve(scriptDir, "../../../website/public/demos");

function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (exit ${result.status}): ffmpeg ${args.join(" ")}`);
  }
}

async function processScenario(scenario) {
  const scenarioOut = path.join(outRoot, scenario);
  const manifestPath = path.join(scenarioOut, "manifest.json");
  if (!existsSync(manifestPath)) {
    return false;
  }
  const raw = JSON.parse(await readFile(manifestPath, "utf8"));
  const destDir = path.join(siteRoot, scenario);
  await rm(destDir, { recursive: true, force: true });
  await mkdir(path.join(destDir, "shots"), { recursive: true });

  const shotsDir = path.join(scenarioOut, "shots");
  if (existsSync(shotsDir)) {
    await cp(shotsDir, path.join(destDir, "shots"), { recursive: true });
  }

  // Playwright records to a staging path mid-test, then moves the file into
  // the test's output dir as video.webm after the run — check both.
  const videoCandidates = [
    raw.videoSourcePath,
    raw.testOutputDir ? path.join(raw.testOutputDir, "video.webm") : null,
  ].filter(Boolean);
  const videoSource = videoCandidates.find((candidate) => existsSync(candidate)) ?? null;

  let video = null;
  if (videoSource) {
    if (hasFfmpeg()) {
      runFfmpeg([
        "-i",
        videoSource,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "20",
        "-movflags",
        "+faststart",
        "-an",
        path.join(destDir, "video.mp4"),
      ]);
      await cp(videoSource, path.join(destDir, "video.webm"));
      video = { mp4: "video.mp4", webm: "video.webm" };
    } else {
      console.warn(`[demo] ffmpeg not found — copying raw webm only for ${scenario}`);
      await cp(videoSource, path.join(destDir, "video.webm"));
      video = { mp4: null, webm: "video.webm" };
    }
  } else {
    console.warn(`[demo] No video recorded for ${scenario}`);
  }

  const siteManifest = {
    scenario: raw.scenario,
    viewport: raw.viewport,
    durationMs: raw.finishedEpochMs - raw.startedEpochMs,
    video,
    steps: raw.steps.map((step) => ({
      name: step.name,
      title: step.title,
      caption: step.caption ?? null,
      screenshot: step.screenshot ? `shots/${step.screenshot}` : null,
      // Offset into the video; t=0 is the recorder start (≈ first navigation).
      tMs: Math.max(0, step.epochMs - raw.startedEpochMs),
    })),
  };
  await writeFile(
    path.join(destDir, "manifest.json"),
    `${JSON.stringify(siteManifest, null, 2)}\n`,
  );
  console.log(`[demo] ${scenario} → ${destDir}`);
  return true;
}

async function main() {
  if (!existsSync(outRoot)) {
    console.error(
      `[demo] Nothing to process: ${outRoot} does not exist. Run \`npm run demo\` first.`,
    );
    process.exitCode = 1;
    return;
  }
  const requested = process.argv.slice(2);
  const scenarios =
    requested.length > 0
      ? requested
      : (await readdir(outRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);

  let processed = 0;
  for (const scenario of scenarios) {
    if (await processScenario(scenario)) {
      processed += 1;
    } else {
      console.warn(
        `[demo] Skipping ${scenario}: no manifest.json in ${path.join(outRoot, scenario)}`,
      );
    }
  }
  if (processed === 0) {
    console.error("[demo] No scenarios were processed.");
    process.exitCode = 1;
  }
}

await main();
