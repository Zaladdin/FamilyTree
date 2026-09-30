/** Plain-text prose retains paragraphs and interior spacing; names use normalizeText. */
export function normalizeMultilineText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}
