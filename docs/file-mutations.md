# File Mutations

Create, delete, rename and move - what exists in a directory, as opposed to what is inside a file.
Otto's file surface was read-heavy for a long time: it could list, read, download, upload, search,
replace, and conditionally save. It could not make a file, remove one, or move one. This page is what
filled that hole.

Three RPCs, all workspace-relative, all served by `WorkspaceFilesSession`:

| RPC                   | Result statuses                         |
| --------------------- | --------------------------------------- |
| `file.create.request` | `ok`, `exists`, `error`                 |
| `file.delete.request` | `ok`, `not_found`, `not_empty`, `error` |
| `file.rename.request` | `ok`, `not_found`, `exists`, `error`    |

Gated by `server_info.features.fileMutations`. There is no client-side substitute - the client never
touches a filesystem - so a host without the flag simply has no create/rename/delete affordances.
Detection lives in one place, `useFileMutationsFeature`.

## Delete is permanent

Deleting through Otto is an **unlink, not a move to the OS trash**, and the confirmation dialog says
so before anything happens.

This is a decision, not an omission. The daemon can be headless, remote, or inside WSL, where there
is no trash to move to; every cross-platform trash library shells out to a desktop helper that is
absent in exactly those environments. A "delete" that quietly retained the file on one host and
destroyed it on another would be worse than either behaviour on its own, because the user could not
know which one they got. So the answer is the same everywhere, and the UI states it.

Deleting a folder takes two confirmations, and the second one is only reachable because of how the
protocol is shaped: `recursive` is opt-in, so a non-empty directory comes back as `not_empty` with
**nothing removed**. The client then asks a second, differently-worded question and re-sends with
`recursive: true`. A client that never sets the flag can never recursively wipe a tree by accident.

Rename has the matching property: there is **no overwrite flag**. An occupied destination is
`exists`, and nothing moves. POSIX `rename` would silently replace the destination and Windows would
refuse it; the explicit pre-check is what makes both hosts behave the same way, and the safe way.

## The path guard

This is the security surface of the feature, and it is deliberately **not** the same resolver the
read path uses.

`resolveScopedPath` (reads) resolves the _target's_ realpath, which is right for reading: a symlink
to a file inside the workspace should serve that file. A mutation must not do that - deleting a link
would delete its target, renaming one would move the target - so `resolveMutationPath` never follows
the final path component. What it resolves is the **parent**, because a symlinked parent directory is
exactly how traversal sneaks past a lexical check: `root/link/x` is lexically inside `root` no matter
where `link` points.

Four refusals, in order:

1. **The workspace root itself** is never a target. The explorer cannot delete the workspace it is
   browsing.
2. **Lexical containment** - the requested path, after `~` expansion and absolute-path resolution,
   must sit inside the root.
3. **Real containment of the parent** - `realpath(dirname(target))` must sit inside
   `realpath(root)`.
4. The target is then `join(realParent, basename(target))`, and operations use `lstat`/`unlink`, so a
   symlink is deleted as the link it is.

On top of that, the session-level guard applies: unlike `file.write`, the mutation RPCs are
**workspace-bounded**. `file.write` is deliberately not - a tab may edit a file outside every known
workspace, behind an "edit anyway" warning - but "unlink any path the host can reach" is not a
capability worth having for the sake of symmetry. Both guards run; neither is redundant.

Path-guard behaviour is covered by
`packages/server/src/server/file-explorer/service-mutations.test.ts` (traversal, absolute paths, `~`,
the root, the missing parent) and by the symlink cases in `service.posix.test.ts`, which are POSIX-only
because that is where symlinks can be created in a fixture.

## Parent directories are not created

`file.create` requires the parent to exist; it reports "Parent directory does not exist" rather than
`mkdir -p`-ing its way there. That keeps the guard simple - there is a real parent whose realpath can
be checked - and it matches how the UI actually creates things: from a row in the tree, into a folder
that is by definition already there.

## Where things land

"New file" and "New folder" from a **directory** row create inside that directory; from a **file**
row they create alongside it - the rule VS Code uses, and the one people expect when they right-click
a file to add its neighbour. The pane header carries the same two actions for the workspace root,
which is the only way to create the first file in an empty workspace.

The name sheet (`file-name-sheet.tsx`) follows the `artifact-create-sheet` form idiom and states its
destination ("In src/components") rather than leaving the user to infer it.

## Known gap

Renaming or deleting a file that is **open in an editor tab** does not retarget or close the tab. The
file watcher reports the disappearance, so the editor shows its deleted-file state, but the tab still
carries the old path. Re-pointing open tabs at a moved file is unbuilt.

## Related

- [text-editor.md](text-editor.md) - `file.write`, the conditional _content_ save these three sit
  beside, and why it is unbounded where these are not.
- [solution-view.md](solution-view.md) - the Solution lens shows the tree as the build system sees
  it. These RPCs are filesystem operations; adding a file to a `.csproj`'s explicit item list is a
  separate, unbuilt piece of work.
- [rpc-namespacing.md](rpc-namespacing.md) - why the names are dotted.
