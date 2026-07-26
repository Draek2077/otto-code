// Native no-op. The dev-build marker exists to tell two desktop windows apart,
// which is not a problem native has, and a viewport inset would collide with
// notches and home indicators. Metro resolves dev-mode-border.web.tsx for web.
export function DevModeBorder() {
  return null;
}
