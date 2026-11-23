export async function exportArtifact(html: string, id: string): Promise<void> {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" }),
    url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `otto-artifact-${id}.html`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
