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
