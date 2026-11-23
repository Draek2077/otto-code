import type { ViewKind, ViewSpecification } from "@getpaseo/plugin/otto/architectural-views";

/** Explicit staged content, never a claim that architecture was inferred. */
export function viewStarter(kind: ViewKind, title: string): ViewSpecification {
  const meta = { title };
  switch (kind) {
    case "architecture":
      return {
        schema_version: 1,
        diagram_type: kind,
        meta,
        components: [
          {
            id: "source",
            type: "backend",
            label: title,
            sublabel: "Knowledge source",
            pos: [300, 260],
            size: [220, 72],
          },
        ],
        boundaries: [],
        connections: [],
        cards: [
          {
            dot: "violet",
            title: "Unpublished draft",
            items: ["Author this View from its linked Knowledge before publishing."],
          },
        ],
      };
    case "workflow":
      return {
        schema_version: 1,
        diagram_type: kind,
        meta,
        lanes: [{ id: "knowledge", label: "Knowledge" }],
        mainPath: ["source", "outcome"],
        nodes: [
          {
            id: "source",
            lane: "knowledge",
            col: 0,
            type: "backend",
            label: "Source",
            sublabel: "Knowledge",
          },
          {
            id: "outcome",
            lane: "knowledge",
            col: 1,
            type: "external",
            label: "Outcome",
            sublabel: "To author",
          },
        ],
        edges: [{ id: "source-outcome", from: "source", to: "outcome", variant: "default" }],
      };
    case "sequence":
      return {
        schema_version: 1,
        diagram_type: kind,
        meta,
        participants: [
          { id: "source", type: "backend", label: "Source", sublabel: "Knowledge" },
          { id: "outcome", type: "external", label: "Outcome", sublabel: "To author" },
        ],
        messages: [
          {
            id: "source-outcome",
            from: "source",
            to: "outcome",
            y: 180,
            label: "Describe interaction",
            variant: "default",
          },
        ],
      };
    case "dataflow":
      return {
        schema_version: 1,
        diagram_type: kind,
        meta,
        stages: [{ label: "Source" }, { label: "Outcome" }],
        nodes: [
          {
            id: "source",
            type: "backend",
            label: title,
            sublabel: "Knowledge source",
            stage: 0,
            row: 0,
          },
          {
            id: "outcome",
            type: "external",
            label: "Outcome",
            sublabel: "To author",
            stage: 1,
            row: 0,
          },
        ],
        flows: [
          {
            id: "source-outcome",
            from: "source",
            to: "outcome",
            label: "Describe data",
            classification: "To author",
            variant: "default",
          },
        ],
      };
    case "lifecycle":
      return {
        schema_version: 1,
        diagram_type: kind,
        meta,
        lanes: [{ id: "main", label: "Lifecycle" }],
        states: [
          {
            id: "source",
            type: "start",
            label: "Source",
            sublabel: "Knowledge",
            lane: "main",
            col: 0,
          },
          {
            id: "outcome",
            type: "active",
            label: "Outcome",
            sublabel: "To author",
            lane: "main",
            col: 2,
          },
        ],
        transitions: [{ id: "source-outcome", from: "source", to: "outcome", variant: "default" }],
      };
  }
}
