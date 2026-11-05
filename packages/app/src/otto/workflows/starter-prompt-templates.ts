import type { PromptTemplate } from "@getpaseo/plugin/otto/workflows";
// Inert gallery. Copy explicitly into the selected project; startup never seeds or overwrites files.
export const STARTER_TEMPLATES: PromptTemplate[] = [
  {
    id: "submit-rules",
    name: "Submit rules",
    description:
      "Shared rules for nodes that deliver structured output. Include this instead of repeating them.",
    snippet: true,
    builtIn: true,
    content: [
      "Deliver your result by calling the submit_output tool exactly once, when the work is done.",
      "The tool call is the deliverable - a summary written as prose instead of calling it does not count.",
      "If the tool rejects your submission, read the validation message, correct the values, and call it again.",
    ].join("\n"),
  },
  {
    id: "research-brief",
    name: "Research brief",
    description: "A focused research node: one angle, stated depth, structured hand-off.",
    builtIn: true,
    variables: [
      { key: "topic", label: "Topic", description: "What to research" },
      {
        key: "angle",
        label: "Angle",
        description: "The specific angle this node owns, so parallel researchers don't overlap",
      },
    ],
    content: [
      "Research this topic: <%= topic %>",
      "",
      "Cover this angle specifically, and leave the others to the researchers who own them: <%= angle %>",
      "",
      "Work from sources you can point to. Where you are inferring rather than reporting, say so.",
      "",
      "<%- include('submit-rules') %>",
    ].join("\n"),
  },
];
