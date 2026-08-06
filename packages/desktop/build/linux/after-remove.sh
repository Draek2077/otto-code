#!/bin/sh
# Runs as root during package removal (deb `postrm` / rpm `%postun`).
# Only removes /usr/bin/otto if it's still our symlink — leaves it alone if
# the user repointed it, and never touches a real `otto` binary that happens
# to live there.
set -e

# Both targets are ours: resources/bin/otto is what after-install.sh links
# today, and /opt/Otto/Otto is what packages up to 0.8.2 linked. A machine
# removed before the new postinst has rewritten the link still carries the old
# target, and leaving it behind dangles /usr/bin/otto.
LINK="/usr/bin/otto"

if [ -L "$LINK" ]; then
  case "$(readlink "$LINK" 2>/dev/null)" in
    /opt/Otto/resources/bin/otto | /opt/Otto/Otto) rm -f "$LINK" ;;
  esac
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
