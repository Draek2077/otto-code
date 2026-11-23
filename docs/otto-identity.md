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
The relay-facing URL roles, protocol version, framing and encrypted-channel handshake
remain upstream. Otto-specific application metadata and compatibility fields sit inside
the encrypted payload. Normal browser Origin and User-Agent headers may identify the
Otto app or website; they are not rewritten. The seam check rejects changes to the
relay boundary against the recorded Paseo base.

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

## Upgrading existing Otto app state

The Metro AsyncStorage adapter keeps Otto's physical keys, including the colon-form
remembered-workspace key. Electron main and its sandboxed preload both use the
existing `persist:otto-browser` profile so cookies and browser sign-ins stay in place.

Before protected settings or workspace state is read, rewritten or removed during
migration, the adapter retains an exact first-observed recovery copy under
`@otto:pre-0.10/`. These copies are excluded from normal hydration and key listings.
An explicit storage clear removes them too. Credentials and host-registry keys are
outside this recovery set; pairing continuity has its own migration.

Otto-owned persistence adapters project unsupported object fields out before
Paseo's strict local-state validation, then preserve those fields on disk when
supported settings change. Invalid supported values still fail validation. Stable
record IDs retain their metadata; deleting an entry does not restore it from the
previous document. The original recovery copy also retains settings and state for
features awaiting restoration. This boundary does not change wire validation or
make deferred Otto features available in the clean baseline.

`packages/app/src/otto/validated-persist-storage.ts` owns the preservation wrapper;
the upstream persistence implementation remains intact for unprotected keys.
Protected persistence writes share an ordering queue across store instances. A
replacement store waits for pending saves before hydration, including the read
needed to preserve dormant fields. Explicit removals follow those saves.

## Otto 0.9 wire compatibility

The transport codec in `packages/protocol/src/otto/wire-compatibility.ts` contains
the compatibility boundary for existing Otto clients and hosts. Paseo's internal
types and RPC names remain canonical. The daemon adds Otto's previous checkout,
workspace-visibility and stash ownership fields at their declared wire locations.
The client consumes those previous fields before full protocol validation and
passes only canonical names downstream, keeping strict local caches compatible.
A malformed canonical value still fails validation.

The daemon accepts the previous worktree RPC names and responds using the
requesting socket's dialect. Other sockets sharing the session retain their own
dialect. Clients recognize an Otto 0.9 host by its version and existing Brain
capability, without treating a genuine Paseo host as an Otto host. Legacy
activity-statistics and suggested-task invalidations are ignored while those UIs
are dormant.
Arbitrary tool results, plugin payloads, user configuration, and the relay and
Hub transport protocols are outside this codec.

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

## Brand asset maintenance

The SVG masters in `branding/` define Otto's face. Run
`node scripts/otto/generate-brand-assets.mjs` to generate the app, adaptive Android,
notification, splash, browser status, PWA, desktop ICO/ICNS/Linux and website icons.
Keep Paseo's asset filenames so its existing build pipelines consume Otto artwork.
Both website mockup sets share `components/otto/brand-mark.tsx`.
CI runs the generator with `--check` to reject stale or replaced artwork without
rewriting files.
