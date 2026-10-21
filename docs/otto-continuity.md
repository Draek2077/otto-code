# Otto data and relay continuity

Otto keeps its existing app IDs, desktop renderer origin (`otto://app`), home folder
(`~/.otto`), and daemon identity when moving to the Paseo base.

## Daemon stores

Before loading an existing home, Otto takes a private, one-time copy of the stores
Paseo reads or rewrites in `otto-0.9-backup/`. The initialization marker is written
only after that snapshot completes. Models and unrelated files are not copied.

Paseo rejects configuration keys it does not recognize. Otto separates these into
`otto-config.json`, keeps the original as `config.json.otto-0.9.bak`, and leaves
Paseo's settings in `config.json`. Invalid Paseo settings still fail validation.
Otto-only speech model selections are preserved with their model-specific settings
so the base runtime can start with its supported defaults.

Project, workspace, and agent writes preserve fields that their Paseo schema strips
from the previous disk record. Nested objects and array entries with stable `id`
values retain these fields too. They stay outside Paseo's runtime records and wire
projections. Paseo still owns edits and removal of its recognized fields, and
deleting a record does not resurrect it.

Old workspace ownership and hidden-state fields map to Paseo's current ownership
and background fields. Existing worktrees keep their `.git/otto/worktree.json`
metadata, and the daemon, CLI, and desktop continue sharing `otto.pid`.

## App storage

Metro resolves AsyncStorage through `packages/app/src/otto/async-storage.ts`. The
wrapper maps `@paseo:` and `@paseo/` keys to the existing `@otto:` and `@otto/` keys,
and `paseo-*` keys to `otto-*`. The replica database keeps its Otto name on web and
native. Existing paired hosts, preferences, and unsent drafts remain in place.

## Hosted relay

The daemon config and saved app host profiles migrate `relay.otto-code.me` endpoints
to `relay.paseo.sh:443` with TLS. Other self-hosted endpoints and direct connections
are preserved. Preferred relay connections follow the migration, and duplicate
connections are removed. The daemon's server ID and E2E keypair remain unchanged.

Paseo's relay transport, handshake, and wire identifiers are unchanged. Product
branding is separate from that protocol. Hub uses a separate, opt-in relationship;
a working relay does not establish Hub compatibility or enroll a daemon with Hub.

The opt-in server test `src/server/otto/hosted-relay.real.e2e.test.ts` pairs an isolated
daemon through the hosted relay, exchanges encrypted RPCs while reporting Otto
version `0.10.0`, and opens a second connection. Run it from `packages/server` with
`RUN_LIVE_RELAY_E2E=1 npx vitest run src/server/otto/hosted-relay.real.e2e.test.ts --bail=1`.
