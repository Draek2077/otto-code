if [[ -n "${_OTTO_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _OTTO_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _OTTO_ZSH_COMMAND_ACTIVE=0

function _otto_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _otto_precmd() {
  local command_status=$?
  if [[ "$_OTTO_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _otto_osc633 "D;${command_status}"
    _OTTO_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _otto_osc633 "A"
}

function _otto_preexec() {
  _OTTO_ZSH_COMMAND_ACTIVE=1
  _otto_osc633 "B"
  _otto_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _otto_precmd
add-zsh-hook preexec _otto_preexec
