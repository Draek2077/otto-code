# Boilerplate project templates

Hand-authored project trees that Otto's features can act on. Where the files beside this folder are
one-per-format fixtures for the **file viewer**, these are whole **projects**: a real tree, a real git
history, and a build that really runs.

Consumed by `scripts/playbook-projects.mjs`, which serves **three callers**: the usage playbooks
(`scripts/dev-agent-bootstrap.mjs`), the Playwright E2E suites, and marketing captures for the
website ([docs/site-demos.md](../../docs/site-demos.md)). One corpus for all three — an agent driving
Otto by hand and a spec asserting about it work against identical ground truth, so a green suite stays
evidence about the thing the agent just looked at; and what a screenshot shows is something that
actually builds. See [projects/usage-playbooks](../../projects/usage-playbooks/usage-playbooks.md).

The capture audience is why realism is a hard requirement rather than a nicety. A screenshot of
`hello.txt` sells nothing; a screenshot of a real solution tree with a Mermaid architecture diagram
and a failing build sells the product. Every template therefore carries a **documentation dimension**
alongside its code — README, an AsciiDoc architecture doc with Mermaid diagrams, a project plan, a
test plan, a standalone SVG, and a rendered HTML page — so the file viewer, the previews and the
editor all have something worth looking at in context.

Excluded from oxlint and oxfmt along with the rest of `test-documents/`. That is load-bearing here: a
template's `break/` variants contain deliberate syntax errors and type errors, and a formatter that
"fixed" them would silently delete the error scenario.

## Layout

```
<template-name>/
  playbook.json                 manifest: toolchain, build/test commands, break variants
  tree/                         the green project, copied verbatim to become the initial commit
  breaks/<slug>/tree/           file overlay applied on top of tree/ to make a break branch
```

`tree/` is copied as-is. Each `breaks/<slug>/tree/` is a **partial** overlay: only the files it
contains are replaced, everything else stays green. That keeps a break variant to the few lines that
actually cause the failure, so a diff against `main` reads as the mistake and nothing else.

## Rules for a template

1. **`main` builds green.** The manifest's `build` (and `test`, when present) must succeed on a clean
   materialization. A fixture that cannot pass cannot demonstrate a failure meaning anything.
2. **Every template has at least one break variant.** A green project only exercises half of Otto.
   Diagnostics, the problems list, a red preview, and an agent asked to fix something all need a real
   failure — so each `breaks/<slug>` is a named, documented error scenario.
3. **No network in a build.** Stdlib and the toolchain only. A dependency install makes the fixture
   slow, non-deterministic, and prone to rotting when a registry moves. A dependency has to earn its
   place by being the thing under test.
4. **Name the template for what it is.** The folder name becomes the project name in Otto, so the
   project list reads as a menu: `python-cli`, `csharp-console`, `typescript-node`.
5. **Plausible, not minimal.** Multiple modules, real imports, type annotations, a README, tests. A
   feature that works on `hello.txt` but not on a real tree has not been tested.
6. **Carry documents, not just code.** At minimum a README. Beyond that, reach for the formats Otto
   renders: AsciiDoc with Mermaid, Markdown plans, SVG, HTML. These are what the file viewer, the
   rendered previews and the website captures actually show.

## Manifest

```jsonc
{
  "label": "Python CLI",           // shown in logs; the folder name is the id
  "description": "...",            // one line, becomes the generated README's subtitle
  "tool": "python",                // executable that must be on PATH; absent → build skipped, not failed
  "toolVersionArgs": ["--version"],
  "build": ["python", "-m", "compileall", "-q", "src"],
  "test": ["python", "-m", "unittest", "discover", "-s", "tests", "-q"],
  "breaks": [
    { "slug": "failing-test", "detail": "off-by-one in restock() trips its unit test" }
  ]
}
```

`build` and `test` are argv arrays, never shell strings — no quoting rules, no shell to be absent, and
nothing that behaves differently on Windows. Omit `test` when a template has none.
