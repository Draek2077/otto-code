---
id: "linux-debian-update-handoff-silent-failure"
kind: "finding"
title: "Linux Debian updates silently failed at Otto's installer handoff"
status: "proposed"
tags: ["linux","desktop","updates","debian","reliability"]
created_at: "2026-09-11T20:03:36.800Z"
updated_at: "2026-09-11T20:03:36.800Z"
---
# Linux Debian updates silently failed at Otto's installer handoff

<!-- compiled_truth -->

The user reports that clicking Update on Linux does nothing visibly, while manually installing the same downloaded .deb with dpkg -i consistently succeeds. Treat this as an Otto authorization/installer-handoff failure, not evidence of a broken Debian package.

Source inspection reproduced a reporting defect: electron-updater 6.8.3 BaseUpdater.quitAndInstall returns void after emitting a synchronous install error, while Otto previously returned installed:true. The UI then removed the update callout instead of displaying the error. Upstream DebUpdater also follows any dpkg failure with apt-get install -f, whose success does not prove that the downloaded package installed.

The working-tree remediation gives Debian an asynchronous, direct-argv pkexec/dpkg handoff and verifies installed package status/version before daemon shutdown and relaunch. Errors reach the existing Update failed surface with command output and the log path. The durable contract and manual verification procedure are in docs/desktop-linux.md.

Verification boundary: focused tests and an isolated real dpkg installation in Ubuntu WSL passed. Native polkit authentication, a packaged Otto upgrade, and full desktop/daemon relaunch are not verified. The exact authorization failure on the affected machines is still unknown; do not mark Linux updates fixed for users or infer release availability from this source change.

## Timeline

- time: "2026-09-11T20:03:36.800Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-11T20:03:36.800Z"
  kind: "evidence"
  summary: "2026-09-11 user report: same .deb always installs with manual dpkg -i; Update silently does nothing. Inspected locked and installed electron-updater 6.8.3 BaseUpdater.js, LinuxUpdater.js, DebUpdater.js and Otto app-update-service.ts/desktop-app-updater.ts. 69 tests passed across auto-updater.test.ts, app-update-service.test.ts, linux-deb-installer.test.ts, quit-lifecycle.test.ts. Desktop typecheck and targeted lint passed; electron-builder configuration validated. Ubuntu WSL executed real dpkg-deb, dpkg --root into a temporary repository-local test root, and dpkg-query; a filename containing spaces, apostrophe, dollar expression and semicolon reached the correct archive. Elevation was substituted in that test; no system packages were modified."
