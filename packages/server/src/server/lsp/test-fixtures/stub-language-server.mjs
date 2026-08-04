// A real LSP-speaking process for connection tests: genuine Content-Length
// framing over stdio, so the transport is exercised rather than mocked. The
// behaviours a live server can inflict on us (a hung handshake, a dead process,
// a request that never answers) are selected by argv.
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

const mode = process.argv[2] ?? "normal";

if (mode === "exit-immediately") {
  process.exit(3);
}

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);

function never() {
  return new Promise(() => {});
}

connection.onRequest("initialize", () => {
  if (mode === "hang-initialize") {
    return never();
  }
  return {
    // Advertised because they are answered below. The service filters its fan-out on
    // these - a server that does not declare a provider is never asked for it, which is
    // what keeps a diagnostics-only server like oxlint out of definition lookups.
    capabilities: {
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      renameProvider: true,
      textDocumentSync: 1,
    },
    serverInfo: { name: "stub-language-server", version: "1.0.0" },
  };
});

connection.onNotification("initialized", () => {});

connection.onRequest("stub/echo", (params) => ({ echoed: params }));
connection.onRequest("stub/hang", () => never());
connection.onNotification("stub/die", () => process.exit(7));

// Document sync, recorded so tests can assert what the daemon actually sent.
const received = [];
connection.onNotification("textDocument/didOpen", (p) =>
  received.push({
    kind: "didOpen",
    uri: p.textDocument.uri,
    version: p.textDocument.version,
    languageId: p.textDocument.languageId,
    text: p.textDocument.text,
  }),
);
connection.onNotification("textDocument/didChange", (p) =>
  received.push({
    kind: "didChange",
    uri: p.textDocument.uri,
    version: p.textDocument.version,
    text: p.contentChanges[0]?.text,
  }),
);
connection.onNotification("textDocument/didClose", (p) =>
  received.push({ kind: "didClose", uri: p.textDocument.uri }),
);
connection.onRequest("stub/received", () => received);

// Answers definitions from the synced text: the location it returns points at the
// line where `target` appears, so a test can prove the server saw the draft.
connection.onRequest("textDocument/definition", (p) => {
  const doc = received.findLast((entry) => entry.uri === p.textDocument.uri);
  const lines = (doc?.text ?? "").split("\n");
  const line = lines.findIndex((text) => text.includes("target"));
  if (line < 0) {
    return null;
  }
  return [
    {
      uri: p.textDocument.uri,
      range: { start: { line, character: 0 }, end: { line, character: 6 } },
    },
  ];
});

// Requests rather than notifications so a test can await delivery: the progress
// notification is written to the stream ahead of the response.
connection.onRequest("stub/progress-begin", () => {
  connection.sendNotification("$/progress", {
    token: "stub-index",
    value: { kind: "begin", title: "Indexing" },
  });
  return null;
});
connection.onRequest("stub/progress-end", () => {
  connection.sendNotification("$/progress", { token: "stub-index", value: { kind: "end" } });
  return null;
});

// Hover, references and rename, answered from the synced text so tests can prove the
// draft reached the server.
connection.onRequest("textDocument/hover", (p) => {
  const doc = received.findLast((entry) => entry.uri === p.textDocument.uri);
  const line = (doc?.text ?? "").split("\n")[p.position.line];
  if (line === undefined || !line.includes("target")) {
    return null;
  }
  return {
    contents: { kind: "markdown", value: "**target**: the symbol under the caret" },
    range: {
      start: { line: p.position.line, character: 0 },
      end: { line: p.position.line, character: 6 },
    },
  };
});

connection.onRequest("textDocument/references", (p) => {
  const doc = received.findLast((entry) => entry.uri === p.textDocument.uri);
  const lines = (doc?.text ?? "").split("\n");
  return lines
    .map((text, index) => ({ text, index }))
    .filter((entry) => entry.text.includes("target"))
    .map((entry) => ({
      uri: p.textDocument.uri,
      range: {
        start: { line: entry.index, character: 6 },
        end: { line: entry.index, character: 12 },
      },
    }));
});

connection.onRequest("textDocument/rename", (p) => {
  const doc = received.findLast((entry) => entry.uri === p.textDocument.uri);
  const lines = (doc?.text ?? "").split("\n");
  const edits = lines
    .map((text, index) => ({ text, index }))
    .filter((entry) => entry.text.includes("target"))
    .map((entry) => ({
      range: {
        start: { line: entry.index, character: 6 },
        end: { line: entry.index, character: 12 },
      },
      newText: p.newName,
    }));
  if (edits.length === 0) {
    return null;
  }
  return { changes: { [p.textDocument.uri]: edits } };
});

connection.onRequest("shutdown", () => null);
connection.onNotification("exit", () => process.exit(0));

connection.listen();
