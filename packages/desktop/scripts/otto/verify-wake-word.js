const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

exports.verifyWakeWordResources = function verifyWakeWordResources(resourcesDir) {
  const directory = path.join(resourcesDir, "wake-word");
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "model.json"), "utf8"));
  for (const name of Object.values(manifest.assets)) {
    if (path.basename(name) !== name) throw new Error("Invalid wake-word asset name");
    const bytes = fs.readFileSync(path.join(directory, name));
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== manifest.assetBytes[name] || hash !== manifest.assetSha256[name]) {
      throw new Error(`Packaged wake-word asset failed verification: ${name}`);
    }
  }
};
