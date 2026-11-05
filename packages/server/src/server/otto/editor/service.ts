import { realpath } from "node:fs/promises";
import type { Logger } from "pino";
import {
  readEditorSettings,
  saveEditorSettings,
  listEditorServers,
  stopEditorServer,
  queryEditor,
  queryBoundEditor,
  listEditorFiles,
  writeEditorImage,
  searchEditorFiles,
  planEditorReplace,
  guardEditorDraft,
  exportEditorDocument,
  observeEditor,
  releaseEditor,
  planEditorRename,
  applyEditorRename,
  undoEditorRename,
  type EditorDocument,
  type EditorQueryResult,
} from "@getpaseo/plugin/otto/editor";
import { EditorError } from "./errors.js";
import { EditorSettingsStore } from "./settings.js";
import { EditorDocuments } from "./documents.js";
import { EditorRenames } from "./rename.js";
import { LanguageServerPool } from "./lsp/pool.js";
import { canonicalDocument, fileUri, pathKey } from "./lsp/uri.js";
import { resolveServer } from "./lsp/registry.js";
import type { LspFeature } from "./lsp/connection.js";
import { EditorNameIndex } from "./name-index.js";
import { EditorSolutionHost } from "./solution/host.js";
import {
  sharedDotnetProcessRegistry,
  stopAllEditorDotnetProcesses,
} from "./dotnet-process-registry.js";
import type { z } from "zod";
import { EditorOperations } from "./lifetime.js";
import { walkWorkspaceSourceFiles } from "../../../utils/directory-suggestions.js";
import { EditorImageWrites } from "./images.js";
import { EditorSearches } from "./search.js";
import { EditorDraftGuards } from "./draft-guards.js";
import { EditorExports } from "./exports.js";
import { serverPrerequisite } from "./lsp/install.js";
import {
  emptyResult,
  definitionLocations,
  referenceLocations,
  hoverText,
  completions,
  symbols,
} from "./lsp/results.js";

const feature: Readonly<Record<EditorQueryResult["action"], LspFeature | null>> = {
  definition: "definition",
  references: "references",
  hover: "hover",
  completion: "completion",
  symbols: "documentSymbol",
  diagnostics: null,
  workspaceSymbols: null,
};

/** Composition root for editor-owned host state. The existing plugin channel
 * provides authenticated client identity; no new socket or relay framing. */
export class EditorHost {
  private closed = false;
  readonly settings: EditorSettingsStore;
  private readonly pool: LanguageServerPool;
  private readonly documents: EditorDocuments;
  private readonly renames: EditorRenames;
  private readonly names = new EditorNameIndex();
  private readonly solutions: EditorSolutionHost;
  private readonly operations = new EditorOperations();
  private readonly images = new EditorImageWrites();
  private readonly searches = new EditorSearches();
  private readonly guards = new EditorDraftGuards();
  private readonly exports = new EditorExports();
  constructor(
    home: string,
    private readonly hostId: () => string,
    private readonly logger: Logger,
  ) {
    this.settings = new EditorSettingsStore(home);
    this.solutions = new EditorSolutionHost(hostId, this.settings, logger);
    this.documents = new EditorDocuments({
      closeDocument: (root, file) => this.pool.closeDocument(root, file),
      onError: (error) => logger.warn({ err: error }, "Editor observation cleanup failed"),
    });
    this.pool = new LanguageServerPool({
      logger,
      policy: () => {
        sharedDotnetProcessRegistry(logger).setLimit(this.settings.current().dotnetMaxProcesses);
        return this.settings.policy();
      },
      onDiagnostics: (root, id, value, text) => this.documents.publish(root, id, value, text),
      onServerGone: (root, id) => this.documents.serverGone(root, id),
    });
    this.renames = new EditorRenames(
      (root, file) => this.documents.drafts(root, file),
      undefined,
      (root, file) => this.guards.blocked(root, file),
    );
  }
  invoke(method: string, input: unknown, clientId: string): Promise<unknown> | undefined {
    if (this.closed) throw new EditorError("closed", "The editor host is shutting down.");
    const solution = this.solutions.invoke(method, input);
    if (solution) return solution;
    if (method === readEditorSettings.name) {
      this.assertHost(readEditorSettings.input.parse(input).hostId);
      return this.readSettings();
    }
    if (method === saveEditorSettings.name) return this.saveSettings(input);
    if (method === listEditorServers.name) return this.listServers(input);
    if (method === stopEditorServer.name) return this.stopServer(input);
    if (method === queryEditor.name) return this.query(input, clientId);
    if (method === queryBoundEditor.name) return this.queryBound(input, clientId);
    if (method === listEditorFiles.name) return this.listFiles(input, clientId);
    if (method === writeEditorImage.name) {
      const request = writeEditorImage.input.parse(input);
      this.assertHost(request.hostId);
      return this.operations.run(clientId, request.root, (isCurrent) =>
        this.images.write(clientId, request, isCurrent),
      );
    }
    if (method === exportEditorDocument.name) {
      const request = exportEditorDocument.input.parse(input);
      this.assertHost(request.hostId);
      return this.operations.run(clientId, request.root, (isCurrent) =>
        this.exports.write(clientId, request, isCurrent),
      );
    }
    if (method === searchEditorFiles.name) {
      const request = searchEditorFiles.input.parse(input);
      this.assertHost(request.hostId);
      return this.operations.run(clientId, request.root, (isCurrent) =>
        this.searches.search(clientId, request.root, request.options, isCurrent),
      );
    }
    if (method === planEditorReplace.name) {
      const request = planEditorReplace.input.parse(input);
      this.assertHost(request.hostId);
      return this.operations.run(
        clientId,
        this.searches.root(clientId, request.searchId),
        (isCurrent) =>
          this.searches.plan(
            clientId,
            request.searchId,
            request.files,
            request.replacement,
            this.renames,
            isCurrent,
          ),
      );
    }
    if (method === planEditorRename.name) return this.planRename(input, clientId);
    if (method === applyEditorRename.name) {
      const request = applyEditorRename.input.parse(input);
      this.assertHost(request.hostId);
      return this.renames.apply(clientId, request.planId);
    }
    if (method === undoEditorRename.name) {
      const request = undoEditorRename.input.parse(input);
      this.assertHost(request.hostId);
      return this.renames.undo(clientId, request.runId);
    }
    if (method === releaseEditor.name) {
      const request = releaseEditor.input.parse(input);
      this.assertHost(request.hostId);
      return this.documents
        .releaseDocument(clientId, request.documentId)
        .then(() => ({ released: true }));
    }
    if (method === guardEditorDraft.name) {
      const request = guardEditorDraft.input.parse(input);
      this.assertHost(request.hostId);
      return this.operations.run(clientId, request.root, async (isCurrent) => {
        const paths = request.modified
          ? await canonicalDocument(request.root, request.file)
          : { root: request.root, file: request.file };
        if (!isCurrent()) throw new EditorError("closed", "Editor draft protection was released.");
        return {
          guarded: this.guards.update(clientId, request.documentId, {
            ...paths,
            modified: request.modified,
            revision: request.revision,
          }),
        };
      });
    }
    if (method === observeEditor.name) return this.observe(input, clientId);
    return undefined;
  }
  private assertHost(hostId: string) {
    if (hostId !== this.hostId())
      throw new EditorError("invalid", "Editor request belongs to another host.");
  }
  private async listFiles(input: unknown, clientId: string) {
    const request = listEditorFiles.input.parse(input);
    this.assertHost(request.hostId);
    return this.operations.run(clientId, request.root, async (isCurrent) => {
      const root = await realpath(request.root);
      const files: string[] = [];
      const result = await walkWorkspaceSourceFiles(
        root,
        async (_file, relative) => {
          if (!isCurrent()) throw new EditorError("closed", "Editor demand was released.");
          files.push(relative);
        },
        { files: 5000, entries: 20000 },
      );
      return { files, truncated: result.truncated };
    });
  }
  private async readSettings() {
    const settings = this.settings.read();
    await this.pool.applyPolicy();
    await this.solutions.configure();
    return settings;
  }
  private async saveSettings(input: unknown) {
    const request = saveEditorSettings.input.parse(input);
    this.assertHost(request.hostId);
    const settings = this.settings.save(request.expectedRevision, request.patch);
    await this.pool.applyPolicy();
    await this.solutions.configure();
    return settings;
  }
  private async listServers(input: unknown) {
    const request = listEditorServers.input.parse(input);
    this.assertHost(request.hostId);
    const root = request.root ? await realpath(request.root) : null;
    const policy = this.settings.policy();
    const available = [];
    for (const row of this.pool.rows) {
      const resolved = await resolveServer(row, root, policy.allCsharpProjects);
      available.push({
        id: row.id,
        label: row.label,
        enabled: policy.languages[row.id] ?? row.defaultEnabled,
        command: resolved?.command ?? null,
        source: resolved?.source ?? null,
        workspaceOnly: row.workspaceOnly,
        cost: row.cost,
        install: row.install,
        prerequisite: serverPrerequisite(row.id),
      });
    }
    return { available, running: this.pool.running() };
  }
  private async stopServer(input: unknown) {
    const request = stopEditorServer.input.parse(input);
    this.assertHost(request.hostId);
    await this.pool.stop(await realpath(request.root), request.serverId);
    return { stopped: true };
  }
  private async canonical(
    request: EditorDocument,
    clientId: string,
    isCurrent: () => boolean,
  ): Promise<EditorDocument> {
    this.assertHost(request.hostId);
    const paths = await canonicalDocument(request.root, request.file);
    if (this.closed || !isCurrent()) throw new EditorError("closed", "Editor demand was released.");
    const document = { ...request, root: paths.root, file: paths.file };
    this.documents.sync(clientId, document);
    return document;
  }
  private async query(input: unknown, clientId: string): Promise<EditorQueryResult> {
    const request = queryEditor.input.parse(input);
    return this.operations.run(clientId, request.root, async (isCurrent) => {
      const document = await this.canonical(request, clientId, isCurrent);
      return this.queryDocument(document, request, isCurrent);
    });
  }
  private async queryBound(input: unknown, clientId: string) {
    const request = queryBoundEditor.input.parse(input);
    this.assertHost(request.hostId);
    const document = this.documents.bound(
      clientId,
      request.hostId,
      request.documentId,
      request.draftVersion,
      request.modified,
    );
    if (!document) return { state: "needsSync" as const };
    return this.operations.run(clientId, document.root, async (isCurrent) => ({
      state: "ready" as const,
      result: await this.queryDocument(document, request, isCurrent),
    }));
  }
  private async queryDocument(
    document: EditorDocument,
    request: {
      action: EditorQueryResult["action"];
      position: z.output<typeof queryEditor.input>["position"];
      query?: string;
    },
    isCurrent: () => boolean,
  ): Promise<EditorQueryResult> {
    if (request.action === "workspaceSymbols") {
      this.names.invalidate(document.root);
      return this.names.find(document, request.position, request.query ?? "");
    }
    try {
      const result = await this.queryServers(document, request, isCurrent);
      if (result.state === "unavailable") return this.nameResult(document, request) ?? result;
      return result;
    } catch (error) {
      if (error instanceof EditorError && error.kind === "unavailable") {
        const result = this.nameResult(document, request);
        if (result) return result;
      }
      throw error;
    }
  }
  private nameResult(
    document: EditorDocument,
    request: {
      action: EditorQueryResult["action"];
      position: z.output<typeof queryEditor.input>["position"];
    },
  ) {
    if (request.action === "symbols") return this.names.outline(document);
    if (request.action === "definition") return this.names.find(document, request.position);
    return null;
  }
  private async queryServers(
    document: EditorDocument,
    request: {
      action: EditorQueryResult["action"];
      position: z.output<typeof queryEditor.input>["position"];
    },
    isCurrent: () => boolean,
  ): Promise<EditorQueryResult> {
    return this.pool.withDocument(
      document.root,
      document.file,
      async (servers) => {
        const result = emptyResult(request.action);
        result.source = "language-server";
        const needed = feature[request.action];
        let answered = false;
        let failed = false;
        for (const server of servers) {
          try {
            await server.connection.sync(document.file, document.text, server.languageId);
            if (needed && !server.connection.supports(needed)) continue;
            if (!needed) {
              answered = true;
              continue;
            }
            const value = await server.connection.request(`textDocument/${needed}`, {
              textDocument: { uri: fileUri(document.file) },
              position: request.position,
              context: { includeDeclaration: true, triggerKind: 1 },
            });
            mergeResult(result, value);
            answered = true;
          } catch (error) {
            failed = true;
            this.logger.warn(
              { err: error, action: request.action, serverId: server.row.id },
              "Editor query failed",
            );
          }
        }
        if (!answered) {
          result.state = failed ? "failed" : "unavailable";
          result.message = failed
            ? "The language server could not complete this request. Check Host → Code for details."
            : "No enabled language server supports this action. Check Host → Code.";
        }
        result.locations = dedupeLocations(result.locations);
        for (const location of result.locations) {
          // TypeScript canonicalizes a Windows drive to lowercase. Return the
          // owning host's actual spelling, so navigation reuses the open file.
          location.file =
            pathKey(location.file) === pathKey(document.file)
              ? document.file
              : await realpath(location.file);
        }
        return result;
      },
      isCurrent,
    );
  }
  private async planRename(input: unknown, clientId: string) {
    const request = planEditorRename.input.parse(input);
    return this.operations.run(clientId, request.root, async (isCurrent) => {
      const document = await this.canonical(request, clientId, isCurrent);
      return this.pool.withDocument(
        document.root,
        document.file,
        async (servers) => {
          const server = servers.find((entry) => entry.connection.supports("rename"));
          if (!server)
            throw new EditorError(
              "unavailable",
              "No enabled language server supports symbol rename for this file.",
            );
          await server.connection.sync(document.file, document.text, server.languageId);
          const value = await server.connection.request("textDocument/rename", {
            textDocument: { uri: fileUri(document.file) },
            position: request.position,
            newName: request.newName,
          });
          if (!isCurrent()) throw new EditorError("closed", "Editor demand was released.");
          return this.renames.plan({ clientId, root: document.root, value, origin: document });
        },
        isCurrent,
      );
    });
  }
  private observe(input: unknown, clientId: string) {
    const request = observeEditor.input.parse(input);
    this.assertHost(request.hostId);
    const root = this.documents.rootFor(clientId, request.documentId);
    return this.documents.observe(clientId, request.documentId, request.cursor, () =>
      this.pool
        .running()
        .filter((entry) => pathKey(entry.root) === pathKey(root))
        .map((entry) => ({ id: entry.serverId, indexing: [...entry.indexing] })),
    );
  }
  releaseClient(clientId: string) {
    this.guards.releaseClient(clientId);
    this.searches.releaseClient(clientId);
    this.operations.releaseClient(clientId);
    return this.documents.releaseClient(clientId);
  }
  async releaseWorkspace(root: string) {
    this.guards.releaseWorkspace(root);
    this.operations.releaseWorkspace(root);
    this.names.release(root);
    await this.documents.releaseWorkspace(root);
    await this.pool.releaseWorkspace(root);
    await this.solutions.releaseWorkspace(root);
  }
  async close() {
    this.guards.clear();
    this.closed = true;
    this.operations.close();
    this.names.close();
    await this.solutions.close();
    await this.pool.close();
    await this.documents.close();
    await this.renames.close();
    await stopAllEditorDotnetProcesses();
  }
}

function mergeResult(result: EditorQueryResult, value: unknown) {
  switch (result.action) {
    case "definition":
      result.locations.push(...definitionLocations(value));
      break;
    case "references":
      result.locations.push(...referenceLocations(value));
      break;
    case "hover": {
      const text = hoverText(value);
      if (text) result.hover = [result.hover, text].filter(Boolean).join("\n\n");
      break;
    }
    case "completion":
      result.completions.push(...completions(value));
      break;
    case "symbols":
      result.symbols.push(...symbols(value));
      break;
    case "diagnostics":
    case "workspaceSymbols":
      break;
  }
}
function dedupeLocations(
  locations: EditorQueryResult["locations"],
): EditorQueryResult["locations"] {
  const unique = new Map<string, EditorQueryResult["locations"][number]>();
  for (const location of locations)
    unique.set(JSON.stringify([pathKey(location.file), location.range]), location);
  return [...unique.values()].slice(0, 10000);
}
