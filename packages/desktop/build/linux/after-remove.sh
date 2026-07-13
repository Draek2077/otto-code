#!/bin/sh
# Runs as root during package removal (deb `postrm` / rpm `%postun`).
# Only removes /usr/bin/otto if it's still our symlink — leaves it alone if
# the user repointed it, and never touches a real `otto` binary that happens
# to live there.
set -e

LINK="/usr/bin/otto"
TARGET="/opt/Otto/Otto"

if [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$TARGET" ]; then
  rm -f "$LINK"
fi

# Unload and remove the AppArmor profile installed by after-install.sh.
# Best-effort and guarded so removal never fails on systems without AppArmor.
PROFILE_DEST="/etc/apparmor.d/otto"
if [ -f "$PROFILE_DEST" ]; then
  if command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ]; then
    apparmor_parser -R "$PROFILE_DEST" 2>/dev/null || true
  fi
  rm -f "$PROFILE_DEST"
fi
