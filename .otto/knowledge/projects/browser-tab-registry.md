---
id: "browser-tab-registry"
kind: "project"
title: "Browser Tab Registry"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "charter"
created_at: "2026-08-08T06:17:30.324Z"
updated_at: "2026-08-08T06:19:44.029Z"
---

# Browser Tab Registry

<!-- compiled_truth -->

# Browser tab registry

**Status:** charter, 2026-07-27. Nothing built.

[docs/preview.md](../../docs/preview.md) states the contract plainly: _"Preview is a workspace-level
facility, not a per-chat one. Every chat in a workspace reaches the same dev servers and the same
browser tabs."_ That is the behaviour we want and the behaviour we mostly get.

The problem is that nothing **owns** that contract. A browser tab's identity, its liveness, and its
reachability by an agent live in three separate maps maintained by three different lifecycles, and
they can disagree. When they do, a tab is visibly open on screen, fully functional to the user, and
completely unreachable from the very chat that is supposed to reach it - with an error message that
says the tab does not exist.

**A tab the user can see is a tab an agent in that workspace can drive. That should be structurally
true, not a coincidence of three maps agreeing.**

---

## The three registries

All in `packages/desktop/src/features/browser-webviews/registry.ts`
(`OttoBrowserWebviewRegistry`), written from different places:

| Map                                                       | Written by                                                                  | Lifecycle it follows              |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| `browserIdsByWebContentsId` / `webContentsIdsByBrowserId` | `registerOttoBrowserWebContents` - `main.ts` `did-attach-webview`           | The `<webview>` element's attach  |
| `workspaceIdsByBrowserId`                                 | `registerWorkspace` - IPC from `browser-pane.electron.tsx:869` (pane mount) | The React pane's **mount effect** |
| `activeBrowserIdsByWorkspaceId`                           | `setWorkspaceActiveBrowser` - `workspace-screen.tsx:403-411` (focus change) | Focused-tab changes               |

Automation reachability is gated **only** on the second map. `executeListTabs`
(`service.ts:568-570`) lists via `listBrowserIdsForWorkspace`, and `resolveTabTarget`
(`service.ts:2374`) rejects anything whose recorded workspace differs from the caller's. So a tab
with a live, attached webContents that is missing from `workspaceIdsByBrowserId` is invisible to
every agent, while remaining perfectly usable by the human.

`workspaceIdsByBrowserId` is `Map<string, string>` - **one workspace per tab, last writer wins** -
and two different code paths rewrite it (`registerWorkspace` at line 51, and `setWorkspaceActiveBrowser`
at line 76, which quietly reassigns ownership as a side effect of a focus change).

## What was observed, 2026-07-27

Recorded because the reproduction was not reliable and the evidence is worth keeping.

**Confirmed.** Preview server `ext:4300` reported `boundBrowserId: 40fe4500-…`. The desktop main log
(`%APPDATA%\Otto\logs\main.log`) showed that browserId registering its webContents 13 times, most
recently `23:43:14.796`, with `registeredBrowserIds: ['40fe4500-…']`. The tab was visible and working
on screen. Simultaneously, `browser_list_tabs` for workspace `wks_6af52e5238ec79b3` returned **zero
tabs**, and `browser_snapshot` on that id returned `browser_tab_not_found`. Only one Electron host
was live, so this was not host-routing ambiguity. The webContents map had the tab; the workspace map
did not.

**Not reproduced, reported by the user.** With two tabs open, closing one removed both. The
suspicious path is `unregisterWebContents` (`registry.ts:22-36`), which on a webContents death
deletes the workspace entry _and_ calls `deleteActiveBrowserReferences`, sweeping every workspace's
active-browser entry that points at that browserId. Not yet traced - do not treat as diagnosed.

**Ruled out.** Chat-to-chat switching is _not_ a trigger. Chats within a workspace share one
`workspaceId`, so both writers rewrite the same value. Switching chats and re-driving the tab worked
correctly once the tab was registered. An earlier reading of this as the docs' "chats trample each
other" was wrong - that phrase describes two agents driving one tab concurrently, a different issue
that is out of scope here.

## Why it is hard to diagnose

Three defects that cost most of a session to work around:

1. **Two unrelated failures share one error code and one message.** `resolveTabTarget` returns
   `browser_tab_not_found` with the identical string for "this tab belongs to another workspace"
   (`service.ts:2374`) and "this tab has no webContents at all" (`service.ts:2380`). From outside
   they are indistinguishable, and they call for opposite responses.
2. **`boundBrowserId` is never invalidated.** `dev-server-manager.ts:421,424` set it at bind time;
   nothing clears or revalidates it when the tab dies. `preview_list` therefore advertises browserIds
   that cannot be used, which reads as "the tab is fine" when it is not.
3. **The register/unregister IPC handlers do not log.** `main.ts:525` and `:532` are the exact seam
   where the state goes wrong, and they are silent - while the webContents attach beside them logs
   every time.

## Direction

Not a design decision yet; these are the constraints the design has to satisfy.

- **One authoritative record per tab.** A tab is a single entity with a workspace, a webContents and
  a liveness state - not three maps that happen to be keyed alike. Membership derives from that
  record.
- **Reachability follows the tab, not the pane's mount effect.** A tab parked in the resident-webview
  host (`browser-webview-resident.ts`) is alive and should stay reachable. Tying registration to a
  React mount means any remount, route change, or pane teardown is a chance to lose it.
- **Focus must not reassign ownership.** `setWorkspaceActiveBrowser` writing `workspaceIdsByBrowserId`
  conflates "which tab is focused here" with "which workspace owns this tab". Separate them.
- **Distinct failures get distinct codes.** At minimum `browser_tab_wrong_workspace` vs
  `browser_tab_not_found`, so the caller can tell "not yours" from "not there" - and so the tools can
  say which.
- **Instrument the seams.** The register/unregister IPC path logs, at the same level the attach path
  already does.
- **Recovery beats correctness-by-luck.** If an agent asks for a tab that is alive but unregistered
  for its workspace, the daemon should be able to reconcile rather than report a phantom absence.

### Open questions

1. **Where does the authoritative record live** - the main process (closest to webContents liveness)
   or the renderer store (closest to what the user sees as a tab)? They disagree today; one has to
   win and the other becomes a projection.
2. **What happens to a tab whose workspace is closed** - destroyed, or orphaned and adoptable? This
   decides whether ownership is reassignable at all.
3. **Does the daemon need to know**, or is this entirely a desktop-side repair? `boundBrowserId`
   invalidation (defect 2) is daemon-side and may be separable from the rest.
4. **Is the close-one-kills-all report the same bug or a second one?** Reproduce before designing for
   it.

## Not in scope

- **Concurrent driving of one tab by two agents** - the trampling docs/preview.md already describes.
  The mitigation there is a tab per chat, and it is unaffected by any of this.
- **Changing the workspace-level scope itself.** Workspace-scoped tabs are the intended contract;
  this charter makes the implementation match it, not replace it.

## Timeline

- time: "2026-08-08T06:17:30.324Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:30.324Z"
  kind: "evidence"
  summary: "Migrated from `projects/browser-tab-registry/browser-tab-registry.md` and the legacy `projects/README.md` ledger. Legacy status: Charter. Ledger summary: A browser tab's identity, liveness and agent-reachability live in three maps with three lifecycles (`OttoBrowserWebviewRegistry`), so a tab can be visibly open and working while `browser_list_tabs` reports it missing. Make the registry authoritative, stop focus changes from reassigning ownership, split `browser_tab_not_found` into \"not yours\" vs \"not there\", and invalidate `boundBrowserId`. Observed 2026-07-27 with evidence; the close-one-kills-all report is **unreproduced**"
- time: "2026-08-08T06:19:44.029Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
