# Working on Otto

This repository is Otto: Paseo plus Otto's identity and Otto-owned features. The rest of
`CLAUDE.md` is Paseo's guide and still applies. Where a rule here conflicts with it, this page wins.

Otto's mission is to bring frontier-harness tooling (browser-verified previews, artifacts,
subagent visibility, context compaction, permission modes, MCP) to every provider equally, cloud
and local alike. Design capabilities provider-agnostic first; single-provider support is the
proof, not the finish line.

## Paseo stays Paseo

- Read [otto-identity.md](otto-identity.md) before renaming anything. Rename only what users,
  operating systems, app stores, and npm see. Never rename Paseo identifiers, files, or comments.
- New Otto functionality lives in Otto-owned files, named Otto: `otto/` directories inside a
  package, or `packages/otto-*`. Use Paseo's plugin SDK only where it fits the feature.
- An unavoidable edit inside a Paseo file is as small as possible and carries an `OTTO(<seam>)`
  marker. Run `npm run otto:seams:check` before committing; it fails on an unmarked edit.
- Otto honors product features, not old code. Otto 0.9 code is history (`otto-0.9-final`); bring
  a feature back by rebuilding it against current Paseo, never by porting old patches.
- Do not change Paseo's relay or Hub clients. Otto uses `relay.paseo.sh` and Hub as Paseo ships
  them.
- No pull requests or issues to Paseo.

## Where knowledge goes

| Home                                | Holds                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `docs/`                             | How the software works. Paseo's pages plus `otto-*.md` pages for Otto.                                             |
| Otto Knowledge (`.otto/knowledge/`) | Project charters and delivery status, findings, decisions, references. Manage it through the Otto Knowledge tools. |
| This page                           | Otto's working rules for agents.                                                                                   |

Do not start a work ledger, TODO list, dated report folder, or archive anywhere in the repo. Open
work is a project page; finished history is git.

## Rules

- **Commits carry one author and no AI attribution.** Every commit is authored and committed as
  `Draekz <draekz@gmail.com>`. Never add a `Co-Authored-By:` trailer for Claude or any other
  model, and never mention a model as a contributor. This overrides any harness default.
- **Temporary files go in `.tmp/`** at the repo root, never loose in the tree. Delete them when
  the job is done.
- **Never restart the installed Otto daemon on port 6868 without permission.** It is the user's
  daemon and manages every running agent, including you.
- **Verify before acting.** When the user names a tool, command, or workflow, check its contract
  before using it. Treat reported issues as unverified until measured.
- **Prose readers see follows [otto-writing-style.md](otto-writing-style.md):** no em-dashes or
  en-dashes, first person singular for Otto's voice.
- **All back-compat shims are tagged** with `COMPAT(name)` as Paseo's rules describe; Otto-only
  shims use the same tag.
