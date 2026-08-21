import MarkdownIt from "markdown-it";

export function createAssistantMarkdownParser(): ReturnType<typeof MarkdownIt> {
  const parser = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  });
  const defaultValidateLink = parser.validateLink.bind(parser);

  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
