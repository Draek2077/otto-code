import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [file, listen] = process.argv.slice(2);
if (!file || !listen) throw new Error("Expected a dev config path and listen address");
let config = {};
try {
  config = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
config.version ??= 1;
config.daemon ??= {};
config.daemon.listen = listen;
config.daemon.cors ??= {};
config.daemon.cors.allowedOrigins = ["*"];
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
