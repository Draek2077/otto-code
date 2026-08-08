export function shouldShowWakeWordToolbarButton(input: {
  featureEnabled: boolean;
  supported: boolean;
}): boolean {
  return input.featureEnabled && input.supported;
}

export function shouldStartWakeWordListening(input: {
  featureEnabled: boolean;
  listeningPaused: boolean;
}): boolean {
  return input.featureEnabled && !input.listeningPaused;
}
