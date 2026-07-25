#!/usr/bin/env bash
#
# A self-contained log tidier. Creates its own sample data, processes it,
# and cleans up after itself — no external files required.
#
# Exercises shebangs, set -euo, functions, arrays, parameter expansion,
# heredocs, traps, case statements and command substitution.

set -euo pipefail

readonly SCRIPT_NAME="${0##*/}"
readonly WORKDIR="$(mktemp -d)"
readonly LEVELS=(TRACE DEBUG INFO WARN ERROR)

trap 'rm -rf "${WORKDIR}"' EXIT

log() {
  local level="${1:?level required}"
  shift
  printf '%(%H:%M:%S)T [%-5s] %s\n' -1 "${level}" "$*"
}

seed_sample_log() {
  cat >"${WORKDIR}/app.log" <<'EOF'
2026-07-25T09:14:02Z INFO  daemon started on port 6868
2026-07-25T09:14:03Z DEBUG loaded 4 providers
2026-07-25T09:18:41Z WARN  relay handshake retried
2026-07-25T09:18:44Z ERROR websocket closed unexpectedly
2026-07-25T09:18:45Z INFO  websocket reconnected
2026-07-25T10:02:11Z ERROR file watcher exhausted inotify handles
2026-07-25T10:02:12Z TRACE backing off for 2s
EOF
}

summarize() {
  local -A counts=()
  local level

  while read -r _ level _; do
    counts["${level}"]=$(( ${counts["${level}"]:-0} + 1 ))
  done <"${WORKDIR}/app.log"

  for level in "${LEVELS[@]}"; do
    local count="${counts[${level}]:-0}"
    case "${count}" in
      0) marker="   " ;;
      1) marker=" · " ;;
      *) marker=" ! " ;;
    esac
    printf '%s%-6s %s\n' "${marker}" "${level}" "$(printf '#%.0s' $(seq 1 "${count}"))"
  done
}

main() {
  log INFO "${SCRIPT_NAME} working in ${WORKDIR}"
  seed_sample_log

  local total
  total="$(wc -l <"${WORKDIR}/app.log" | tr -d '[:space:]')"
  log INFO "read ${total} lines"

  summarize

  if grep -q ERROR "${WORKDIR}/app.log"; then
    log WARN "errors present — exiting non-zero would be honest, but noisy"
  fi
}

main "$@"
