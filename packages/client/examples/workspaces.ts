import { createOttoClient, type OttoClient } from "@otto-code/client";

export function createClient(url: string): OttoClient {
  return createOttoClient({
    url,
  });
}

export async function createOpenAndArchiveWorkspace(url: string, cwd: string): Promise<void> {
  const client = createClient(url);

  try {
    await client.connect();

    const created = await client.workspaces.create({
      source: { kind: "directory", path: cwd },
      title: "Fresh SDK workspace",
    });
    const opened = await client.workspaces.open(cwd);

    await opened.refresh();
    await created.archive();
  } finally {
    await client.close();
  }
}
