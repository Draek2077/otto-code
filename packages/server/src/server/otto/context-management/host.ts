import { readContextSource } from "./source-read.js";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import {
  changeContextEdge,
  readContextAgents,
  readContextPreview,
  readContextReport,
  type ContextSelection,
} from "@getpaseo/plugin/otto/context-management";
import {
  InstructionSource,
  instructionDigest,
  inspectProviderContext,
} from "@getpaseo/plugin/server/otto-openai";
import type { ContextAgent } from "./agents.js";
import { buildContextGraph, within } from "./graph.js";
import { changeInstructionEdge, ContextBusy, ContextConflict } from "./source-write.js";
import type { NativeContextInventory } from "./native-inventory.js";
import { nativeContextGraph } from "./native-graph.js";

interface AgentPort {
  list(): ContextAgent[];
  get(id: string): ContextAgent | null;
}
import { contextReport, type InspectedContext } from "./report.js";
export class ContextManagementService {
  constructor(
    private readonly ports: {
      hostId: string;
      home: string;
      workspaces: {
        get(
          id: string,
        ): Promise<{ workspaceId: string; cwd: string; archivedAt: string | null } | null>;
      };
      agents: AgentPort;
      providerOwner(providerId: string): string | undefined;
      invoke(pluginId: string, method: string, input: unknown): Promise<unknown>;
      nativeInspection?(
        agent: ContextAgent,
        location: { root: string; cwd: string },
      ): Promise<NativeContextInventory | null>;
    },
  ) {}

  private async workspace(scope: { hostId: string; workspaceId: string }) {
    if (scope.hostId !== this.ports.hostId) throw new Error("Select this workspace's owning host.");
    const workspace = await this.ports.workspaces.get(scope.workspaceId);
    if (!workspace || workspace.archivedAt)
      throw new Error("Select an active workspace on this host.");
    return { ...workspace, cwd: await realpath(workspace.cwd) };
  }
  private async readPrepared(
    input: ContextSelection,
    workspaceId: string,
  ): Promise<InspectedContext> {
    const agent = this.ports.agents.get(input.agentId!);
    if (!agent || agent.workspaceId !== workspaceId || agent.internal)
      throw new Error("The selected chat does not belong to this workspace.");
    const owner = this.ports.providerOwner(agent.provider);
    const visible = owner !== undefined;
    let prepared = null;
    if (visible && owner && agent.sessionId) {
      const response = inspectProviderContext.output.parse(
        await this.ports.invoke(owner, inspectProviderContext.name, {
          providerId: agent.provider,
          sessionId: agent.sessionId,
        }),
      );
      if (!response.ok) throw new Error(response.error.message);
      prepared = response.value;
    }
    return {
      provider: agent.provider,
      visible,
      prepared,
      blocks: prepared?.blocks ?? [],
      system: prepared?.system ?? "",
      tools: prepared?.tools ?? null,
    };
  }
  private async inspection(input: ContextSelection) {
    const workspace = await this.workspace(input);
    const home = await realpath(this.ports.home);
    const selected = input.agentId ? this.ports.agents.get(input.agentId) : null;
    if (
      input.agentId &&
      (!selected || selected.workspaceId !== workspace.workspaceId || selected.internal)
    )
      throw new Error("The selected chat does not belong to this workspace.");
    const cwd = await realpath(selected?.cwd ?? workspace.cwd);
    const source = await InstructionSource.create({ cwd, home });
    let inspected: InspectedContext;
    if (input.agentId) inspected = await this.readPrepared(input, workspace.workspaceId);
    else {
      const preview = await source.inspect();
      inspected = {
        provider: "Otto-owned harness preview",
        visible: true,
        prepared: null,
        blocks: preview.blocks,
        system: preview.text,
        tools: null,
      };
    }
    const root = source.workspaceRoot;
    if (selected && !inspected.visible && this.ports.nativeInspection) {
      const inventory = await this.ports.nativeInspection(selected, { root, cwd });
      if (inventory) {
        const graph = nativeContextGraph(inventory, root);
        inspected.native = { inventory, sections: graph.sections };
        return { ...contextReport(inspected, graph, input), graph, root };
      }
    }
    const graph = await buildContextGraph({
      blocks: inspected.blocks,
      root,
      home,
      cwd,
    });
    return { ...contextReport(inspected, graph, input), graph, root };
  }

  invoke(method: string, value: unknown): Promise<unknown> | undefined {
    switch (method) {
      case readContextAgents.name:
        return this.guard(async () => {
          const scope = readContextAgents.input.parse(value);
          await this.workspace(scope);
          return this.ports.agents
            .list()
            .filter((agent) => agent.workspaceId === scope.workspaceId && !agent.internal)
            .map((agent) => ({
              id: agent.id,
              label: agent.title ?? agent.id,
              provider: agent.provider,
            }));
        });
      case readContextReport.name:
        return this.guard(
          async () => (await this.inspection(readContextReport.input.parse(value))).report,
        );
      case readContextPreview.name:
        return this.guard(async () => {
          const input = readContextPreview.input.parse(value);
          const current = await this.inspection(input);
          if (current.report.revision !== input.revision)
            throw new ContextConflict("Context changed. Refresh before opening this preview.");
          if (input.nodeId) {
            const source = current.graph.sources.get(input.nodeId);
            if (!source)
              throw new ContextConflict("This source is no longer in the context graph.");
            if (
              !source.native &&
              !within(current.root, source.file) &&
              !within(await realpath(this.ports.home), source.file)
            )
              throw new Error("This source is outside the owning host boundary.");
            const text = source.loaded ? source.text : await readContextSource(source.file);
            return {
              text,
              revision: instructionDigest(text),
              label: current.report.nodes.find((node) => node.id === input.nodeId)!.label,
            };
          }
          const text = input.category ? current.sections[input.category] : undefined;
          if (text === undefined)
            throw new Error(
              "This provider-owned category is not visible. No prompt text was inferred.",
            );
          return { text, revision: input.revision, label: input.category! };
        });
      case changeContextEdge.name:
        return this.guard(async () => {
          const input = changeContextEdge.input.parse(value);
          const current = await this.inspection(input);
          if (current.report.revision !== input.revision)
            throw new ContextConflict("Context changed. Refresh and review the new graph first.");
          const selectedEdge = current.report.edges.find((edge) => edge.id === input.edgeId);
          if (!selectedEdge?.to)
            throw new Error("This dependency target is missing or outside the allowed roots.");
          const edge = current.graph.edits.get(input.edgeId);
          if (!edge) throw new Error("This dependency is read-only on its owning host.");
          const source = [...current.graph.sources.values()].find(
            (item) => item.file === edge.file,
          );
          if (!source) throw new ContextConflict("The owning source disappeared from the graph.");
          if (!source.editable)
            throw new Error("Host-owned instruction sources are read-only here.");
          return {
            changed: await changeInstructionEdge({
              root: current.root,
              edge,
              expectedRevision: source.revision,
              mode: input.mode,
            }),
          };
        });
    }
  }
  private async guard<T>(run: () => Promise<T>) {
    try {
      return { ok: true as const, value: await run() };
    } catch (error) {
      return { ok: false as const, error: contextError(error) };
    }
  }
}
function contextError(error: unknown) {
  if (error instanceof ContextConflict)
    return { code: "conflict" as const, message: error.message };
  if (error instanceof ContextBusy) return { code: "busy" as const, message: error.message };
  if (error instanceof z.ZodError)
    return { code: "invalid" as const, message: "This context request is invalid." };
  return {
    code: "unavailable" as const,
    message: error instanceof Error ? error.message : "Context is unavailable on its owning host.",
  };
}
