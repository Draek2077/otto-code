import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadRenameMap,
  saveRenameMap,
  updateDisplayName,
  deleteDisplayName,
} from "./rename-map.js";

function createTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "rename-map-test-"));
}

test("loadRenameMap returns empty object when file doesn't exist", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };
    const result = loadRenameMap(paths);
    assert.deepStrictEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRenameMap returns empty object for invalid JSON", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };
    writeFileSync(paths.renameMapFile, "invalid json", "utf8");
    const result = loadRenameMap(paths);
    assert.deepStrictEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateDisplayName creates a new entry", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };
    const result = updateDisplayName("model1", "My Model", paths);
    assert.deepStrictEqual(result, { model1: "My Model" });

    // Verify it persists
    const loaded = loadRenameMap(paths);
    assert.deepStrictEqual(loaded, { model1: "My Model" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateDisplayName overwrites an existing entry", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };

    // First update
    updateDisplayName("model1", "Original Name", paths);

    // Overwrite
    const result = updateDisplayName("model1", "Updated Name", paths);
    assert.deepStrictEqual(result, { model1: "Updated Name" });

    const loaded = loadRenameMap(paths);
    assert.deepStrictEqual(loaded, { model1: "Updated Name" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteDisplayName removes an entry", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };

    // Create two entries
    updateDisplayName("model1", "Model One", paths);
    updateDisplayName("model2", "Model Two", paths);

    // Delete one
    const result = deleteDisplayName("model1", paths);
    assert.deepStrictEqual(result, { model2: "Model Two" });

    // Verify it's removed from disk
    const loaded = loadRenameMap(paths);
    assert.deepStrictEqual(loaded, { model2: "Model Two" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteDisplayName removes last entry", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };

    // Create one entry
    updateDisplayName("model1", "Model One", paths);

    // Delete it
    const result = deleteDisplayName("model1", paths);
    assert.deepStrictEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveRenameMap persists and is readable", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };

    saveRenameMap({ model1: "Model One", model2: "Model Two" }, paths);

    const loaded = loadRenameMap(paths);
    assert.deepStrictEqual(loaded, { model1: "Model One", model2: "Model Two" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRenameMap returns {} for array value", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };
    writeFileSync(paths.renameMapFile, JSON.stringify(["a", "b"]), "utf8");
    const result = loadRenameMap(paths);
    assert.deepStrictEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRenameMap returns {} for record with non-string values", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };
    writeFileSync(paths.renameMapFile, JSON.stringify({ model1: 123 }), "utf8");
    const result = loadRenameMap(paths);
    assert.deepStrictEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRenameMap returns {} for non-object value", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };
    writeFileSync(paths.renameMapFile, JSON.stringify("just a string"), "utf8");
    const result = loadRenameMap(paths);
    assert.deepStrictEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateDisplayName then deleteDisplayName round-trip", () => {
  const dir = createTempDir();
  try {
    const paths = { renameMapFile: path.join(dir, "rename-map.json") };

    updateDisplayName("model1", "My Model", paths);
    assert.deepStrictEqual(loadRenameMap(paths), { model1: "My Model" });

    deleteDisplayName("model1", paths);
    assert.deepStrictEqual(loadRenameMap(paths), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
