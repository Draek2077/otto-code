/**
 * Mindmap derives its section fills with fixed HSL lightness offsets from the
 * primary palette. On Otto's warm themes several offsets become almost black,
 * while the label stays foreground-dark. Unlike flowcharts, its generated CSS
 * does not consistently honour the ordinary node/text variables. Override the
 * family once with the concrete app palette so every branch stays readable.
 */
export function applyMindmapTheme(host: HTMLElement, themeVariables: Record<string, string>): void {
  const svg = host.querySelector("svg.mindmapDiagram");
  if (!svg) {
    return;
  }
  const surface = themeVariables.primaryColor;
  const border = themeVariables.primaryBorderColor;
  const foreground = themeVariables.primaryTextColor;
  const edge = themeVariables.lineColor;
  if (!surface || !border || !foreground || !edge) {
    return;
  }
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    .mindmap-node rect, .mindmap-node path, .mindmap-node circle, .mindmap-node polygon {
      fill: ${surface} !important;
      stroke: ${border} !important;
    }
    .mindmap-node text, .mindmap-node .label, .mindmap-node .label *,
    .mindmap-node foreignObject, .mindmap-node foreignObject * {
      fill: ${foreground} !important;
      color: ${foreground} !important;
    }
    .edge { stroke: ${edge} !important; }
  `;
  svg.append(style);
}
