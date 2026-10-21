# Otto identity and the Paseo boundary

Otto starts from a clean Paseo source tree. Paseo code keeps Paseo names; Otto renames
only what a user, an operating system, an app store, or npm can see. This page is the rule and
the list of mechanisms. The decision behind it is the Knowledge page
`otto-0-10-rebuilds-on-clean-paseo`.

## The rule

Rename it to Otto when someone outside the source tree sees it:

- on-screen labels and other visible strings (i18n **values**, never keys), CLI help and errors,
  window titles, process titles, and text agents read and repeat to users;
- app, bundle, and store ids, the URL scheme, the desktop executable and installer names;
- the `otto` command, the `~/.otto` home folder, port 6868, the `otto.json` project config file;
- published npm package names, Otto URLs (website, web app, GitHub releases, issues);
- icons and other brand assets;
- the agent MCP server name (`mcp__otto__*` tool names).

Leave it Paseo when only a developer sees it: class, function, variable, and type names, file
and directory names, comments, internal workspace package names (`@getpaseo/*`), Java/Kotlin
package namespaces of native modules, and wire-protocol tokens such as the `paseo.bearer.*`
WebSocket subprotocol.

Paseo's relay (`relay.paseo.sh`) and Hub are used exactly as Paseo ships them. Do not change the
relay client or anything else that would make Otto's relay traffic differ from Paseo's.

## Mechanisms

| Concern                | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity values        | `packages/protocol/src/otto/identity.ts`, imported as `@getpaseo/protocol/otto/identity`. Paseo sites read these constants instead of literals.                                                                                                                                                                                                                                                                                 |
| `OTTO_*` configuration | `packages/protocol/src/otto/environment.ts` maps every `OTTO_*` variable onto its `PASEO_*` name unless the `PASEO_*` value is already set. Node entry points import `@getpaseo/protocol/otto/apply-environment` first: the CLI, the supervisor, the daemon worker, the dev runner, and desktop main (which reapplies it after inheriting the login shell environment). Build-time and CI variables keep their `PASEO_*` names. |
| npm package names      | Source keeps `@getpaseo/*`. The publish pipeline renames packages to `@otto-code/*` when it packs them.                                                                                                                                                                                                                                                                                                                         |
| CLI command            | `packages/cli/package.json` installs `bin/paseo` as `otto`; the desktop app ships its launchers as `bin/otto` and `bin/otto.cmd`.                                                                                                                                                                                                                                                                                               |
| Desktop scheme         | `otto` is both the OS deep-link scheme and the renderer origin (`otto://app`). The origin keys stored app state, so it must not change.                                                                                                                                                                                                                                                                                         |

## Plugin compatibility

Plugin requirements compare against `OTTO_PASEO_BASE_VERSION`, independently of Otto's
product version. Scaffolds declare that API minimum and install `@otto-code/plugin`
through the npm alias `@getpaseo/plugin`, preserving the upstream plugin import contract.
Versioned test hosts inject their simulated plugin API version through the daemon's
dependencies; production hosts use the recorded Paseo base.

## Marking edits to Paseo files

Every edit inside a Paseo file carries an `OTTO(<seam>)` marker, for example
`// OTTO(identity)`, `/* OTTO(identity) */` inside an expression, or `# OTTO(identity)` in YAML
and shell. Use one marker per edited block. A test, script, or doc changed only to follow an
identity change takes one file-level marker instead. Files that cannot hold a comment (JSON, images) are
listed with a reason in `scripts/otto/seams.json`.

The marker doubles as the prominent notice of modification that the Apache License requires for
changed Paseo files.

`node scripts/otto/seams.mjs` reports the patch set against the Paseo base recorded in
`scripts/otto/paseo-base.json`: files modified, deleted, and added, and markers per seam.
`--check` fails when a modified Paseo file has no marker and no registry entry. Keep the modified
count as small as possible; new Otto functionality belongs in Otto-owned files, named Otto, under
`otto/` directories or `packages/otto-*`.
