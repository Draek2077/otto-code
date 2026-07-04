typeset -g OTTO_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${OTTO_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${OTTO_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${OTTO_SHELL_INTEGRATION_DIR}/otto-integration.zsh"
