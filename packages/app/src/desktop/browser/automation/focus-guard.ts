/** Native clients do not host Electron browser guests. */
export function withBrowserAutomationFocus<T>(
  _browserId: string,
  task: () => Promise<T>,
): Promise<T> {
  return task();
}
