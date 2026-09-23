import { visibleWidth } from "@earendil-works/pi-tui";

// Preserve control sequences in place: column slicing can duplicate image uploads
// and copy metadata by replaying all preceding ANSI codes on each sliced segment.
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]_^PX][\s\S]*?(?:\x07|\x1b\\)|[@-_])/g;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// Mid-grey remains visible behind either light or dark formula ink.
const IMAGE_SELECTION_BACKGROUND = "\x1b[27;48;2;128;128;128m";

/** Highlight selected prose normally, and image cells without inverting their ID colors. */
export function highlightMathSelectionLine(
  line: string,
  start: number,
  end: number,
  images: readonly { x: number; width: number }[],
): string {
  if (end <= start) return line;
  let result = "";
  let column = 0;
  let position = 0;
  let originalSgr = "";
  let mode: "none" | "text" | "image" = "none";
  let styleChanged = false;

  const appendText = (text: string) => {
    for (const { segment } of graphemes.segment(text)) {
      const width = visibleWidth(segment);
      const selected = column < end && column + width > start;
      const next = !selected ? "none" : images.some((image) =>
        column < image.x + image.width && column + width > image.x) ? "image" : "text";
      if (next !== mode || styleChanged) {
        // Replay only SGR, never image/control sequences. Restore the original
        // background and placeholder foreground/underline colors at each boundary.
        result += "\x1b[0m" + originalSgr;
        if (next === "image") result += IMAGE_SELECTION_BACKGROUND;
        else if (next === "text") result += "\x1b[7m";
        mode = next;
        styleChanged = false;
      }
      result += segment;
      column += width;
    }
  };

  for (const match of line.matchAll(ANSI)) {
    appendText(line.slice(position, match.index));
    const code = match[0];
    result += code;
    if (/^\x1b\[[0-9;:]*m$/.test(code)) {
      originalSgr = code === "\x1b[0m" || code === "\x1b[m" ? code : originalSgr + code;
      styleChanged = mode !== "none";
    }
    position = match.index + code.length;
  }
  appendText(line.slice(position));
  if (mode !== "none") result += "\x1b[0m" + originalSgr;
  return result;
}
