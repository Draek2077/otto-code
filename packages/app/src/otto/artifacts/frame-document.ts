const policy =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src about:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'";
/** A trusted embedding document owns frame-src. An artifact's own CSP cannot
 * constrain all navigations of its containing frame. The inner opaque origin
 * cannot edit this parent policy or reach Otto. See https://www.w3.org/TR/CSP3/#directive-frame-src. */
export function artifactFrameDocument(html: string): string {
  const source = html
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block}</style><script>document.addEventListener("securitypolicyviolation",function(event){if(event.violatedDirective==="frame-src")document.body.dataset.navigationBlocked="yes"})</script></head><body><iframe title="Artifact content" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${source}"></iframe></body></html>`;
}
