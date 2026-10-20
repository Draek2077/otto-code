// Side-effect entry: import this first in a Node entry point so OTTO_* settings
// are visible as PASEO_* before any Paseo module reads the environment.
import { applyOttoEnvironment } from "./environment.js";

applyOttoEnvironment(process.env);
