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
