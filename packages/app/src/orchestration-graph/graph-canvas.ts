import type {
  GraphEdge,
  GraphNode,
  GraphQueryTool,
  OrchestrationGraph,
  PromptTemplate,
} from "@otto-code/protocol/orchestration";
import { OTTO_TOOL_GROUP_META } from "@/screens/settings/otto-tools-config";

import Drawflow from "./vendor/drawflow.min.js";
import type { GraphCanvasTheme } from "./graph-canvas-theme";
import {
  GRAPH_NODE_ROLES,
  buildRootNode,
  carryUneditedEdgeFields,
  carryUneditedNodeFields,
  formatOutputFields,
  formatQueryTools,
  formatTemplateVariables,
  graphEdgeKey,
  newGraphNodeId,
  parseOutputFields,
  parseQueryTools,
  parseTemplateVariables,
} from "./graph-doc";

// The DOM half of the graph designer (projects/orchestration-graphs): a
// Drawflow instance wrapped with the editor design ported from Draekz Forge's
// orch-canvas.js + 14-orchestration.css — the inner node card (title bar with
// type prefix, inline editable name, soft-red delete), arrow-shaped ports
// riding OUTSIDE the card border (output = accent, input = the warm counter
// hue; hollow until wired, solid once connected), orthogonal rounded-elbow
// wiring, cursor-anchored wheel zoom — re-skinned with Otto theme tokens.
// DOM-only: imported exclusively from the `.web.tsx` panel (CM6 precedent).
//
// Semantics the canvas encodes:
// - The single Orchestrator root hosts the chat and is the graph's entry point:
//   it takes the orchestration's own prompt automatically, so it has an OUTPUT
//   (kickoff) and no input. It can't be deleted either — if anything removes it
//   (Delete key, Drawflow's own bubble), it comes straight back where it was.
//   Nodes nobody consumes are the graph's final answers.
// - Declared graph inputs surface inside nodes: prompts reference
//   {{inputs.key}} (hint line lists the keys), and "Prompt from input" is a
//   select over the declared keys.

interface CanvasNodeInfo {
  nodeId: string;
  kind: "orchestrator" | "agent";
  title: string;
  role: string;
  prompt: string;
  promptFromInput: string;
  autonomous: boolean;
  loopMode: "none" | "times" | "until";
  loopCount: number;
  loopCriteria: string;
  model: string;
  /** Workspace access ceiling: "" (inherit/write), "read" or "none". */
  access: string;
  /** Declared output fields, in the card's one-per-line text form. */
  outputFields: string;
  /** Total attempts including the first; 1 means no retry. */
  retryAttempts: number;
  /** Wall-clock ceiling in seconds; 0 means none. */
  timeLimitSeconds: number;
  /** "" = inherit the tool policy; "only" = just the checked groups. */
  toolGroupsMode: "" | "only";
  /** Checked Otto tool groups, meaningful only while mode is "only". */
  toolGroups: Set<string>;
  /** Declared query tools, in the card's one-per-line text form. */
  queryTools: string;
  /** What the node arrived with, so an untouched line keeps its full detail. */
  queryToolsSource: GraphQueryTool[];
  /** Bound prompt template id; "" = use the node's own prompt. */
  templateId: string;
  /** Template variable bindings, one `name = value` per line. */
  templateVariables: string;
  /**
   * Everything about this node the canvas doesn't edit.
   *
   * The export path rebuilds each node from scratch, so without carrying these
   * forward, opening a graph that uses them and pressing Save would silently
   * delete them. A designer that can't yet edit a property must still be
   * incapable of destroying it.
   */
  carried: Partial<GraphNode>;
}

export interface GraphCanvasHandle {
  loadGraph(graph: OrchestrationGraph): void;
  /** Read the canvas back into a graph document (name/inputs come from `base`). */
  exportGraph(base: OrchestrationGraph): OrchestrationGraph;
  addAgentNode(): void;
  /** Refresh the declared-input affordances inside every node card. */
  setDeclaredInputs(keys: readonly string[]): void;
  /** Refresh the bindable prompt templates inside every node card. */
  setPromptTemplates(templates: readonly PromptTemplate[]): void;
  setTheme(theme: GraphCanvasTheme): void;
  destroy(): void;
}

/** Dotted-grid pitch in canvas units (scaled by zoom when painted). */
const GRID_SPACING = 22;
/** How close, in screen px, a dragged wire has to get before it attaches. */
const SNAP_RADIUS = 110;

export interface CreateGraphCanvasOptions {
  theme: GraphCanvasTheme;
  /** Fired on any user edit — node fields, moves, wires, deletes. */
  onChange(): void;
}

export function createGraphCanvas(
  container: HTMLElement,
  options: CreateGraphCanvasOptions,
): GraphCanvasHandle {
  const styleEl = document.createElement("style");
  styleEl.textContent = buildCanvasCss(options.theme);
  container.appendChild(styleEl);

  const canvasEl = document.createElement("div");
  canvasEl.className = "og-canvas";
  container.appendChild(canvasEl);

  const ed = new Drawflow(canvasEl);
  // Orthogonal wiring (ported from Forge): replace the cubic bezier with a
  // rounded elbow — H → V → H through the horizontal midpoint. Reroute
  // sub-segments are each one call, so they inherit the same routing.
  ed.createCurvature = (sx: number, sy: number, ex: number, ey: number) => {
    const midX = sx + (ex - sx) / 2;
    const hDir1 = Math.sign(midX - sx) || 1;
    const vDir = Math.sign(ey - sy) || 1;
    const hDir2 = Math.sign(ex - midX) || 1;
    const r = Math.min(14, Math.abs(midX - sx), Math.abs(ex - midX), Math.abs(ey - sy) / 2);
    if (!(r > 0.5)) {
      return ` M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ey} L ${ex} ${ey}`;
    }
    return (
      ` M ${sx} ${sy}` +
      ` L ${midX - hDir1 * r} ${sy}` +
      ` Q ${midX} ${sy} ${midX} ${sy + vDir * r}` +
      ` L ${midX} ${ey - vDir * r}` +
      ` Q ${midX} ${ey} ${midX + hDir2 * r} ${ey}` +
      ` L ${ex} ${ey}`
    );
  };
  ed.reroute = true;
  // A mousedown in a node's inputs/textarea must edit the field, not drag the node.
  ed.draggable_inputs = false;
  ed.zoom_min = 0.4;
  ed.zoom_max = 1.5;
  ed.zoom_value = 0.08;
  // Neutralize Drawflow's ctrl+wheel zoom — the cursor-anchored handler below owns it.
  ed.zoom_enter = () => {};
  ed.start();

  const infoByDfid = new Map<string, CanvasNodeInfo>();
  // Edge properties the canvas doesn't edit, keyed from→to, so a save can't
  // strip a condition the designer can't yet show.
  const carriedEdgeFields = new Map<string, Partial<GraphEdge>>();
  let declaredInputKeys: string[] = [];
  let promptTemplates: PromptTemplate[] = [];
  let suspended = false;
  const notifyChange = () => {
    if (!suspended) {
      options.onChange();
    }
  };

  // The dotted grid belongs to the CANVAS CONTENT, not to the viewport: pan the
  // graph and the dots have to travel with the nodes, or every node visibly
  // drifts off its own grid. Drawflow transforms the precanvas rather than
  // painting a background, so the background offset/scale is mirrored by hand
  // from its translate + zoom on every change.
  const paintGrid = (x: number, y: number) => {
    const spacing = GRID_SPACING * ed.zoom;
    canvasEl.style.backgroundSize = `${spacing}px ${spacing}px`;
    canvasEl.style.backgroundPosition = `${x}px ${y}px`;
  };
  const syncGrid = () => paintGrid(ed.canvas_x, ed.canvas_y);
  // Mid-drag, Drawflow transforms the precanvas from a local offset and only
  // writes canvas_x/canvas_y back on drag END, so the live pan is in the event
  // payload — reading ed.canvas_x here would leave the dots a whole drag behind.
  ed.on("translate", (payload) => {
    const pos = payload as { x: number; y: number };
    paintGrid(pos.x, pos.y);
  });
  // zoom_refresh dispatches "zoom" BEFORE rescaling canvas_x/canvas_y; defer a
  // tick so the offset we read is the post-scale one.
  ed.on("zoom", () => queueMicrotask(syncGrid));
  syncGrid();

  // Cursor-anchored wheel zoom (ported from Forge's orchWheelZoom, simplified
  // to a pannable fixed viewport): zoom_refresh scales the translate by the
  // zoom ratio; the correction keeps the point under the cursor fixed.
  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const next = Math.min(
      ed.zoom_max,
      Math.max(ed.zoom_min, ed.zoom + (event.deltaY < 0 ? ed.zoom_value : -ed.zoom_value)),
    );
    if (next === ed.zoom) {
      return;
    }
    const rect = canvasEl.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const ratio = next / ed.zoom;
    ed.zoom = next;
    ed.zoom_refresh();
    ed.canvas_x += px * (1 - ratio);
    ed.canvas_y += py * (1 - ratio);
    ed.precanvas.style.transform = `translate(${ed.canvas_x}px, ${ed.canvas_y}px) scale(${ed.zoom})`;
    syncGrid();
  };
  canvasEl.addEventListener("wheel", handleWheel, { passive: false });

  // Field sync: every editable control inside a node carries data-og-field;
  // delegated listeners keep the registry current without per-node wiring.
  const syncField = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const field = target.dataset.ogField;
    const nodeEl = target.closest<HTMLElement>(".drawflow-node");
    if (!field || !nodeEl) {
      return;
    }
    const dfid = nodeEl.id.replace(/^node-/, "");
    const info = infoByDfid.get(dfid);
    if (!info) {
      return;
    }
    applyField(info, field, target);
    if (field === "loopMode") {
      updateLoopVisibility(nodeEl, info.loopMode);
    }
    if (field === "toolGroupsMode") {
      updateToolGroupVisibility(nodeEl, info.toolGroupsMode);
    }
    if (field === "templateId") {
      updateTemplateVisibility(nodeEl, info.templateId);
    }
    notifyChange();
  };
  const handleInput = (event: Event) => syncField(event.target);
  canvasEl.addEventListener("input", handleInput);
  canvasEl.addEventListener("change", handleInput);

  // Advanced-disclosure toggles and delete buttons must not start a node drag
  // (Forge pattern: capture-phase stopPropagation before Drawflow's mousedown).
  const handleCaptureMouseDown = (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(".og-adv > summary") || target?.closest(".og-del")) {
      event.stopPropagation();
    }
  };
  canvasEl.addEventListener("mousedown", handleCaptureMouseDown, true);

  // Node delete buttons (the trash in each card's title bar).
  const handleClick = (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const deleteButton = target?.closest<HTMLElement>(".og-del");
    if (!deleteButton) {
      return;
    }
    const nodeEl = deleteButton.closest<HTMLElement>(".drawflow-node");
    if (!nodeEl) {
      return;
    }
    const dfid = nodeEl.id.replace(/^node-/, "");
    const info = infoByDfid.get(dfid);
    if (!info || info.kind === "orchestrator") {
      return;
    }
    ed.removeNodeId(`node-${dfid}`);
  };
  canvasEl.addEventListener("click", handleClick);

  // Show a wire's delete "x" on plain left-click, not just right-click (Forge
  // pattern: Drawflow selected the wire on its own mousedown; reusing its
  // contextmenu builder drops the delete box at the click point).
  const handleConnectionClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.button === 0 && ed.connection_selected && target?.closest(".connection")) {
      ed.contextmenu(event);
    }
  };
  canvasEl.addEventListener("mousedown", handleConnectionClick);

  // Easy snap: while a wire is in flight, the nearest input port within
  // SNAP_RADIUS becomes "attached" — it lights up, the wire's loose end jumps
  // to it, and releasing anywhere lands the connection there. Move away and it
  // detaches again. Drawflow itself only connects on a pixel-perfect drop onto
  // the port, which is a miserable target at 13px.
  let snapPort: HTMLElement | null = null;
  const clearSnap = () => {
    snapPort?.classList.remove("og-snap");
    snapPort = null;
  };

  const findSnapPort = (clientX: number, clientY: number): HTMLElement | null => {
    const sourceNode = ed.ele_selected?.closest(".drawflow-node") ?? null;
    let best: HTMLElement | null = null;
    let bestDistance = SNAP_RADIUS;
    for (const port of ed.container.querySelectorAll<HTMLElement>(".drawflow-node .input")) {
      if (sourceNode && port.closest(".drawflow-node") === sourceNode) {
        continue; // a node can't feed itself
      }
      const rect = port.getBoundingClientRect();
      const distance = Math.hypot(
        clientX - (rect.left + rect.width / 2),
        clientY - (rect.top + rect.height / 2),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = port;
      }
    }
    return best;
  };

  // Redraw the in-flight wire so it ends ON the snapped port instead of the
  // cursor. Runs after Drawflow's own mousemove (listener order), so it wins.
  const drawSnappedWire = (port: HTMLElement) => {
    const path = ed.connection_ele?.querySelector<SVGPathElement>(".main-path");
    const start = path?.getAttribute("d")?.match(/M\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    if (!path || !start) {
      return;
    }
    const canvasRect = canvasEl.getBoundingClientRect();
    const portRect = port.getBoundingClientRect();
    const endX = (portRect.left + portRect.width / 2 - canvasRect.left - ed.canvas_x) / ed.zoom;
    const endY = (portRect.top + portRect.height / 2 - canvasRect.top - ed.canvas_y) / ed.zoom;
    path.setAttribute("d", ed.createCurvature(Number(start[1]), Number(start[2]), endX, endY));
  };

  const handleSnapMove = (event: MouseEvent) => {
    if (ed.connection !== true) {
      clearSnap();
      return;
    }
    const next = findSnapPort(event.clientX, event.clientY);
    if (next !== snapPort) {
      clearSnap();
      snapPort = next;
      snapPort?.classList.add("og-snap");
    }
    if (snapPort) {
      drawSnappedWire(snapPort);
    }
  };
  canvasEl.addEventListener("mousemove", handleSnapMove);

  // Capture phase: Drawflow's own mouseup listener sits on this same element in
  // the bubble phase, so handling the drop here (with the port as the target it
  // would have wanted) and stopping propagation is what makes the snap land.
  const handleSnapUp = (event: MouseEvent) => {
    if (ed.connection !== true || !snapPort || event.target === snapPort) {
      clearSnap();
      return;
    }
    const port = snapPort;
    clearSnap();
    event.stopPropagation();
    ed.dragEnd({
      type: "mouseup",
      clientX: event.clientX,
      clientY: event.clientY,
      target: port,
    });
  };
  canvasEl.addEventListener("mouseup", handleSnapUp, true);

  // Ports read hollow until wired, solid once connected (Forge's empty→filled
  // language). Drawflow doesn't manage a class for that — recompute from its
  // export after every wiring change.
  const refreshConnectedPorts = () => {
    const exported = ed.export().drawflow.Home.data;
    for (const [dfid, record] of Object.entries(exported)) {
      const nodeEl = ed.container.querySelector<HTMLElement>(`#node-${dfid}`);
      if (!nodeEl) {
        continue;
      }
      const inputConnected = Object.values(record.inputs ?? {}).some(
        (port) => (port.connections ?? []).length > 0,
      );
      const outputConnected = Object.values(record.outputs ?? {}).some(
        (port) => (port.connections ?? []).length > 0,
      );
      nodeEl.querySelector(".input")?.classList.toggle("connected", inputConnected);
      nodeEl.querySelector(".output")?.classList.toggle("connected", outputConnected);
    }
  };

  // The orchestrator is structural, not a node you own: a graph without it has
  // no chat, no entry point and nothing to execute. Rather than police every
  // route that can delete a node (Delete key, Drawflow's own delete bubble), we
  // let the removal happen and immediately put it back where it stood.
  let rootDfid: string | null = null;
  let rootInfo: CanvasNodeInfo | null = null;
  let rootPosition = { x: 80, y: 80 };

  ed.on("nodeRemoved", (dfid) => {
    const removed = String(dfid);
    const info = infoByDfid.get(removed);
    infoByDfid.delete(removed);
    if (removed === rootDfid && rootInfo && !suspended) {
      addNode(buildGraphNode(rootInfo, rootInfo.nodeId, rootPosition), rootPosition);
    }
    refreshConnectedPorts();
    if (info) {
      notifyChange();
    }
  });
  ed.on("nodeMoved", (dfid) => {
    if (String(dfid) === rootDfid) {
      const record = ed.export().drawflow.Home.data[String(dfid)];
      if (record) {
        rootPosition = { x: record.pos_x, y: record.pos_y };
      }
    }
    notifyChange();
  });
  ed.on("connectionCreated", (payload) => {
    // Reject self-wires post-hoc (Drawflow has no pre-connection veto hook).
    const connection = payload as {
      output_id: string | number;
      input_id: string | number;
      output_class: string;
      input_class: string;
    };
    if (String(connection.output_id) === String(connection.input_id)) {
      ed.removeSingleConnection(
        connection.output_id,
        connection.input_id,
        connection.output_class,
        connection.input_class,
      );
      return;
    }
    refreshConnectedPorts();
    notifyChange();
  });
  ed.on("connectionRemoved", () => {
    refreshConnectedPorts();
    notifyChange();
  });

  // ── Edge inspector ────────────────────────────────────────────────────────
  // A wire carries meaning the wire itself can't show: a condition deciding
  // whether it delivers, and which of the upstream node's output fields it
  // hands on. Selecting a wire opens this panel; deselecting closes it.
  const edgeInspector = document.createElement("div");
  edgeInspector.className = "og-edge-inspector og-hidden";
  // The inspector positions against the container, so it must establish a
  // containing block even if the caller left it static.
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  edgeInspector.innerHTML =
    `<div class="og-edge-title" data-og-edge-title></div>` +
    `<label class="og-label">Condition <span class="og-hint">(JSONata over the upstream node's fields)</span></label>` +
    `<input class="og-input" data-og-edge="when" placeholder='complexity = "simple"' />` +
    `<label class="og-label">Fields carried <span class="og-hint">(comma-separated; blank = all)</span></label>` +
    `<input class="og-input" data-og-edge="fields" placeholder="all fields" />` +
    `<div class="og-inputs-hint" data-og-edge-note></div>`;
  container.appendChild(edgeInspector);

  let selectedEdgeKey: string | null = null;

  const inspectorInput = (name: string): HTMLInputElement | null =>
    edgeInspector.querySelector<HTMLInputElement>(`[data-og-edge="${name}"]`);

  const closeEdgeInspector = (): void => {
    selectedEdgeKey = null;
    edgeInspector.classList.add("og-hidden");
  };

  const openEdgeInspector = (from: string, to: string, fromTitle: string, toTitle: string) => {
    selectedEdgeKey = graphEdgeKey(from, to);
    const carried = carriedEdgeFields.get(selectedEdgeKey) ?? {};
    const title = edgeInspector.querySelector<HTMLElement>("[data-og-edge-title]");
    if (title) {
      title.textContent = `${fromTitle} → ${toTitle}`;
    }
    const whenInput = inspectorInput("when");
    if (whenInput) {
      whenInput.value = carried.when?.expression ?? "";
    }
    const fieldsInput = inspectorInput("fields");
    if (fieldsInput) {
      fieldsInput.value = (carried.fields ?? []).join(", ");
    }
    // A condition can only test declared fields; say so rather than let the
    // branch quietly never fire.
    const source = [...infoByDfid.values()].find((entry) => entry.nodeId === from);
    const note = edgeInspector.querySelector<HTMLElement>("[data-og-edge-note]");
    if (note) {
      note.textContent = source?.outputFields.trim()
        ? "Leave the condition blank to always deliver."
        : `"${fromTitle}" declares no output fields — a condition here can only test its prose as \`output\`.`;
    }
    edgeInspector.classList.remove("og-hidden");
  };

  const readEdgeInspector = (): void => {
    if (!selectedEdgeKey) {
      return;
    }
    const expression = inspectorInput("when")?.value.trim() ?? "";
    const fields = (inspectorInput("fields")?.value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const existing = carriedEdgeFields.get(selectedEdgeKey) ?? {};
    const next: Partial<GraphEdge> = {
      ...existing,
      ...(expression ? { when: { expression } } : {}),
      ...(fields.length > 0 ? { fields } : {}),
    };
    if (!expression) {
      delete next.when;
    }
    if (fields.length === 0) {
      delete next.fields;
    }
    if (Object.keys(next).length > 0) {
      carriedEdgeFields.set(selectedEdgeKey, next);
    } else {
      carriedEdgeFields.delete(selectedEdgeKey);
    }
    notifyChange();
  };

  edgeInspector.addEventListener("input", readEdgeInspector);
  // Keep clicks and drags inside the panel from reaching the canvas beneath.
  edgeInspector.addEventListener("pointerdown", (event) => event.stopPropagation());

  ed.on("connectionSelected", (payload) => {
    const selection = payload as { output_id?: string; input_id?: string };
    const from = infoByDfid.get(String(selection.output_id));
    const to = infoByDfid.get(String(selection.input_id));
    if (!from || !to) {
      closeEdgeInspector();
      return;
    }
    openEdgeInspector(from.nodeId, to.nodeId, from.title || "Upstream", to.title || "Downstream");
  });
  ed.on("connectionUnselected", closeEdgeInspector);
  ed.on("nodeSelected", closeEdgeInspector);

  const addNode = (node: GraphNode, position: { x: number; y: number }) => {
    const isRoot = node.kind === "orchestrator";
    const info = buildNodeInfo(node);
    // The root has an OUTPUT only: it is the entry point, fed automatically by
    // the orchestration's own prompt, so there is nothing to wire into it.
    const dfid = ed.addNode(
      info.kind,
      isRoot ? 0 : 1,
      1,
      position.x,
      position.y,
      isRoot ? "og-root" : "og-agent",
      {},
      isRoot
        ? buildRootNodeHtml(info)
        : buildAgentNodeHtml(info, declaredInputKeys, promptTemplates),
    );
    infoByDfid.set(String(dfid), info);
    if (isRoot) {
      rootDfid = String(dfid);
      rootInfo = info;
      rootPosition = position;
    }
    const nodeEl = ed.container.querySelector<HTMLElement>(`#node-${dfid}`);
    if (nodeEl && !isRoot) {
      updateLoopVisibility(nodeEl, info.loopMode);
      updateToolGroupVisibility(nodeEl, info.toolGroupsMode);
      updateTemplateVisibility(nodeEl, info.templateId);
    }
    return dfid;
  };

  const handle: GraphCanvasHandle = {
    loadGraph(graph) {
      suspended = true;
      try {
        closeEdgeInspector();
        ed.clear();
        infoByDfid.clear();
        rootDfid = null;
        rootInfo = null;
        declaredInputKeys = (graph.inputs ?? []).map((input) => input.key);
        carriedEdgeFields.clear();
        for (const edge of graph.edges ?? []) {
          const carried = carryUneditedEdgeFields(edge);
          if (Object.keys(carried).length > 0) {
            carriedEdgeFields.set(graphEdgeKey(edge.from, edge.to), carried);
          }
        }
        const dfidByNodeId = new Map<string, number>();
        const nodes = graph.nodes.some((node) => node.kind === "orchestrator")
          ? graph.nodes
          : [buildRootNode(), ...graph.nodes];
        nodes.forEach((node, index) => {
          const position = node.position ?? {
            x: 80 + (index % 4) * 360,
            y: 80 + Math.floor(index / 4) * 300,
          };
          dfidByNodeId.set(node.id, addNode(node, position));
        });
        // Older graphs may carry deliver-back edges into the root, from when it
        // had an input port. It has none now, so they simply don't draw.
        const rootNodeId = nodes.find((node) => node.kind === "orchestrator")?.id;
        for (const edge of graph.edges ?? []) {
          if (edge.to === rootNodeId) {
            continue;
          }
          const from = dfidByNodeId.get(edge.from);
          const to = dfidByNodeId.get(edge.to);
          if (from !== undefined && to !== undefined && from !== to) {
            ed.addConnection(from, to, "output_1", "input_1");
          }
        }
        refreshConnectedPorts();
      } finally {
        suspended = false;
      }
    },

    exportGraph(base) {
      const exported = ed.export().drawflow.Home.data;
      const usedIds = new Set<string>();
      const nodes: GraphNode[] = [];
      const nodeIdByDfid = new Map<string, string>();
      for (const [dfid, record] of Object.entries(exported)) {
        const info = infoByDfid.get(dfid);
        if (!info) {
          continue;
        }
        let nodeId = info.nodeId;
        if (usedIds.has(nodeId)) {
          nodeId = newGraphNodeId(usedIds);
        }
        usedIds.add(nodeId);
        nodeIdByDfid.set(dfid, nodeId);
        nodes.push(buildGraphNode(info, nodeId, { x: record.pos_x, y: record.pos_y }));
      }
      const edges: GraphEdge[] = [];
      for (const [dfid, record] of Object.entries(exported)) {
        const from = nodeIdByDfid.get(dfid);
        if (!from) {
          continue;
        }
        for (const output of Object.values(record.outputs ?? {})) {
          for (const connection of output.connections ?? []) {
            const to = nodeIdByDfid.get(String(connection.node));
            if (to && to !== from) {
              // Re-attach whatever this edge carried (condition, fields, ports,
              // label) — the canvas draws wires, it doesn't own their meaning.
              edges.push({ ...carriedEdgeFields.get(graphEdgeKey(from, to)), from, to });
            }
          }
        }
      }
      return { ...base, nodes, edges };
    },

    addAgentNode() {
      const existing = new Set([...infoByDfid.values()].map((info) => info.nodeId));
      const nodeId = newGraphNodeId(existing);
      const offset = infoByDfid.size;
      addNode(
        {
          id: nodeId,
          kind: "agent",
          title: `Agent ${existing.size}`,
          role: "researcher",
          prompt: "",
        } satisfies GraphNode,
        { x: 420 + (offset % 3) * 60, y: 80 + (offset % 5) * 60 },
      );
      notifyChange();
    },

    setDeclaredInputs(keys) {
      declaredInputKeys = [...keys];
      for (const [dfid, info] of infoByDfid) {
        if (info.kind === "orchestrator") {
          continue;
        }
        const nodeEl = ed.container.querySelector<HTMLElement>(`#node-${dfid}`);
        if (!nodeEl) {
          continue;
        }
        const hint = nodeEl.querySelector<HTMLElement>("[data-og-inputs-hint]");
        if (hint) {
          hint.textContent = buildInputsHintText(declaredInputKeys);
          hint.classList.toggle("og-hidden", declaredInputKeys.length === 0);
        }
        const select = nodeEl.querySelector<HTMLSelectElement>(
          'select[data-og-field="promptFromInput"]',
        );
        if (select) {
          select.innerHTML = buildPromptFromInputOptions(info.promptFromInput, declaredInputKeys);
        }
      }
    },

    setPromptTemplates(templates) {
      promptTemplates = [...templates];
      for (const [dfid, info] of infoByDfid) {
        if (info.kind === "orchestrator") {
          continue;
        }
        const select = ed.container.querySelector<HTMLSelectElement>(
          `#node-${dfid} select[data-og-field="templateId"]`,
        );
        if (select) {
          select.innerHTML = buildTemplateOptions(info.templateId, promptTemplates);
        }
      }
    },

    setTheme(theme) {
      styleEl.textContent = buildCanvasCss(theme);
    },

    destroy() {
      canvasEl.removeEventListener("mousemove", handleSnapMove);
      canvasEl.removeEventListener("mouseup", handleSnapUp, true);
      canvasEl.removeEventListener("wheel", handleWheel);
      canvasEl.removeEventListener("input", handleInput);
      canvasEl.removeEventListener("change", handleInput);
      canvasEl.removeEventListener("click", handleClick);
      canvasEl.removeEventListener("mousedown", handleConnectionClick);
      canvasEl.removeEventListener("mousedown", handleCaptureMouseDown, true);
      ed.clear();
      canvasEl.remove();
      styleEl.remove();
    },
  };
  return handle;
}

/** Project a graph node onto the editable state one card holds. */
function buildNodeInfo(node: GraphNode): CanvasNodeInfo {
  const loop = readLoopSettings(node);
  return {
    nodeId: node.id,
    kind: node.kind === "orchestrator" ? "orchestrator" : "agent",
    title: node.title,
    role: node.role ?? "researcher",
    prompt: node.prompt ?? "",
    promptFromInput: node.promptFromInput ?? "",
    autonomous: node.autonomous === true,
    loopMode: loop.mode,
    loopCount: loop.count,
    loopCriteria: loop.criteria,
    model: node.model ?? "",
    access: node.access ?? "",
    outputFields: formatOutputFields(node.output?.fields),
    retryAttempts: node.retry?.maxAttempts ?? 1,
    timeLimitSeconds: node.timeoutMs ? Math.round(node.timeoutMs / 1000) : 0,
    // An absent `tools` means "whatever the policy allows"; a present one —
    // including an empty array — is a deliberate narrowing.
    toolGroupsMode: node.tools ? "only" : "",
    toolGroups: new Set(node.tools ?? []),
    queryTools: formatQueryTools(node.queryTools),
    queryToolsSource: [...(node.queryTools ?? [])],
    templateId: node.promptTemplate?.templateId ?? "",
    templateVariables: formatTemplateVariables(node.promptTemplate?.variables),
    carried: carryUneditedNodeFields(node),
  };
}

function readLoopSettings(node: GraphNode): {
  mode: "none" | "times" | "until";
  count: number;
  criteria: string;
} {
  if (node.loop?.until) {
    return {
      mode: "until",
      count: node.loop.until.max,
      criteria: node.loop.until.criteria.join("\n"),
    };
  }
  if (node.loop?.times !== undefined) {
    return { mode: "times", count: node.loop.times, criteria: "" };
  }
  return { mode: "none", count: 3, criteria: "" };
}

function readControlValue(element: HTMLElement): string | boolean | null {
  if (element instanceof HTMLInputElement && element.type === "checkbox") {
    return element.checked;
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.value;
  }
  return null;
}

// One setter per data-og-field; a lookup keeps applyField itself trivial.
const FIELD_SETTERS: Record<string, (info: CanvasNodeInfo, value: string | boolean) => void> = {
  title: (info, value) => {
    info.title = String(value);
  },
  role: (info, value) => {
    info.role = String(value);
  },
  prompt: (info, value) => {
    info.prompt = String(value);
  },
  promptFromInput: (info, value) => {
    info.promptFromInput = String(value);
  },
  autonomous: (info, value) => {
    info.autonomous = value === true;
  },
  loopMode: (info, value) => {
    info.loopMode = value === "times" || value === "until" ? value : "none";
  },
  loopCount: (info, value) => {
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
      info.loopCount = Math.min(parsed, 16);
    }
  },
  loopCriteria: (info, value) => {
    info.loopCriteria = String(value);
  },
  model: (info, value) => {
    info.model = String(value);
  },
  access: (info, value) => {
    info.access = String(value);
  },
  outputFields: (info, value) => {
    info.outputFields = String(value);
  },
  retryAttempts: (info, value) => {
    const parsed = Number.parseInt(String(value), 10);
    info.retryAttempts = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 10) : 1;
  },
  timeLimitSeconds: (info, value) => {
    const parsed = Number.parseInt(String(value), 10);
    info.timeLimitSeconds = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 0), 21_600) : 0;
  },
  toolGroupsMode: (info, value) => {
    info.toolGroupsMode = value === "only" ? "only" : "";
  },
  queryTools: (info, value) => {
    info.queryTools = String(value);
  },
  templateId: (info, value) => {
    info.templateId = String(value);
  },
  templateVariables: (info, value) => {
    info.templateVariables = String(value);
  },
};

function applyField(info: CanvasNodeInfo, field: string, element: HTMLElement): void {
  const value = readControlValue(element);
  if (value === null) {
    return;
  }
  // Tool-group checkboxes all share one field name and name their group in a
  // data attribute, so the set — not a scalar — is what they mutate.
  if (field === "toolGroup") {
    const group = element.dataset.ogGroup;
    if (group) {
      if (value === true) {
        info.toolGroups.add(group);
      } else {
        info.toolGroups.delete(group);
      }
    }
    return;
  }
  FIELD_SETTERS[field]?.(info, value);
}

function buildGraphNode(
  info: CanvasNodeInfo,
  nodeId: string,
  position: { x: number; y: number },
): GraphNode {
  if (info.kind === "orchestrator") {
    return {
      ...info.carried,
      id: nodeId,
      kind: "orchestrator",
      title: info.title.trim() || "Orchestrator",
      position,
    };
  }
  const loop = buildLoopFromInfo(info);
  const outputFields = parseOutputFields(info.outputFields);
  const queryTools = parseQueryTools(info.queryTools, info.queryToolsSource);
  const templateVariables = parseTemplateVariables(info.templateVariables);
  return {
    // Carried first: canvas-owned properties below always win.
    ...info.carried,
    id: nodeId,
    kind: "agent",
    title: info.title.trim() || "Agent",
    role: info.role,
    ...(info.prompt.trim() ? { prompt: info.prompt } : {}),
    ...(info.promptFromInput.trim() ? { promptFromInput: info.promptFromInput.trim() } : {}),
    ...(info.autonomous ? { autonomous: true } : {}),
    ...(loop ? { loop } : {}),
    ...(info.model.trim() ? { model: info.model.trim() } : {}),
    ...(info.access ? { access: info.access } : {}),
    ...(outputFields.length > 0 ? { output: { fields: outputFields } } : {}),
    // 1 attempt is "no retry", so it writes no retry block at all.
    ...(info.retryAttempts > 1
      ? { retry: { maxAttempts: info.retryAttempts, backoffMs: 2000 } }
      : {}),
    ...(info.timeLimitSeconds > 0 ? { timeoutMs: info.timeLimitSeconds * 1000 } : {}),
    // "Only these groups" with nothing checked is a real declaration — no Otto
    // tools at all — so the empty array is written, not dropped.
    ...(info.toolGroupsMode === "only" ? { tools: [...info.toolGroups] } : {}),
    ...(queryTools.length > 0 ? { queryTools } : {}),
    ...(info.templateId
      ? {
          promptTemplate: {
            templateId: info.templateId,
            ...(Object.keys(templateVariables).length > 0 ? { variables: templateVariables } : {}),
          },
        }
      : {}),
    position,
  };
}

function buildLoopFromInfo(info: CanvasNodeInfo): GraphNode["loop"] | null {
  if (info.loopMode === "times") {
    return { times: info.loopCount };
  }
  if (info.loopMode === "until") {
    const criteria = info.loopCriteria
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return {
      until: {
        criteria: criteria.length > 0 ? criteria : ["The task is fully accomplished."],
        max: info.loopCount,
      },
    };
  }
  return null;
}

function updateLoopVisibility(nodeEl: HTMLElement, mode: "none" | "times" | "until"): void {
  nodeEl
    .querySelector<HTMLElement>(".og-loop-count")
    ?.classList.toggle("og-hidden", mode === "none");
  nodeEl
    .querySelector<HTMLElement>(".og-loop-criteria")
    ?.classList.toggle("og-hidden", mode !== "until");
}

function updateToolGroupVisibility(nodeEl: HTMLElement, mode: "" | "only"): void {
  nodeEl
    .querySelector<HTMLElement>(".og-tool-groups")
    ?.classList.toggle("og-hidden", mode !== "only");
}

function updateTemplateVisibility(nodeEl: HTMLElement, templateId: string): void {
  nodeEl
    .querySelector<HTMLElement>(".og-template-vars")
    ?.classList.toggle("og-hidden", !templateId);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Soft-red trash glyph (masked SVG, the Forge .of-del technique).
const DELETE_BUTTON_HTML = `<button class="og-del" title="Delete node" type="button"><i class="og-del-icon"></i></button>`;

function buildInputsHintText(keys: readonly string[]): string {
  if (keys.length === 0) {
    return "";
  }
  return `Prompts can reference ${keys.map((key) => `{{inputs.${key}}}`).join(", ")}`;
}

function buildPromptFromInputOptions(current: string, keys: readonly string[]): string {
  const known = new Set(keys);
  const options = [
    `<option value=""${current ? "" : " selected"}>None</option>`,
    ...keys.map(
      (key) =>
        `<option value="${escapeHtml(key)}"${key === current ? " selected" : ""}>${escapeHtml(key)}</option>`,
    ),
  ];
  if (current && !known.has(current)) {
    options.push(
      `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (missing)</option>`,
    );
  }
  return options.join("");
}

function buildToolGroupsHtml(info: CanvasNodeInfo): string {
  // A group the node selected that this build doesn't know about still gets a
  // checkbox, so saving can't quietly drop it.
  const known = new Set(OTTO_TOOL_GROUP_META.map((meta) => meta.group as string));
  const entries = [
    ...OTTO_TOOL_GROUP_META.map((meta) => ({ group: meta.group as string, label: meta.label })),
    ...[...info.toolGroups]
      .filter((group) => !known.has(group))
      .map((group) => ({ group, label: `${group} (unknown)` })),
  ];
  return entries
    .map(
      ({ group, label }) =>
        `<label class="og-check og-tool-group"><input type="checkbox" data-og-field="toolGroup" data-og-group="${escapeHtml(group)}"${info.toolGroups.has(group) ? " checked" : ""} /> ${escapeHtml(label)}</label>`,
    )
    .join("");
}

function buildTemplateOptions(current: string, templates: readonly PromptTemplate[]): string {
  // Snippets are meant to be included by other templates, not bound to a node —
  // offering them here would invite a node whose whole prompt is a fragment.
  // One a node is already bound to still shows, or the select would silently
  // misreport what the node does.
  const offered = templates.filter(
    (template) => template.snippet !== true || template.id === current,
  );
  const options = [
    `<option value=""${current ? "" : " selected"}>Use this node's prompt</option>`,
    ...offered.map(
      (template) =>
        `<option value="${escapeHtml(template.id)}"${template.id === current ? " selected" : ""}>${escapeHtml(template.name)}</option>`,
    ),
  ];
  if (current && !offered.some((template) => template.id === current)) {
    options.push(
      `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (missing)</option>`,
    );
  }
  return options.join("");
}

function buildRootNodeHtml(info: CanvasNodeInfo): string {
  return (
    `<div class="og-node og-node-root">` +
    `<div class="og-title"><span class="og-type og-type-root">Orchestrator</span>` +
    `<input class="og-name" data-og-field="title" value="${escapeHtml(info.title)}" placeholder="Name…" /></div>` +
    `<div class="og-ports-row og-ports-row-out"><span class="og-port-label og-port-label-out">Kickoff</span></div>` +
    `<div class="og-root-note">Hosts the orchestration chat and takes the orchestration's own prompt automatically. Its output kicks the graph off; whatever nothing else consumes comes back as the final answer.</div>` +
    `</div>`
  );
}

/** Whether anything only the Advanced disclosure shows is set — if so it opens,
 * because a collapsed card that hides a real constraint reads as a plain node. */
function hasAdvancedSettings(info: CanvasNodeInfo): boolean {
  return (
    info.autonomous ||
    info.promptFromInput !== "" ||
    info.model !== "" ||
    info.loopMode !== "none" ||
    info.access !== "" ||
    info.outputFields.trim().length > 0 ||
    info.retryAttempts > 1 ||
    info.timeLimitSeconds > 0 ||
    info.toolGroupsMode === "only" ||
    info.queryTools.trim().length > 0 ||
    info.templateId !== ""
  );
}

/** Dispatch shape: what the node is asked, by which brain, and how it repeats. */
function buildDispatchControlsHtml(
  info: CanvasNodeInfo,
  declaredInputs: readonly string[],
): string {
  return (
    `<label class="og-label">Prompt from input</label>` +
    `<select class="og-select" data-og-field="promptFromInput">${buildPromptFromInputOptions(info.promptFromInput, declaredInputs)}</select>` +
    `<label class="og-label">Model override <span class="og-hint">(provider/model)</span></label>` +
    `<input class="og-input" data-og-field="model" value="${escapeHtml(info.model)}" placeholder="Uses the team role's brain" />` +
    `<label class="og-check"><input type="checkbox" data-og-field="autonomous"${info.autonomous ? " checked" : ""} /> Autonomous <span class="og-hint">(may spawn its own agents)</span></label>` +
    `<div class="og-row">` +
    `<select class="og-select og-loop" data-og-field="loopMode">` +
    `<option value="none"${info.loopMode === "none" ? " selected" : ""}>No loop</option>` +
    `<option value="times"${info.loopMode === "times" ? " selected" : ""}>Repeat N times</option>` +
    `<option value="until"${info.loopMode === "until" ? " selected" : ""}>Until judge passes</option>` +
    `</select>` +
    `<input class="og-input og-loop-count og-hidden" data-og-field="loopCount" type="number" min="1" max="16" value="${info.loopCount}" />` +
    `</div>` +
    `<textarea class="og-prompt og-loop-criteria og-hidden" data-og-field="loopCriteria" rows="2" placeholder="Judge criteria, one per line">${escapeHtml(info.loopCriteria)}</textarea>`
  );
}

/** Catalog controls: which Otto tools the node keeps, what private read-only
 * lookups it gains, and whether its prompt comes from a stored template. */
function buildCatalogControlsHtml(
  info: CanvasNodeInfo,
  templates: readonly PromptTemplate[],
): string {
  return (
    `<label class="og-label">Otto tools</label>` +
    `<select class="og-select" data-og-field="toolGroupsMode">` +
    `<option value=""${info.toolGroupsMode === "" ? " selected" : ""}>Whatever the policy allows</option>` +
    `<option value="only"${info.toolGroupsMode === "only" ? " selected" : ""}>Only these groups</option>` +
    `</select>` +
    `<div class="og-tool-groups${info.toolGroupsMode === "only" ? "" : " og-hidden"}">${buildToolGroupsHtml(info)}</div>` +
    `<div class="og-inputs-hint">Narrowing intersects with the policy — a node can hand itself less authority, never more. Nothing checked means no Otto tools at all.</div>` +
    `<label class="og-label">Query tools <span class="og-hint">(name | kind | spec | description)</span></label>` +
    `<textarea class="og-prompt" data-og-field="queryTools" rows="2" placeholder="recent_commits | command | git log --oneline -n {{count}} | Recent commits">${escapeHtml(info.queryTools)}</textarea>` +
    `<div class="og-inputs-hint">Read-only lookups only this node gets. Kind is command (argv, no shell), http-get or file-read. Each {{name}} in the spec becomes a parameter.</div>` +
    `<label class="og-label">Prompt template</label>` +
    `<select class="og-select" data-og-field="templateId">${buildTemplateOptions(info.templateId, templates)}</select>` +
    `<textarea class="og-prompt og-template-vars${info.templateId ? "" : " og-hidden"}" data-og-field="templateVariables" rows="2" placeholder="topic = $inputs.subject">${escapeHtml(info.templateVariables)}</textarea>` +
    `<div class="og-inputs-hint">A bound template replaces this node's own prompt. Values are literals, $inputs.key, or $output.nodeId.field — one binding per line.</div>`
  );
}

function buildAgentNodeHtml(
  info: CanvasNodeInfo,
  declaredInputs: readonly string[],
  templates: readonly PromptTemplate[],
): string {
  const roleOptions = GRAPH_NODE_ROLES.map(
    (role) =>
      `<option value="${role}"${role === info.role ? " selected" : ""}>${role[0]?.toUpperCase()}${role.slice(1)}</option>`,
  ).join("");
  const hintText = buildInputsHintText(declaredInputs);
  return (
    `<div class="og-node">` +
    `<div class="og-title">` +
    `<span class="og-type">Agent<span class="og-sep"> ·</span></span>` +
    `<input class="og-name" data-og-field="title" value="${escapeHtml(info.title)}" placeholder="Name…" />` +
    DELETE_BUTTON_HTML +
    `</div>` +
    `<div class="og-ports-row"><span class="og-port-label og-port-label-in">In</span>` +
    `<span class="og-port-label og-port-label-out">Out</span></div>` +
    `<div class="og-body">` +
    `<label class="og-label">Role</label>` +
    `<select class="og-select" data-og-field="role">${roleOptions}</select>` +
    `<label class="og-label">Prompt</label>` +
    `<textarea class="og-prompt" data-og-field="prompt" rows="3" placeholder="Instruction for this agent…">${escapeHtml(info.prompt)}</textarea>` +
    `<div class="og-inputs-hint${hintText ? "" : " og-hidden"}" data-og-inputs-hint>${escapeHtml(hintText)}</div>` +
    `</div>` +
    `<details class="og-adv"${hasAdvancedSettings(info) ? " open" : ""}>` +
    `<summary><span class="og-caret"></span>Advanced</summary>` +
    `<div class="og-body og-adv-body">` +
    buildDispatchControlsHtml(info, declaredInputs) +
    `<label class="og-label">Workspace access</label>` +
    `<select class="og-select" data-og-field="access">` +
    `<option value=""${info.access === "" ? " selected" : ""}>Write (full access)</option>` +
    `<option value="read"${info.access === "read" ? " selected" : ""}>Read only</option>` +
    `<option value="none"${info.access === "none" ? " selected" : ""}>No workspace access</option>` +
    `</select>` +
    `<div class="og-inputs-hint">Enforced by withholding tools at spawn, not by asking the model. A seat whose provider can't enforce it refuses the run.</div>` +
    `<label class="og-label">Output fields <span class="og-hint">(one per line: name : type : description)</span></label>` +
    `<textarea class="og-prompt" data-og-field="outputFields" rows="3" placeholder="complexity : string : simple or complex">${escapeHtml(info.outputFields)}</textarea>` +
    `<div class="og-inputs-hint">Declaring fields gives this node a submit_output tool and lets edges from it carry conditions. Add ? after a name to make it optional.</div>` +
    `<div class="og-row">` +
    `<input class="og-input" data-og-field="retryAttempts" type="number" min="1" max="10" value="${info.retryAttempts}" title="Attempts (1 = no retry)" />` +
    `<input class="og-input" data-og-field="timeLimitSeconds" type="number" min="0" max="21600" value="${info.timeLimitSeconds}" title="Time limit in seconds (0 = none)" />` +
    `</div>` +
    `<div class="og-inputs-hint">Attempts · time limit (seconds, 0 = none)</div>` +
    buildCatalogControlsHtml(info, templates) +
    `</div>` +
    `</details>` +
    `</div>`
  );
}

// Base Drawflow CSS (vendored min.css, verbatim) + the Otto skin — the Forge
// design (14-orchestration.css) mapped onto Otto tokens. Injected as one style
// element per canvas; setTheme swaps it wholesale.
const DRAWFLOW_BASE_CSS = `.drawflow,.drawflow .parent-node{position:relative}.parent-drawflow{display:flex;overflow:hidden;touch-action:none;outline:0}.drawflow{width:100%;height:100%;user-select:none;perspective:0}.drawflow .drawflow-node{display:flex;align-items:center;position:absolute;background:#0ff;width:160px;min-height:40px;border-radius:4px;border:2px solid #000;color:#000;z-index:2;padding:15px}.drawflow .drawflow-node.selected{background:red}.drawflow .drawflow-node:hover{cursor:move}.drawflow .drawflow-node .inputs,.drawflow .drawflow-node .outputs{width:0}.drawflow .drawflow-node .drawflow_content_node{width:100%;display:block}.drawflow .drawflow-node .input,.drawflow .drawflow-node .output{position:relative;width:20px;height:20px;background:#fff;border-radius:50%;border:2px solid #000;cursor:crosshair;z-index:1;margin-bottom:5px}.drawflow .drawflow-node .input{left:-27px;top:2px;background:#ff0}.drawflow .drawflow-node .output{right:-3px;top:2px}.drawflow svg{z-index:0;position:absolute;overflow:visible!important}.drawflow .connection{position:absolute;pointer-events:none;aspect-ratio:1/1}.drawflow .connection .main-path{fill:none;stroke-width:5px;stroke:#4682b4;pointer-events:all}.drawflow .connection .main-path:hover{stroke:#1266ab;cursor:pointer}.drawflow .connection .main-path.selected{stroke:#43b993}.drawflow .connection .point{cursor:move;stroke:#000;stroke-width:2;fill:#fff;pointer-events:all}.drawflow .connection .point.selected,.drawflow .connection .point:hover{fill:#1266ab}.drawflow .main-path{fill:none;stroke-width:5px;stroke:#4682b4}.drawflow-delete{position:absolute;display:block;width:30px;height:30px;background:#000;color:#fff;z-index:4;border:2px solid #fff;line-height:30px;font-weight:700;text-align:center;border-radius:50%;font-family:monospace;cursor:pointer}.drawflow>.drawflow-delete{margin-left:-15px;margin-top:15px}.parent-node .drawflow-delete{right:-15px;top:-15px}`;

// Arrow-shaped ports (Forge's data-port-shape="arrow" variant, the default
// here): right-pointing triangles cut from the hue via an SVG alpha mask —
// hollow outline until a wire lands, solid once connected or hover-previewed.
const ARROW_OUTLINE_MASK = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2 2 L10 6 L2 10 Z' fill='none' stroke='black' stroke-width='2' stroke-linejoin='round'/></svg>") center / contain no-repeat`;
const ARROW_FILLED_MASK = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2 2 L10 6 L2 10 Z' fill='black' stroke='black' stroke-width='2' stroke-linejoin='round'/></svg>")`;
const CLOSE_ICON_MASK = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'/></svg>") center / contain no-repeat`;
const TRASH_ICON_MASK = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'/></svg>") center / contain no-repeat`;

function buildCanvasCss(theme: GraphCanvasTheme): string {
  const accentSoft = `color-mix(in srgb, ${theme.accent} 28%, transparent)`;
  return `${DRAWFLOW_BASE_CSS}
/* size/position are set imperatively (syncGrid) so the dots pan and zoom with the graph */
.og-canvas{width:100%;height:100%;background:${theme.background};background-image:radial-gradient(${theme.border} 1px, transparent 1px);background-size:${GRID_SPACING}px ${GRID_SPACING}px;font-family:${theme.fontFamilyUi};}
.og-canvas .drawflow{transform-origin:0 0;}
.og-canvas .drawflow .drawflow-node{background:transparent;border:0;padding:0;box-shadow:none;width:320px;min-height:0;align-items:flex-start;}
.og-canvas .drawflow .drawflow-node.og-root{width:260px;}
.og-canvas .drawflow .drawflow-node.selected{background:transparent;}
.og-canvas .drawflow .drawflow-node.selected .og-node{border-color:${theme.accent};box-shadow:0 0 0 2px ${accentSoft},0 6px 16px rgba(0,0,0,0.3);}
.og-canvas .drawflow_content_node{width:100%;}

/* the node card (Forge .of-node) */
.og-canvas .og-node{position:relative;background:${theme.surface};border:1.5px solid ${theme.border};width:100%;border-radius:10px;box-shadow:0 3px 10px rgba(0,0,0,0.28);font-size:12px;color:${theme.foreground};overflow:hidden;}
.og-canvas .og-node-root{border-left:3px solid ${theme.accent};}
.og-canvas .og-node-root::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:2;border-radius:8px;background:radial-gradient(130px 110px at 0% 20px, ${accentSoft}, transparent 72%);}
.og-canvas .og-node-root > .og-title{position:relative;z-index:3;}

/* title bar: "Type · Name" + delete (Forge .of-title) */
.og-canvas .og-title{box-sizing:border-box;height:32px;display:flex;align-items:center;gap:6px;padding:0 8px;font-weight:650;letter-spacing:0.01em;background:${theme.surfaceRaised};border-bottom:1px solid ${theme.border};white-space:nowrap;}
.og-canvas .og-type{flex:0 0 auto;color:${theme.foregroundMuted};font-size:11px;}
.og-canvas .og-type-root{color:${theme.accent};}
.og-canvas .og-sep{color:${theme.foregroundMuted};opacity:0.6;}
.og-canvas .og-name{flex:1 1 auto;min-width:40px;width:40px;background:transparent;border:none;padding:2px 4px;margin:0;font:inherit;font-weight:650;font-size:12px;color:${theme.foreground};border-radius:6px;outline:none;}
.og-canvas .og-name::placeholder{color:${theme.foregroundMuted};font-weight:500;font-style:italic;}
.og-canvas .og-name:hover{background:${theme.surface};}
.og-canvas .og-name:focus{background:${theme.surface};box-shadow:0 0 0 2px ${accentSoft};}
.og-canvas .og-del{flex:0 0 auto;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;background:none;cursor:pointer;border-radius:5px;}
.og-canvas .og-del-icon{display:block;width:14px;height:14px;background:color-mix(in srgb, ${theme.danger} 60%, ${theme.foregroundMuted});-webkit-mask:${TRASH_ICON_MASK};mask:${TRASH_ICON_MASK};}
.og-canvas .og-del:hover{background:color-mix(in srgb, ${theme.danger} 14%, transparent);}
.og-canvas .og-del:hover .og-del-icon{background:${theme.danger};}

/* port labels row — sits beside the dots so In/Out (Answers/Kickoff) read at a glance */
.og-canvas .og-ports-row{display:flex;justify-content:space-between;padding:5px 10px 0;font-size:10px;color:${theme.foregroundMuted};letter-spacing:0.04em;text-transform:uppercase;}
.og-canvas .og-ports-row-out{justify-content:flex-end;}

/* body */
.og-canvas .og-body{padding:8px 10px 10px;display:flex;flex-direction:column;gap:6px;}
.og-canvas .og-label{font-size:10px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:${theme.foregroundMuted};margin-top:2px;}
.og-canvas .og-hint{opacity:0.75;text-transform:none;letter-spacing:0;font-weight:500;}
.og-canvas .og-input,.og-canvas .og-select,.og-canvas .og-prompt{background:${theme.surfaceRaised};border:1px solid ${theme.border};border-radius:7px;color:${theme.foreground};font-family:${theme.fontFamilyUi};font-size:12px;padding:5px 8px;outline:none;width:100%;box-sizing:border-box;}
.og-canvas .og-prompt{font-family:${theme.fontFamilyMono};resize:vertical;min-height:44px;line-height:1.45;}
.og-canvas .og-input:focus,.og-canvas .og-select:focus,.og-canvas .og-prompt:focus{border-color:${theme.accent};box-shadow:0 0 0 2px ${accentSoft};}
.og-canvas .og-inputs-hint{font-size:10.5px;color:${theme.foregroundMuted};font-family:${theme.fontFamilyMono};line-height:1.5;word-break:break-all;}
.og-canvas .og-row{display:flex;align-items:center;gap:8px;}
.og-canvas .og-check{display:flex;align-items:center;gap:6px;font-size:11.5px;color:${theme.foreground};}
.og-canvas .og-tool-groups{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;padding:2px 0;}
.og-canvas .og-tool-group{font-size:11px;color:${theme.foregroundMuted};}
.og-canvas .og-loop{flex:1;}
.og-canvas .og-loop-count{width:58px;flex:none;}
.og-canvas .og-root-note{font-size:11px;color:${theme.foregroundMuted};line-height:1.5;padding:8px 10px 10px;}
.og-canvas .og-hidden{display:none;}
.og-hidden{display:none;}

/* Edge inspector — floats over the canvas while a wire is selected. */
.og-edge-inspector{position:absolute;top:12px;right:12px;z-index:6;width:250px;display:flex;flex-direction:column;gap:5px;padding:10px;border:1px solid ${theme.border};border-radius:10px;background:${theme.surface};box-shadow:0 10px 28px rgba(0,0,0,0.28);}
.og-edge-inspector .og-edge-title{font-size:11.5px;font-weight:700;color:${theme.foreground};margin-bottom:2px;}
.og-edge-inspector .og-label{font-size:10.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${theme.foregroundMuted};}
.og-edge-inspector .og-hint{font-weight:400;text-transform:none;letter-spacing:0;}
.og-edge-inspector .og-input{background:${theme.surfaceRaised};border:1px solid ${theme.border};border-radius:7px;color:${theme.foreground};font-family:${theme.fontFamilyMono};font-size:12px;padding:5px 8px;outline:none;width:100%;box-sizing:border-box;}
.og-edge-inspector .og-input:focus{border-color:${theme.accent};box-shadow:0 0 0 2px ${accentSoft};}
.og-edge-inspector .og-inputs-hint{font-size:10.5px;color:${theme.foregroundMuted};line-height:1.45;}

/* Advanced disclosure (Forge .of-adv) */
.og-canvas .og-adv{border-top:1px solid ${theme.border};}
.og-canvas .og-adv > summary{list-style:none;cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;padding:7px 10px;font-size:10.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${theme.foregroundMuted};}
.og-canvas .og-adv > summary::-webkit-details-marker{display:none;}
.og-canvas .og-adv > summary:hover{color:${theme.foreground};}
.og-canvas .og-caret{display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;transform:rotate(-90deg);transition:transform 0.12s ease;}
.og-canvas .og-adv[open] > summary .og-caret{transform:rotate(0deg);}
.og-canvas .og-adv-body{padding-top:0;}

/* ports — arrow-shaped, riding OUTSIDE the card border (Forge arrow variant).
   Output = accent (flow onward), input = the warm counter hue. Hollow until a
   wire lands; solid on hover-preview and once connected. */
.og-canvas .drawflow-node .inputs,.og-canvas .drawflow-node .outputs{margin-top:36px;}
.og-canvas .drawflow-node .input,.og-canvas .drawflow-node .output{width:13px;height:13px;top:0;margin-bottom:12px;border:0;border-radius:0;background:${theme.accent};-webkit-mask:${ARROW_OUTLINE_MASK};mask:${ARROW_OUTLINE_MASK};}
.og-canvas .drawflow-node .input{left:-17px;background:${theme.warning};}
.og-canvas .drawflow-node .output{right:-16px;}
.og-canvas .drawflow-node .input:hover,.og-canvas .drawflow-node .output:hover,.og-canvas .drawflow-node .input.connected,.og-canvas .drawflow-node .output.connected{-webkit-mask-image:${ARROW_FILLED_MASK};mask-image:${ARROW_FILLED_MASK};}
/* attached-while-near: the port a released wire would land on */
.og-canvas .drawflow-node .input.og-snap{-webkit-mask-image:${ARROW_FILLED_MASK};mask-image:${ARROW_FILLED_MASK};background:${theme.accent};transform:scale(1.35);}

/* wires — accent elbows, thicker + brighter on hover/selection (Forge) */
.og-canvas .connection{aspect-ratio:auto;height:100%;}
.og-canvas .connection .main-path{stroke:${theme.accent};stroke-width:3px;opacity:0.9;}
.og-canvas .connection .main-path:hover{stroke:${theme.accent};opacity:1;filter:brightness(1.2);cursor:pointer;}
.og-canvas .connection .main-path.selected{stroke:${theme.accent};opacity:1;filter:brightness(1.35);}
.og-canvas .connection .point{stroke:${theme.foregroundMuted};stroke-width:2;fill:${theme.surfaceRaised};}
.og-canvas .connection .point:hover,.og-canvas .connection .point.selected{fill:${theme.accent};}

/* Drawflow's injected delete bubble → themed round danger button with a masked X */
.og-canvas .drawflow-delete{width:22px;height:22px;line-height:0;font-size:0;display:flex;align-items:center;justify-content:center;background:${theme.danger};border:0;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.35);cursor:pointer;}
.og-canvas .drawflow-delete:hover{filter:brightness(1.12);}
.og-canvas .drawflow-delete::before{content:"";width:12px;height:12px;background:#fff;-webkit-mask:${CLOSE_ICON_MASK};mask:${CLOSE_ICON_MASK};}
`;
}
