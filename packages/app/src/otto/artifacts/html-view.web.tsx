const frameStyle = { width: "100%", height: "100%", border: 0, background: "white" };
/** Opaque origin: no host DOM, cookies, storage, popups, forms, downloads or top navigation. */
export function ArtifactHtmlView({ html }: { html: string }) {
  return (
    <iframe
      title="Artifact preview"
      srcDoc={html}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
      style={frameStyle}
    />
  );
}
