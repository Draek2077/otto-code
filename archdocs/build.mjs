#!/usr/bin/env node
// Builds the architecture docs site: archdocs/pages/*.adoc -> archdocs/dist/*.html
// Diagrams are authored as [mermaid] listing blocks and rendered client-side by
// mermaid.min.js (vendored from node_modules at build time — no network needed).
import { Extensions, load } from "@asciidoctor/core";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(here, "pages");
const distDir = join(here, "dist");
const require = createRequire(import.meta.url);

const escapeHtml = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// [mermaid] blocks pass through as <pre class="mermaid"> for client-side rendering.
const registry = Extensions.create();
registry.block(function () {
  this.named("mermaid");
  this.onContext(["listing", "open"]);
  this.parseContentAs("raw");
  this.process((parent, reader) => {
    const source = reader.getLines().join("\n");
    return this.createPassBlock(parent, `<pre class="mermaid">${escapeHtml(source)}</pre>`, {});
  });
});

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
copyFileSync(require.resolve("mermaid/dist/mermaid.min.js"), join(distDir, "mermaid.min.js"));
copyFileSync(join(here, "theme.css"), join(distDir, "theme.css"));

const pageFiles = readdirSync(pagesDir)
  .filter((f) => f.endsWith(".adoc"))
  .sort();

const pages = [];
for (const file of pageFiles) {
  const source = readFileSync(join(pagesDir, file), "utf8");
  const doc = await load(source, {
    safe: "safe",
    extension_registry: registry,
    attributes: { showtitle: true, icons: "font", sectlinks: "" },
  });
  pages.push({
    file,
    href: `${basename(file, ".adoc")}.html`,
    title: doc.getDoctitle({ use_fallback: true }),
    body: await doc.convert(),
  });
}

// Titles from getDoctitle() are already HTML-escaped by asciidoctor — do not re-escape.
const nav = (active) =>
  pages
    .map((p) => `<a href="${p.href}"${p.href === active ? ' class="active"' : ""}>${p.title}</a>`)
    .join("\n      ");

for (const page of pages) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title} · Otto Architecture</title>
<link rel="stylesheet" href="theme.css">
</head>
<body>
<div class="layout">
  <nav class="sidebar">
    <div class="brand">Otto Architecture</div>
    <div class="nav-links">
      ${nav(page.href)}
    </div>
  </nav>
  <main class="content">
${page.body}
  </main>
</div>
<script src="mermaid.min.js"></script>
<script>
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral" });
  mermaid.run({ querySelector: "pre.mermaid" });
</script>
</body>
</html>
`;
  writeFileSync(join(distDir, page.href), html);
}

writeFileSync(join(distDir, "index.html"), readFileSync(join(distDir, pages[0].href), "utf8"));

console.log(`archdocs: built ${pages.length} pages -> ${distDir}`);
