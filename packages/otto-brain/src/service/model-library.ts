/** Host-resolved identities only. Guards and filesystem mutations remain synchronous. */
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrainPaths } from "../config/paths.js";
import type { Model } from "../types.js";
import { deleteModelFiles, deleteComponentFile, planDelete } from "../models/manage.js";
import { updateDisplayName, deleteDisplayName } from "../models/rename-map.js";
import type { BrainJobs } from "./jobs.js";
import { RequestError, readObject, sendJson } from "./http-body.js";

export interface ModelLibraryPorts {
  paths: BrainPaths;
  models(refresh?: boolean): Model[];
  isModelInUse(modelId: string): boolean;
  jobs: BrainJobs;
  changed(): void;
  requireWrite(request: IncomingMessage): void;
}

function artifacts(model: Model): string[] {
  const paths = [model.modelPath];
  if (model.mmprojPath) paths.push(model.mmprojPath);
  for (const component of model.components ?? []) if (component.path) paths.push(component.path);
  return paths.map((file) => path.resolve(file));
}

export class ModelLibrary {
  constructor(private readonly ports: ModelLibraryPorts) {}

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<boolean> {
    const url = new URL(request.url!, "http://brain.local");
    const action = `${request.method} ${url.pathname}`;
    const handlers = new Set([
      "GET /__host/model/delete-plan",
      "POST /__host/model/rename",
      "POST /__host/model/rename/reset",
      "DELETE /__host/model",
      "POST /__host/model/delete",
      "DELETE /__host/model/component",
    ]);
    if (!handlers.has(action)) return false;
    const id = url.searchParams.get("id");
    if (!id) throw new RequestError(400, "A model id is required");
    if (action === "GET /__host/model/delete-plan") {
      sendJson(response, 200, this.describeDelete(id));
      return true;
    }
    this.ports.requireWrite(request);
    let result: unknown;
    switch (action) {
      case "POST /__host/model/rename": {
        const body = await readObject(request, signal, 4096);
        if (typeof body.displayName !== "string")
          throw new RequestError(400, "A model name is required");
        result = this.rename(id, body.displayName);
        break;
      }
      case "POST /__host/model/rename/reset":
        result = this.resetName(id);
        break;
      case "DELETE /__host/model/component": {
        const component = url.searchParams.get("component");
        if (!component) throw new RequestError(400, "A component id is required");
        result = this.deleteComponent(id, component);
        break;
      }
      default:
        result = this.delete(id);
    }
    sendJson(response, 200, result);
    return true;
  }

  private model(id: string): Model {
    const model = this.ports.models().find((candidate) => candidate.id === id);
    if (!model) throw new RequestError(404, "Brain model not found");
    return model;
  }

  rename(id: string, displayName: string) {
    if (!displayName.trim() || displayName.length > 128)
      throw new RequestError(400, "Model names must contain 1 to 128 characters");
    this.model(id);
    updateDisplayName(id, displayName.trim(), this.ports.paths);
    return this.renamed(id);
  }

  resetName(id: string) {
    this.model(id);
    deleteDisplayName(id, this.ports.paths);
    return this.renamed(id);
  }

  private renamed(id: string) {
    const model = this.ports.models(true).find((candidate) => candidate.id === id);
    this.ports.changed();
    return { displayName: model?.displayName ?? null };
  }

  describeDelete(id: string) {
    const plan = planDelete(this.model(id));
    return {
      bytes: plan.bytes,
      includesProjector: plan.includesProjector,
      componentIds: plan.componentIds,
    };
  }

  private guardDelete(model: Model, files: string[]): void {
    if (this.ports.isModelInUse(model.id))
      throw new RequestError(
        409,
        "Unload the model and finish its queued work before deleting files",
      );
    const activeJobs = this.ports.jobs
      .summaries()
      .filter((job) => job.state === "queued" || job.state === "running");
    if (activeJobs.some((job) => job.subject.modelId === model.id))
      throw new RequestError(409, "Finish the model's queued operations before deleting files");
    if (activeJobs.some((job) => job.operation === "pull"))
      throw new RequestError(409, "Finish model downloads before deleting model files");
    const removing = new Set(files.map((file) => path.resolve(file)));
    if (
      this.ports
        .models()
        .some(
          (other) => other.id !== model.id && artifacts(other).some((file) => removing.has(file)),
        )
    )
      throw new RequestError(409, "Another installed model still references these files");
  }

  delete(id: string) {
    const model = this.model(id);
    const plan = planDelete(model);
    this.guardDelete(model, plan.files);
    // No await between admission checks and the existing synchronous deletion library.
    const removed = deleteModelFiles(model);
    this.ports.models(true);
    this.ports.changed();
    return { bytes: removed.bytes, componentIds: removed.componentIds };
  }

  deleteComponent(id: string, componentId: string) {
    const model = this.model(id);
    const component = model.components?.find((candidate) => candidate.id === componentId);
    if (!component?.path) throw new RequestError(404, "Brain component not found");
    if (component.required || path.resolve(component.path) === path.resolve(model.modelPath))
      throw new RequestError(409, "Required model components cannot be deleted separately");
    this.guardDelete(model, [component.path]);
    const removed = deleteComponentFile(model, componentId);
    this.ports.models(true);
    this.ports.changed();
    return { bytes: removed.bytes, componentIds: removed.componentIds };
  }
}
