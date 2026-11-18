/** Match the web composer's existing 1.4 line height; native keeps its natural font metrics. */
export function composerMinimumHeight(web: boolean, contentFontSize: number): number {
  return web ? Math.ceil(contentFontSize * 1.4) : 30;
}
