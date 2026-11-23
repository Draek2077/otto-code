// An isolated stdio peer, not a daemon, app or model. Its replies expose the
// document the client actually synchronized, including a restarted connection.
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

const rpc = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const documents = new Map();
rpc.onRequest("initialize", () => ({
  capabilities: {
    definitionProvider: true,
    hoverProvider: true,
    referencesProvider: true,
    renameProvider: true,
    documentSymbolProvider: true,
    completionProvider: {},
  },
}));
rpc.onRequest("shutdown", () => null);
rpc.onNotification("exit", () => process.exit(0));
rpc.onNotification("textDocument/didOpen", ({ textDocument }) => {
  documents.set(textDocument.uri, textDocument);
  void publish(textDocument);
});
rpc.onNotification("textDocument/didChange", ({ textDocument, contentChanges }) => {
  const value = { ...textDocument, text: contentChanges[0].text };
  documents.set(value.uri, value);
  void publish(value);
});
rpc.onNotification("textDocument/didClose", ({ textDocument }) =>
  documents.delete(textDocument.uri),
);
rpc.onRequest("fixture/read", ({ uri }) => documents.get(uri) ?? null);
rpc.onRequest("fixture/pid", () => process.pid);
rpc.onRequest("fixture/hang", () => new Promise(() => {}));
rpc.onRequest("fixture/diagnostic", (value) =>
  rpc.sendNotification("textDocument/publishDiagnostics", value).then(() => null),
);
rpc.onRequest("fixture/crash", () => {
  process.exit(7);
});
async function publish(document) {
  await rpc.sendNotification("textDocument/publishDiagnostics", {
    uri: document.uri,
    version: document.version,
    diagnostics: [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: document.text,
      },
    ],
  });
}
rpc.listen();
