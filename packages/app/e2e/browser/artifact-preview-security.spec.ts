import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "../support/fixtures";
import { moneyShot } from "../support/helpers/evidence";
import { seedWorkspace } from "../support/helpers/seed-client";
import { buildArtifactsRoute } from "../../src/utils/host-routes";

const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

async function startProbeServer(): Promise<{
  server: Server;
  url: string;
  requests: () => number;
}> {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("network reached");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Artifact probe server did not bind");
  return {
    server,
    url: `http://127.0.0.1:${address.port}/artifact-probe`,
    requests: () => requestCount,
  };
}

function hostileInteractiveArtifact(probeUrl: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"></head><body>
    <button id="interactive" onclick="this.textContent = 'Interaction preserved'">Interactive artifact</button>
    <p id="network">waiting</p><p id="navigation">waiting</p><p id="popup">waiting</p><p id="host">waiting</p>
    <script>
      const probe = ${JSON.stringify(probeUrl)};
      const networkState = document.getElementById('network');
      const navigationState = document.getElementById('navigation');
      const popupState = document.getElementById('popup');
      const hostState = document.getElementById('host');
      fetch(probe).then(() => networkState.textContent = 'network reached').catch(() => networkState.textContent = 'network blocked');
      try { top.location.href = probe; navigationState.textContent = 'navigation reached'; } catch { navigationState.textContent = 'navigation blocked'; }
      popupState.textContent = window.open(probe) === null ? 'popup blocked' : 'popup reached';
      try { parent.document.body.dataset.artifactHostProbe = 'reached'; hostState.textContent = 'host reached'; } catch { hostState.textContent = 'host blocked'; }
    </script>
  </body></html>`;
}

test.describe("Artifact preview security boundary", () => {
  test("renders an interactive artifact while blocking external network, navigation, popups, and host access", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "artifact-preview-security-" });
    const probe = await startProbeServer();
    try {
      const artifactId = `artifact-security-${Date.now().toString(36)}`;
      const artifactDirectory = join(workspace.repoPath, ".otto", "artifacts");
      const artifactPath = join(artifactDirectory, `${artifactId}.html`);
      const timestamp = new Date().toISOString();
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(artifactPath, hostileInteractiveArtifact(probe.url), "utf8");
      await writeFile(
        join(artifactDirectory, `${artifactId}.json`),
        `${JSON.stringify(
          {
            id: artifactId,
            name: "Hostile interactive artifact",
            description: "Security-boundary proof",
            projectId: workspace.repoPath,
            filePath: artifactPath,
            kind: "html",
            starred: false,
            status: "ready",
            createdAt: timestamp,
            updatedAt: timestamp,
            generationAgentId: null,
            generationProvider: "mock",
            generationModel: "ten-second-stream",
            errorMessage: null,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await page.goto(buildArtifactsRoute());
      await page.getByTestId(`artifact-card-${artifactId}`).waitFor({ state: "visible" });
      await page.getByTestId(`artifact-menu-${artifactId}`).click();
      await page.getByTestId(`artifact-menu-view-${artifactId}`).click();

      const frame = page.locator('iframe[title="artifact"]').contentFrame();
      await expect(frame.locator("#network")).toHaveText("network blocked");
      await expect(frame.locator("#navigation")).toHaveText("navigation blocked");
      await expect(frame.locator("#popup")).toHaveText("popup blocked");
      await expect(frame.locator("#host")).toHaveText("host blocked");
      await expect(frame.locator("#interactive")).toHaveText("Interactive artifact");
      await frame.locator("#interactive").click();
      await expect(frame.locator("#interactive")).toHaveText("Interaction preserved");
      await expect(page).toHaveURL(/\/artifacts$/);
      expect(probe.requests()).toBe(0);

      await moneyShot(
        page,
        "Interactive Artifact preview is visible while network, navigation, popups, and host access are blocked.",
      );
    } finally {
      await new Promise<void>((resolve) => probe.server.close(() => resolve()));
      await workspace.cleanup();
    }
  });
});
