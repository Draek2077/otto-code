import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

/**
 * Capture recorder for demo scenarios. Screenshots and a step manifest land in
 * demo/.out/<scenario>/; Playwright records the video alongside. The
 * postprocess script (demo/scripts/postprocess.mjs) turns one .out scenario
 * dir into site-ready assets with step offsets computed against the video
 * start, so the website can render slideshows or chaptered video from
 * manifest.json without hardcoding anything.
 */

export interface DemoStepRecord {
  /** Stable step id; also the screenshot basename when one was taken. */
  name: string;
  /** Human title the site shows for this step. */
  title: string;
  /** Optional longer caption for tutorials/slideshows. */
  caption?: string;
  /** Screenshot filename relative to the scenario's shots/ dir, if captured. */
  screenshot?: string;
  /** Wall-clock time the step was marked, for video chaptering. */
  epochMs: number;
}

interface DemoManifest {
  scenario: string;
  /** Wall-clock time the recorder started; postprocess uses it as t=0 for the video. */
  startedEpochMs: number;
  finishedEpochMs: number;
  viewport: { width: number; height: number };
  /** Absolute path of Playwright's recorded video (finalized after the run exits). */
  videoSourcePath: string | null;
  /**
   * Playwright's per-test output dir. After the run, the video is MOVED here
   * as video.webm — postprocess must fall back to this when videoSourcePath
   * (the mid-test staging path) no longer exists.
   */
  testOutputDir: string;
  steps: DemoStepRecord[];
}

export class DemoRecorder {
  private readonly steps: DemoStepRecord[] = [];
  private readonly startedEpochMs = Date.now();
  private shotIndex = 0;

  private constructor(
    private readonly page: Page,
    private readonly scenario: string,
    private readonly outDir: string,
  ) {}

  static async start(page: Page, scenario: string): Promise<DemoRecorder> {
    const outDir = path.resolve(__dirname, "../.out", scenario);
    const recorder = new DemoRecorder(page, scenario, outDir);
    await mkdir(path.join(outDir, "shots"), { recursive: true });
    return recorder;
  }

  /** Marks a step boundary without a screenshot (a video-only beat). */
  step(name: string, title: string, caption?: string): void {
    this.steps.push({ name, title, caption, epochMs: Date.now() });
  }

  /** Marks a step and captures a viewport PNG for it. */
  async shot(name: string, title: string, caption?: string): Promise<void> {
    this.shotIndex += 1;
    const fileName = `${String(this.shotIndex).padStart(2, "0")}-${name}.png`;
    await this.page.screenshot({
      path: path.join(this.outDir, "shots", fileName),
      animations: "disabled",
    });
    this.steps.push({ name, title, caption, screenshot: fileName, epochMs: Date.now() });
  }

  /** Writes the manifest; call as the scenario's last action. */
  async finish(testInfo: TestInfo): Promise<void> {
    const video = this.page.video();
    const videoSourcePath = video ? await video.path().catch(() => null) : null;
    const viewport = this.page.viewportSize() ?? { width: 0, height: 0 };
    const manifest: DemoManifest = {
      scenario: this.scenario,
      startedEpochMs: this.startedEpochMs,
      finishedEpochMs: Date.now(),
      viewport,
      videoSourcePath,
      testOutputDir: testInfo.outputDir,
      steps: this.steps,
    };
    await writeFile(
      path.join(this.outDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    testInfo.annotations.push({ type: "demo-out", description: this.outDir });
  }
}
