import { version } from "../package.json";

// Geometry mirrors branding/otto-icon.svg, the same mark used by the app and site.
// Inline SVG avoids sending sign-in visitors to an external asset host.
const logo = `<svg viewBox="0 0 512 512" fill="none" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="28"><circle cx="114.72778" cy="280" r="70"/><circle cx="397.27271" cy="280" r="70"/><path d="M155.08434 162h96M216 162v202M260.91559 162h96M296 162v202"/><circle cx="114.72778" cy="280" r="22" fill="currentColor" stroke="none"/><circle cx="397.27271" cy="280" r="22" fill="currentColor" stroke="none"/></g></svg>`;

// Standalone HTML uses the Daylight/Twilight palette and 4px spacing ladder from
// app/styles/theme-palettes.ts. Do not import the React Native app into the Worker.
const css = `
:root{color-scheme:light dark;--background:#fffefc;--surface:#faf8f4;--foreground:#26262b;--muted:#62626b;--border:#d1d1d8;--accent:#c69700;--accent-ink:#181300;--hover:#d1a000}
@media(prefers-color-scheme:dark){:root{--background:#1e1e23;--surface:#25262c;--foreground:#fafafa;--muted:#b6b6bf;--border:#414149;--accent:#5aa0ee;--accent-ink:#102033;--hover:#79b3f2}}
*{box-sizing:border-box}
body{margin:0;background:var(--background);color:var(--foreground);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px}
.card{width:100%;max-width:544px;padding:32px 40px;background:var(--surface);border:1px solid var(--border);border-radius:16px;text-align:center}
.brand{display:inline-flex;flex-direction:column;align-items:center;color:var(--foreground);text-decoration:none;line-height:1;gap:8px;margin-bottom:24px}
.brand svg{display:block;width:64px;height:64px}

h1{margin:0 0 12px;font-size:28px;font-weight:500;line-height:1.25;letter-spacing:-.025em}
p{margin:0;color:var(--muted)}
.intro{max-width:400px;margin-inline:auto}
.access{margin:28px 0 24px;padding:16px 0;border-block:1px solid var(--border)}
.access span{display:block;color:var(--muted);font-size:12px;letter-spacing:.04em;margin-bottom:4px}
.access p{color:var(--foreground);font-size:16px;font-weight:500}
.notice{font-size:14px;margin:24px auto 20px;max-width:360px}
form{margin:0}
button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 28px;border:1px solid transparent;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-family:inherit;font-size:16px;font-weight:500;line-height:1.4;cursor:pointer;text-decoration:none}
button:hover,.button:hover{background:var(--hover)}
button:active,.button:active{transform:translateY(1px)}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
details{margin-top:28px;text-align:left;border-top:1px solid var(--border);padding-top:20px;font-size:14px}
summary{cursor:pointer;color:var(--foreground);font-weight:500;text-align:center;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:" +";color:var(--muted)}
details[open] summary::after{content:" −"}
details p{margin-top:16px}
footer{margin-top:24px;color:var(--muted);font-size:12px;text-align:center}
footer a{color:var(--muted);text-decoration:none}footer a:hover{text-decoration:underline;color:var(--foreground)}
footer span{display:block;margin-top:4px}
.status p{margin-bottom:24px}
@media(max-width:560px){main{padding:24px 16px}.card{padding:24px;border-radius:12px}h1{font-size:24px}.brand{margin-bottom:24px}.brand svg{width:64px;height:64px}button,.button{width:100%}}
`;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function renderAuthPage(body: string, nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Otto sign-in</title><style nonce="${escapeHtml(nonce)}">${css}</style></head><body><main><section class="card" aria-labelledby="page-title"><a class="brand" href="https://otto-code.me" rel="noreferrer" aria-label="Otto homepage">${logo}</a>${body}</section><footer><a href="https://otto-code.me" rel="noreferrer">otto-code.me</a><span>Otto sign-in · v${escapeHtml(version)}</span></footer></main></body></html>`;
}

export function consentContent(view: { vendor: string; scopes: string; state: string }): string {
  const vendor = escapeHtml(view.vendor);
  return `<h1 id="page-title">Connect ${vendor} to Otto</h1><p class="intro">Use your ${vendor} account from your Otto host.</p><div class="access"><span>REQUESTED ACCESS</span><p>${escapeHtml(view.scopes)}</p></div><p class="intro">Your host stores the connection. Tool results may be sent to your selected AI provider.</p><p class="notice">Only continue if you started this connection in Otto.</p><form method="post" action="?state=${escapeHtml(view.state)}"><button type="submit">Continue to ${vendor}</button></form><details><summary>How your connection is handled</summary><p>Otto's shared sign-in service exchanges and renews credentials. It can read access and refresh tokens while processing them, but does not persist them. Your selected host stores tokens in its credential vault.</p><p>Sign-in attempts expire after five minutes. Connection proof hashes expire 90 days after the last renewal. Expired records are scheduled for deletion; infrastructure backups follow Cloudflare's retention policies.</p><p>The service handles authentication, not file or tool traffic. Your host calls ${vendor} directly with the permissions you approve. Results from tools you use may be sent to the AI provider selected in Otto.</p><p>Never approve a sign-in link sent by someone else. Start the connection yourself from your selected Otto host.</p></details>`;
}

export function statusContent(title: string, message: string): string {
  return `<div class="status"><h1 id="page-title">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div>`;
}
