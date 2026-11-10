import { artifactFrameDocument } from "../artifacts/frame-document";
/** Reuse the app's parent-owned frame-src boundary: the inner opaque guest
 * cannot navigate itself to a network page, even when a dependency adds a link. */
export function visualizerFrameDocument(html: string) {
  const relay = `<script>(function(){var guest=document.querySelector("iframe");window.addEventListener("message",function(event){if(typeof event.data!=="string"||event.data.length>1000000)return;if(event.source===guest.contentWindow)window.parent.postMessage(event.data,"*");else if(event.source===window.parent)guest.contentWindow.postMessage(event.data,"*");});})();</script>`;
  return artifactFrameDocument(html)
    .replace('title="Artifact content"', 'title="Visualizer content"')
    .replace("</body>", `${relay}</body>`);
}
