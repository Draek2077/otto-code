export function shouldShowWakeWordToolbarButton(input: {
  featureEnabled: boolean;
  supported: boolean;
  hasDictationTab: boolean;
}): boolean {
  return input.featureEnabled && input.supported && input.hasDictationTab;
}

export function shouldStartWakeWordListening(input: {
  featureEnabled: boolean;
  listeningPaused: boolean;
  isPaneFocused: boolean;
}): boolean {
  return input.featureEnabled && !input.listeningPaused && input.isPaneFocused;
}
