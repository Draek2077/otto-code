#!/bin/sh
# Runs as root during `dpkg --configure` (deb) / `%post` (rpm) right after
# package files land in /opt/Otto. Symlinks the packaged executable onto
# /usr/bin so `otto` works in any shell — including non-interactive ones like
# WSL — without the user ever launching the GUI or clicking "Install CLI" in
# Settings. The GUI executable detects CLI-style argv and runs as the CLI
# instead of opening a window (see packages/desktop/src/main.ts), so it
# doubles as the `otto` binary; mirrors resolveCliInstallSourcePath's choice
# for packaged non-AppImage Linux installs.
set -e

TARGET="/opt/Otto/Otto"
LINK="/usr/bin/otto"

if [ -x "$TARGET" ]; then
  ln -sf "$TARGET" "$LINK"
fi

# Install and load the AppArmor profile so Chromium's sandbox works under
# Ubuntu 24.04's unprivileged user-namespace lockdown (blank window / exit on
# launch without it). Best-effort: skip silently where AppArmor isn't present
# and enabled (SELinux-based .rpm targets, releases that don't restrict userns),
# and never fail the package install.
PROFILE_SRC="/opt/Otto/resources/apparmor/otto"
PROFILE_DEST="/etc/apparmor.d/otto"
if [ -f "$PROFILE_SRC" ] &&
  command -v apparmor_parser >/dev/null 2>&1 &&
  [ -d /etc/apparmor.d ] &&
  [ -d /sys/kernel/security/apparmor ]; then
  if cp "$PROFILE_SRC" "$PROFILE_DEST" 2>/dev/null; then
    apparmor_parser -r "$PROFILE_DEST" 2>/dev/null || true
  fi
fi
