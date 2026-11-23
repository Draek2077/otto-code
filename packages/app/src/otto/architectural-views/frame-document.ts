import { artifactFrameDocument } from "../artifacts/frame-document";
/** Keep the same parent-owned frame-src policy as Artifacts. Only the exact
 * inner source and this ephemeral channel can relay messages in either direction. */
export function architecturalFrameDocument(html: string, channel: string): string {
  const key = JSON.stringify(channel).replace(/</g, "\\u003c");
  const bridge = `<script>(function(){var key=${key},frame=document.querySelector("iframe");window.addEventListener("message",function(event){if(event.source===frame.contentWindow){if(typeof event.data==="string"&&event.data.length<=26000000&&event.data.indexOf("__OTTO_VIEW__")===0)window.parent.postMessage({channel:key,payload:event.data},"*");return;}if(event.source===window.parent&&event.data&&event.data.channel===key&&typeof event.data.payload==="string"&&event.data.payload.length<300000)frame.contentWindow.postMessage(event.data.payload,"*");});})();</script>`;
  return artifactFrameDocument(html).replace("</body>", `${bridge}</body>`);
}
