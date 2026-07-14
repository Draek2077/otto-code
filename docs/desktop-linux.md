# Desktop on Linux — packaging, sandbox, and startup resilience

Linux-specific behavior of the Electron desktop app (`packages/desktop`): how it's
packaged, how the Chromium sandbox is handled per format, and the layers that keep
it launching on hostile environments (VMs without 3D, Ubuntu 24.04's namespace
lockdown, renderer crashes). Cross-platform desktop behavior lives with the code;
this page is the durable Linux story.

> Collecting ground here as we learn it — expect this to get reorganized as the
> Linux surface fills in.

## Packaging

Built by `electron-builder` from [`electron-builder.yml`](../packages/desktop/electron-builder.yml).
Linux targets: **AppImage, deb, rpm, tar.gz**. `.deb`/`.rpm` install under
`/opt/Otto`, with the executable at `/opt/Otto/Otto` (`executableName: Otto`).

`extraResources` land under `/opt/Otto/resources/`. Post-install/removal hooks run
as root:

| Script                                                                             | Runs on                     | Does                                                                               |
| ---------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| [`build/linux/after-install.sh`](../packages/desktop/build/linux/after-install.sh) | deb `postinst`, rpm `%post` | Symlinks `/usr/bin/otto` → `/opt/Otto/Otto`; installs + loads the AppArmor profile |
| [`build/linux/after-remove.sh`](../packages/desktop/build/linux/after-remove.sh)   | deb `postrm`, rpm `%postun` | Removes the symlink (only if still ours); unloads + deletes the AppArmor profile   |

The GUI binary detects CLI-style argv and runs as the `otto` CLI instead of opening
a window, so the one executable doubles as the CLI (see `main.ts`
`runCliPassthroughIfRequested`). That's why `after-install.sh` can symlink it as
`otto` without a separate CLI binary.

## The Chromium sandbox, per format

`.deb`/`.rpm` keep the **SUID `chrome-sandbox` on** (matching VS Code). The
**AppImage disables the sandbox** — its runtime mounts the app from `/tmp` under the
user's UID, where the SUID helper can't work. That gate lives in
[`main.ts`](../packages/desktop/src/main.ts):

```ts
if (process.platform === "linux" && process.env.APPIMAGE) {
  app.commandLine.appendSwitch("no-sandbox");
}
```

> **Gotcha — the custom `afterInstall` owns the `chrome-sandbox` chmod.**
> electron-builder's stock deb/rpm postinst (`app-builder-lib/templates/linux/after-install.tpl`)
> does three things: symlink the executable, set the `chrome-sandbox` SUID
> permissions, and install the AppArmor profile. Setting `deb.afterInstall` /
> `rpm.afterInstall` **replaces that template wholesale** — electron-builder does
> not merge or append. Because we ship a custom [`after-install.sh`](../packages/desktop/build/linux/after-install.sh)
> (to symlink the lowercase `otto` CLI and load our AppArmor profile), the
> `chrome-sandbox` chmod is _ours to reproduce_. If it's missing, every `.deb`/`.rpm`
> install ships `chrome-sandbox` without its SUID bit and Chromium aborts on launch
> with _"The SUID sandbox helper binary was found, but is not configured correctly …
> owned by root and has mode 4755"_ on any box that falls back to the SUID sandbox.
> The script mirrors the stock template's userns check: `4755` only where user
> namespaces are unavailable, `0755` otherwise. Don't drop it.

### Ubuntu 24.04 unprivileged-userns lockdown → AppArmor profile

Ubuntu 23.10+ (default in 24.04) restrict the unprivileged **user namespaces**
Chromium's sandbox needs. With the sandbox on and no AppArmor profile, the sandboxed
renderer/GPU helpers fail and the app shows a blank window or exits on launch.

The fix (what Chrome/VS Code do): ship an AppArmor profile that grants `userns` and
is otherwise unconfined. Profile source:
[`build/linux/apparmor/otto`](../packages/desktop/build/linux/apparmor/otto), shipped
via `extraResources` (`to: apparmor/otto`), installed to `/etc/apparmor.d/otto` and
loaded with `apparmor_parser -r` by `after-install.sh`.

Everything is **best-effort and non-fatal**: it only runs when `apparmor_parser`
exists _and_ `/sys/kernel/security/apparmor` is present, so SELinux-based `.rpm`
targets and pre-24.04 releases skip it silently and package install never fails. The
`abi <abi/4.0>` line needs AppArmor 4.x (24.04 has it); older parsers reject it, but
those systems don't restrict userns anyway, so the guarded skip is correct.

Verify on a live box: `sudo apparmor_parser -r /etc/apparmor.d/otto` loads without
error and `aa-status` lists `otto`.

## GPU software-rendering fallback

A VM guest with no 3D acceleration (log shows `VMware: No 3D enabled`) or a broken GPU
driver crashes/hangs Chromium's GPU process, leaving a blank window. Otto recovers
automatically — see [`gpu-fallback.ts`](../packages/desktop/src/gpu-fallback.ts),
wired in `main.ts` before `app.whenReady()`. Two independent nets:

1. **Reactive** — on the first GPU `child-process-gone` failure, write a marker
   (`disable-hardware-acceleration` in userData) and `app.relaunch()`. Loop-guarded.
2. **Proactive startup sentinel** — a `startup-in-progress` file is armed right before
   the first window is created (GUI path only) and cleared on the window's first
   paint. A sentinel that survives to the next launch means the previous launch never
   painted (hang or hard crash, no GPU event fired) → promote it to the marker. This
   catches the blank-window-no-crash case the reactive net misses.

Every boot reads the marker and calls `app.disableHardwareAcceleration()` (software
rendering via SwiftShader). All hooks are try/catch-wrapped so they can't crash boot.

**Escape hatches** (env vars, read at boot in `main.ts`):

| Var                                   | Effect                                                                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTTO_FORCE_GPU=1`                    | Clears the marker + sentinel and keeps hardware acceleration on (for a machine that later gets a real GPU)                                                                                                      |
| `OTTO_ELECTRON_FLAGS="--disable-gpu"` | Appends arbitrary Chromium switches; a one-shot manual workaround (`--use-gl=swiftshader`, `--ozone-platform=x11`, …). Only applies when launched from a shell that has the var set — not from the desktop icon |

## Crash dialog

When a window's renderer dies, [`crash-dialog.ts`](../packages/desktop/src/crash-dialog.ts)
(`registerCrashDialog`, wired in `main.ts` bootstrap) shows a **native** dialog — which
doesn't depend on Chromium or the GPU, so it appears even when the graphics stack is
what failed. Buttons: **Reload / Restart in Safe Mode** (writes the software-render
marker and relaunches) **/ Quit**. It's suppressed via `isGpuRecoveryInProgress()`
while the GPU fallback is already relaunching, so the two don't collide.

`showStartupErrorDialog()` (native `showErrorBox`) fires in `main.ts`'s top-level
`runDesktopStartup` catch, so a GUI launch that dies before any window exists surfaces
an error instead of exiting silently.

## Diagnostics

- **Logs**: `~/.config/Otto/logs/main.log` (electron-log). This is where the GPU
  fallback, crash dialog, and startup steps write. Get the _full_ file — the real
  FATAL/crash line often lands right after the point where a pasted snippet cuts off.
- **`Most NODE_OPTIONS are not supported in packaged apps`** is a **red herring**. Otto
  has zero `NODE_OPTIONS` in its code; the app inherits the user's login-shell env
  (`login-shell-env.ts`), and if their shell profile exports `NODE_OPTIONS`, Electron
  notes it ignores most of it in a packaged app. Cosmetic — not a startup failure.
- **`VMware: No 3D enabled`** is the real signal for the blank-window class of report:
  no hardware GL. The GPU fallback above is the durable fix; `OTTO_ELECTRON_FLAGS="--disable-gpu"`
  is the immediate one.
