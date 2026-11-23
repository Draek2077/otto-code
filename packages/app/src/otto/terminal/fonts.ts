export const TERMINAL_SYMBOL_FONT = "OttoNerdSymbols";
export function isTerminalSymbol(text: string): boolean {
  const cp = text.codePointAt(0);
  if (cp === undefined) return false;
  return (
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xf0000 && cp <= 0xffffd) ||
    (cp >= 0x100000 && cp <= 0x10fffd)
  );
}
export function terminalFontStack(custom: string | undefined, fallback: string): string {
  const selected = custom?.trim() || fallback;
  const textStack = selected.replace(/(?:^|,\s*)monospace\s*$/u, "").trim();
  const prefix = textStack ? `${textStack}, ` : "";
  return `${prefix}${TERMINAL_SYMBOL_FONT}, monospace`;
}
