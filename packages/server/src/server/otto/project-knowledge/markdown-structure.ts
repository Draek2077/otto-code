/** Structural headings only: fenced examples cannot become provenance. */
export function knowledgeHeadingOffsets({
  content,
  heading,
}: {
  content: string;
  heading: string;
}): number[] {
  const lines = content.split("\n");
  const boundaries: number[] = [];
  let fence: { marker: string; width: number } | undefined;
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        delimiter &&
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.width &&
        !delimiter[2].trim()
      )
        fence = undefined;
    } else if (delimiter && (delimiter[1][0] !== "`" || !delimiter[2].includes("`"))) {
      fence = { marker: delimiter[1][0], width: delimiter[1].length };
    } else if (line === heading && lines[index - 1] === "" && lines[index + 1] === "")
      boundaries.push(offset);
    offset += line.length + 1;
  }
  return boundaries;
}
