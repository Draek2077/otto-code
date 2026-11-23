const path = require("node:path");

/** @param {string} value */
function pathPattern(value) {
  return path
    .resolve(value)
    .split(path.sep)
    .map((part) => part.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"))
    .join("[\\\\/]");
}

/**
 * Metro reads this policy before creating file-map or transform workers. Keep
 * runtime homes, traces and exported app copies out of its dependency graph.
 * Dependency dist directories remain visible: workspace packages consume them.
 * @param {{root: string, app: string, platform: string, maxWorkers: number, blockList: RegExp | RegExp[] | undefined}} input
 */
function metroResourcePolicy(input) {
  const separator = "[\\\\/]";
  const root = pathPattern(input.root);
  const app = pathPattern(input.app);
  const output = "(?:\\.tmp|\\.dev|test-results|playwright-report|coverage)";
  const scratch = new RegExp(
    `^${root}${separator}(?:${output}|(?:packages|plugins)${separator}[^\\\\/]+${separator}${output})(?:${separator}|$)`,
  );
  const appExport = new RegExp(`^${app}${separator}dist(?:${separator}|$)`);
  let defaults = input.blockList ?? [];
  if (!Array.isArray(defaults)) defaults = [defaults];
  return {
    // Windows' CRT file descriptors are a different budget from OS handles.
    // CPU-based Metro defaults selected 14 workers on the reported machine.
    maxWorkers: input.platform === "win32" ? Math.min(input.maxWorkers, 2) : input.maxWorkers,
    blockList: [...defaults, scratch, appExport],
  };
}
module.exports = { metroResourcePolicy };
