import { createApp } from "../src/server.js";
import { EventStore } from "../src/store.js";

/** Boot an isolated app instance on an ephemeral port. */
export async function startTestServer() {
  const store = new EventStore();
  const server = createApp(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    store,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
