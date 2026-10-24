/** Lightweight public owner transport. Importing this entry never constructs an engine. */
export { BrainConnectionStore, BrainConnectionError } from "./controller/connection-store.js";
export { localBrainClient } from "./service/local-client.js";
export { remoteBrainClient } from "./service/remote-client.js";
export { readPidFile, isProcessAlive } from "./service/pid-lock.js";
export { loadBrainConfig } from "./config/store.js";
export { BrainHttpClient } from "./service/host-http-client.js";
