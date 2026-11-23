/** Claude omits maintainer comments from injected instructions, but preserves code examples. */
export function claudeInstructionText(text: string, preserveOffsets = false): string {
  const state = new InstructionComments(preserveOffsets);
  return text
    .split(/(?<=\n)/u)
    .map((line) => state.line(line))
    .join("");
}
class InstructionComments {
  private comment = false;
  private fence: { token: string; length: number } | null = null;
  constructor(private readonly preserveOffsets: boolean) {}
  private omitted(text: string): string {
    // UTF-16 replacement keeps dependency offsets stable, including comments with emoji.
    return text.replace(/[^\r\n]/g, this.preserveOffsets ? " " : "");
  }
  private fenced(raw: string): boolean {
    if (this.comment) return false;
    const marker = raw.replace(/\r?\n$/u, "").match(/^\s{0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      const token = marker[1]!;
      if (!this.fence) this.fence = { token: token[0]!, length: token.length };
      else if (
        token[0] === this.fence.token &&
        token.length >= this.fence.length &&
        !marker[2]!.trim()
      )
        this.fence = null;
      return true;
    }
    return this.fence !== null;
  }
  line(raw: string): string {
    if (this.fenced(raw)) return raw;
    let result = "";
    for (let index = 0; index < raw.length; ) {
      if (this.comment) {
        const close = raw.indexOf("-->", index);
        const end = close < 0 ? raw.length : close + 3;
        result += this.omitted(raw.slice(index, end));
        index = end;
        this.comment = close < 0;
      } else if (raw.startsWith("<!--", index)) this.comment = true;
      else {
        const code = inlineCodeEnd(raw, index);
        const end = code ?? index + 1;
        result += raw.slice(index, end);
        index = end;
      }
    }
    return result;
  }
}
function inlineCodeEnd(raw: string, index: number): number | null {
  if (raw[index] !== "`") return null;
  let end = index + 1;
  while (raw[end] === "`") end++;
  const token = raw.slice(index, end);
  const close = raw.indexOf(token, end);
  return close < 0 ? null : close + token.length;
}
