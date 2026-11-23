#!/usr/bin/env bash
# Otto's dev identity seam. Keep Paseo's launchers and variable readers intact.
for otto_variable in ${!OTTO_@}; do
  paseo_variable="PASEO_${otto_variable#OTTO_}"
  if [ -z "${!paseo_variable+x}" ]; then
    export "$paseo_variable=${!otto_variable}"
  fi
done
unset otto_variable paseo_variable

export PASEO_DEV_DAEMON_PORT="${PASEO_DEV_DAEMON_PORT:-6788}"
export PASEO_LISTEN="${PASEO_LISTEN:-127.0.0.1:$PASEO_DEV_DAEMON_PORT}"
if [ -z "${PASEO_HOME:-}" ]; then
  otto_dev_root="${PASEO_DEV_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  export PASEO_HOME="${PASEO_DEV_HOME:-$otto_dev_root/packages/desktop/.dev/otto-home}"
  export PASEO_DEV_MANAGED_HOME=1
  unset otto_dev_root
fi
export OTTO_HOME="$PASEO_HOME" OTTO_LISTEN="$PASEO_LISTEN"
export PASEO_LOCAL_MODELS_DIR="${PASEO_LOCAL_MODELS_DIR:-$HOME/.otto/models/local-speech}"
