# Otto Project Knowledge

Project Knowledge's first restoration slice is a standalone daemon library in
`packages/server/src/server/otto/project-knowledge/`. It is not registered in the
app or exposed through MCP or plugin RPC. It does not change agent prompts.

## Ownership and resolution

The daemon adapter supplies a project ID, its canonical shared repository root,
the project store override, and the persisted host-directory name. It must resolve
worktrees to the owning project before calling the service. The connected client's
filesystem and current directory are not inputs.

Resolution uses the project override, an existing repository store, then the host
default. A partial repository tree still counts as existing. An unreadable tree
raises an error instead of redirecting the project to an empty store.

Repository stores retain `<project>/.otto/knowledge/`. Host stores retain
`<OTTO_HOME>/project-knowledge/<persisted-directory>/knowledge/`. The optional
`KNOWLEDGE.md` remains beside `knowledge/`. Host directory allocation and setting
changes require a future daemon adapter with revisioned project metadata. This
library never derives a replacement identity or moves a store automatically.

## Reads and writes

Catalog reads return metadata and full-file digests, with confirmed records only
unless inactive records are explicitly requested. Full statements, timelines, and
the six fixed roots are separate reads. Every read uses the filesystem again;
there is no watcher or subscription yet.

Draft creation, reason-bearing truth updates, and evidence appends support the
canonical rich Markdown format from Otto 0.9. Existing unknown metadata and
timeline fields survive edits. Changed confirmed truth becomes proposed. The
library has no confirmation operation. Older noncanonical formats and malformed
pages raise errors and retain their original files; migration remains explicit
future work. Root reads preserve author content; this slice never writes roots,
policy files, or generated indexes.

Edits require the digest from the last read. A per-store queue and an exclusive
`.write-lock` directory coordinate cooperating Otto writers. Writes stage a sibling
file, flush it, check the expected digest again, then replace the page. Creation
uses an exclusive hard link so an existing destination cannot be replaced.
Directories below the trusted daemon boundary cannot be symbolic links.

Resource cleanup runs once. An operation failure survives successful cleanup;
simultaneous failures produce an `AggregateError` with the operation failure as
`cause` and both errors in order. A cleanup failure after a successful operation
is reported, so callers must reread the page before retrying a possibly committed
write.

An abandoned lock remains in place and stops mutations. Inspect the writer before
manual recovery; automatic lock stealing can permit two live writers. Editors and
Git do not observe the Otto lock. A digest check detects earlier external edits,
but a filesystem has no portable conditional rename to exclude an edit in the
final check-to-rename interval. Directory replacement by an external process has
the same boundary. This slice does not claim transactional snapshots across files,
power-loss durability of directory entries, or automatic recovery.

## Verification boundary

The collocated resolver and service tests use isolated checkout-local fixtures,
including a nonsensitive requirement page from `otto-0.9-final`. They cover both
store locations, unknown fields, corrupt pages, stale edits, writer contention,
draft visibility, root preservation, and path escapes. Worktree collapse remains
an adapter integration requirement. Desktop/Mobile journeys, automatic external
refresh, store migrations, bootstrap, review/confirmation, charters/delivery,
reference operations, MCP and plugin UI remain outside this slice.
