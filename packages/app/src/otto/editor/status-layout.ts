/** Container widths, including narrow desktop splits. An unmeasured/hidden
 * panel starts conservative rather than overflowing for its first frame. */
export function editorStatusLayout(width: number) {
  let severities = [1, 2];
  if (width >= 640) severities = [1, 2, 3, 4];
  else if (width >= 440) severities = [1, 2, 3];
  return {
    fileSize: width >= 440,
    eol: width >= 440,
    encoding: width >= 640,
    selection: width >= 640,
    severities,
  };
}
