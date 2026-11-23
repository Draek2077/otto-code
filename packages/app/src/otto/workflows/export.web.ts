export async function exportWorkflow(json: string, id: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `otto-workflow-${id}.json`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
