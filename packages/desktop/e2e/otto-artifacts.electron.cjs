const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const {
  connectArtifactInspector,
  waitForArtifactObservation,
} = require("./otto-artifact-frame.cjs");

/** Observe the packaged renderer and its normally started daemon. No app-only
 * test branch, synthetic renderer, model launch, or provider credentials.
 */
async function smokeArtifactPreview({ page, listen, daemonHome, cdpPort }) {
  const { DaemonClient } = await import("@getpaseo/client/internal/daemon-client");
  const client = new DaemonClient({
    url: `ws://${listen}/ws`,
    clientId: "packaged-artifact-proof",
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, { headers: options?.headers }),
  });
  let requests = 0;
  const probe = createServer((_request, response) => {
    requests++;
    response.end("escaped");
  });
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/escape`;
  let inspector;
  try {
    await client.connect();
    const root = path.join(daemonHome, "artifact-preview-project");
    fs.mkdirSync(root);
    const added = await client.addProject(root);
    assert.ok(added.project, added.error ?? "No project returned");
    const projectId = added.project.projectId;
    const directory = path.join(root, ".otto", "artifacts");
    fs.mkdirSync(directory, { recursive: true });
    const html = `<!doctype html><html><head><title>Packaged Artifact</title></head><body><h1>Packaged report</h1><button onclick="document.querySelector('h1').textContent='Interaction verified'">Interact</button><button onclick="location.href='${url}'">Navigate outside</button><button onclick="try{document.body.dataset.popup=window.open('${url}')===null?'blocked':'escaped'}catch{document.body.dataset.popup='blocked'}">Open popup</button><script id="otto-artifact-data" type="application/json">{"value":1}</script><script>try{parent.document.body.dataset.artifactEscape='bad'}catch{document.body.dataset.isolated='yes'}document.body.dataset.host=typeof window.paseoDesktop+','+typeof require+','+typeof process;fetch('${url}').catch(()=>document.body.dataset.network='blocked')</script></body></html>`;
    const id = "packaged-preview-proof";
    const now = new Date().toISOString();
    // Seed a durable document; the shipped service validates and projects it.
    // The preview itself is opened only through the production library UI.
    fs.writeFileSync(path.join(directory, `${id}.html`), html);
    fs.writeFileSync(
      path.join(directory, `${id}.json`),
      JSON.stringify({
        id,
        projectId,
        name: "Packaged preview proof",
        description: "Renderer security fixture",
        status: "ready",
        starred: false,
        createdAt: now,
        updatedAt: now,
        generationProvider: null,
        generationModel: null,
        errorMessage: null,
        lastGoodHtml: html,
        runs: [],
      }),
    );
    const rootUrl = page.url();
    const pageCount = page.context().pages().length;
    await page.getByTestId("plugin-sidebar-otto-artifacts-artifacts").click();
    const surface = page.getByTestId("otto-artifacts-page").filter({ visible: true });
    await surface
      .getByTestId(`artifact-card-${id}`)
      .getByRole("button", { name: "Open artifact", exact: true })
      .click();
    const artifactUrl = page.url();
    await page.locator('iframe[title="Artifact preview"]').last().scrollIntoViewIfNeeded();
    inspector = await connectArtifactInspector(cdpPort);
    const frames = await waitForArtifactObservation(
      () => inspector.frames(),
      (found) => !!found.content && !!found.wrapper,
    );
    const preview = frames.content;
    assert.equal(
      await preview.evaluate("document.querySelector('h1').textContent"),
      "Packaged report",
    );
    await preview.click("Interact");
    await waitForArtifactObservation(
      () => preview.evaluate("document.querySelector('h1').textContent"),
      (text) => text === "Interaction verified",
    );
    await preview.click("Open popup");
    await waitForArtifactObservation(
      () => preview.evaluate("({...document.body.dataset})"),
      (state) =>
        state.isolated === "yes" && state.network === "blocked" && state.popup === "blocked",
    );
    assert.equal(
      await preview.evaluate("document.body.dataset.host"),
      "undefined,undefined,undefined",
    );
    assert.equal(await page.locator("body").getAttribute("data-artifact-escape"), null);
    await preview.click("Navigate outside");
    await waitForArtifactObservation(
      () => frames.wrapper.evaluate("document.body.dataset.navigationBlocked"),
      (state) => state === "yes",
    );
    assert.equal(page.url(), artifactUrl);
    assert.equal(page.context().pages().length, pageCount);
    assert.equal(requests, 0);
    // Chromium can replace a CSP-blocked child with its error document. The
    // original document is not a valid post-navigation execution context.
    // Exercise the same explicit saved-output recovery as the browser journey.
    await page
      .getByTestId("artifact-detail")
      .filter({ visible: true })
      .getByRole("button", { name: "Reload saved output", exact: true })
      .click();
    const restored = await waitForArtifactObservation(
      () => inspector.frames(),
      (found) => !!found.content && !!found.wrapper,
    );
    assert.equal(
      await restored.content.evaluate("document.querySelector('h1').textContent"),
      "Packaged report",
    );
    const artifactDir = process.env.PASEO_DESKTOP_SMOKE_ARTIFACT_DIR?.trim();
    if (artifactDir) {
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(
        path.join(artifactDir, "artifact-preview.json"),
        JSON.stringify(
          {
            rootUrl,
            artifactUrl,
            interactive: true,
            hostBindingsAbsent: true,
            parentAccessBlocked: true,
            popupBlocked: true,
            navigationBlocked: true,
            networkRequests: requests,
          },
          null,
          2,
        ),
      );
      await page.screenshot({
        path: path.join(artifactDir, "artifact-preview.png"),
        fullPage: true,
      });
    }
    console.log(
      "Packaged Artifact preview: interaction passed; host/parent access, popups, navigation and network blocked",
    );
  } finally {
    inspector?.close();
    // The outer smoke owns and removes daemonHome after capturing its renderer.
    // Unregistering here would replace a failed preview with a missing-project
    // error before that screenshot and child-frame evidence could be collected.
    await client.close();
    probe.closeAllConnections();
    await new Promise((resolve, reject) =>
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }),
    );
  }
}
module.exports = { smokeArtifactPreview };
