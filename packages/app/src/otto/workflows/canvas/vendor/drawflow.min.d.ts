// Hand-written surface for the vendored Drawflow bundle (MIT, Jero Soler) —
// only the members the graph designer actually touches. The bundle is frozen
// (patched around, never edited), same treatment Draekz Forge gives it.

export interface DrawflowConnectionRef {
  node: string;
  input?: string;
  output?: string;
}

export interface DrawflowExportedNode {
  id: number;
  name: string;
  data: Record<string, unknown>;
  class: string;
  html: string;
  inputs: Record<string, { connections: DrawflowConnectionRef[] }>;
  outputs: Record<string, { connections: DrawflowConnectionRef[] }>;
  pos_x: number;
  pos_y: number;
}

export interface DrawflowExport {
  drawflow: {
    Home: {
      data: Record<string, DrawflowExportedNode>;
    };
  };
}

export default class Drawflow {
  constructor(container: HTMLElement);

  reroute: boolean;
  draggable_inputs: boolean;
  zoom: number;
  zoom_min: number;
  zoom_max: number;
  zoom_value: number;
  zoom_last_value: number;
  canvas_x: number;
  canvas_y: number;
  container: HTMLElement;
  precanvas: HTMLElement;
  connection_selected: unknown;
  /** True while the user is dragging a wire out of an output port. */
  connection: boolean;
  /** The element the current drag started from (an `.output` while wiring). */
  ele_selected: HTMLElement | null;
  /** The in-flight wire's <svg> while `connection` is true. */
  connection_ele: SVGElement | null;

  createCurvature(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    // Drawflow always passes these; the wrapper's orthogonal override ignores
    // them, so callers re-using it to redraw a wire may leave them off.
    curvature?: number,
    type?: string,
  ): string;
  zoom_enter(event: WheelEvent): void;
  zoom_refresh(): void;

  start(): void;
  addNode(
    name: string,
    inputs: number,
    outputs: number,
    posX: number,
    posY: number,
    className: string,
    data: Record<string, unknown>,
    html: string,
  ): number;
  addConnection(
    outputId: number | string,
    inputId: number | string,
    outputClass: string,
    inputClass: string,
  ): void;
  removeSingleConnection(
    outputId: number | string,
    inputId: number | string,
    outputClass: string,
    inputClass: string,
  ): boolean;
  removeNodeId(id: string): void;
  updateConnectionNodes(id: string): void;
  export(): DrawflowExport;
  clear(): void;
  contextmenu(event: MouseEvent): void;
  /** Drawflow reads only `type`/`clientX`/`clientY`/`target`, so the wrapper can
   *  hand it a synthetic event to land a snapped wire on a nearby port. */
  dragEnd(event: {
    type: string;
    clientX: number;
    clientY: number;
    target: EventTarget | null;
  }): void;
  on(event: string, callback: (payload: unknown) => void): boolean;
}
