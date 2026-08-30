import { describe, expect, it } from "vitest";

import {
  describeWorkflowStorageRemediation,
  describeWorkflowStorageSource,
  supportsWorkflowStorage,
} from "./storage-presentation.js";

describe("Workflow storage presentation", () => {
  it("gates settings without a legacy fallback", () => {
    expect(supportsWorkflowStorage({})).toBe(false);
    expect(
      supportsWorkflowStorage({ categoryStorageResolver: { categories: ["artifacts"] } }),
    ).toBe(false);
    expect(
      supportsWorkflowStorage({ categoryStorageResolver: { categories: ["workflows"] } }),
    ).toBe(true);
  });

  it("labels legacy and project sources without exposing daemon paths", () => {
    expect(describeWorkflowStorageSource(undefined)).toBe("Legacy host library");
    expect(
      describeWorkflowStorageSource({
        schemaVersion: 1,
        projectRoot: "/repo",
        location: "repository",
        storeKey: "workflows:repository:project_1",
        source: "project-store",
      }),
    ).toBe("Repository");
    expect(
      describeWorkflowStorageSource({
        schemaVersion: 1,
        projectRoot: "/repo",
        location: "host",
        storeKey: "workflows:host:project_1",
        hostId: "remote_1",
        hostName: "Build host",
        source: "project-store",
      }),
    ).toBe("Host-local · Build host");
  });

  it("names an unavailable remote host instead of falling back", () => {
    expect(
      describeWorkflowStorageRemediation({
        connectedHostId: "host_1",
        provenance: {
          schemaVersion: 1,
          projectRoot: "/repo",
          location: "host",
          storeKey: "workflows:host:project_1",
          hostId: "remote_1",
          hostName: "Build host",
          source: "project-store",
        },
      }),
    ).toBe("Reconnect Build host or use an explicit verified transfer.");
  });
});
