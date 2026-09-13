/** Native clients do not host Electron browser guests. */
export function mountBrowserAutomationFocusGuard(
  _subscribeToUserActivation?: (handler: (payload: unknown) => void) => Promise<() => void>,
): () => void {
  return () => {};
}

export function isBrowserAutomationEditorFocused(): boolean {
  return false;
}

export function withBrowserAutomationFocus<T>(
  _browserId: string,
  task: () => Promise<T>,
): Promise<T> {
  return task();
}
