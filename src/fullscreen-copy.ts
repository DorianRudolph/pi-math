import { TuiAltScreen, sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { FormulaHitRegion } from "./image-layout.js";

// Pi has no public selection transform or click-copy API. Keep the private
// fullscreen adapter here, feature-detected and reversible. Regular TUI is never patched.
interface SelectionPoint { row: number; col: number; boundary?: boolean; scrollView?: object }
interface SelectionBounds { start: SelectionPoint; end: SelectionPoint }
interface LayoutBox {
  scrollView?: object;
  scrollContentLines?: readonly string[];
  children: LayoutBox[];
}
interface FullscreenInternals {
  doRender(): void;
  handleViewportInput(data: string): unknown;
  getActiveSelectionText(): string | undefined;
  getSelectionBounds(): SelectionBounds | undefined;
  getSelectionColumns(line: string, row: number, selection: SelectionBounds): { start: number; end: number };
  copyTextToClipboard(text: string): Promise<boolean>;
  flash(message: string, durationMs?: number): void;
  previousScreen: string[];
  currentLayout?: { root: LayoutBox };
}
interface CopySpan {
  id: string;
  x: number;
  width: number;
  source: string;
  copy: boolean;
}

// Zero-width, terminal-ignored OSC metadata survives enclosing component padding
// and Pi's scrollback layout. It is emitted only during fullscreen rendering,
// never stored in conversation history and stripped from clipboard text.
const MARKER_PREFIX = "\x1b]7777;pi-math-copy;";
const MARKER = /\x1b\]7777;pi-math-copy;([A-Za-z0-9+/=]+)\x07/g;
let renderingFullscreen = 0;
const ownerIds = new WeakMap<object, number>();
let nextOwnerId = 1;

export function annotateFullscreenMath(
  owner: object,
  lines: string[],
  regions: FormulaHitRegion[],
): string[] {
  if (!renderingFullscreen || regions.length === 0) return lines;
  let ownerId = ownerIds.get(owner);
  if (ownerId === undefined) {
    ownerId = nextOwnerId++;
    ownerIds.set(owner, ownerId);
  }
  const rows = new Map<number, CopySpan[]>();
  regions.forEach((region, index) => {
    for (let dy = 0; dy < region.height; dy++) {
      const row = region.y + dy;
      const spans = rows.get(row) ?? [];
      spans.push({
        id: `${ownerId}:${index}`, x: region.x, width: region.width,
        source: region.source,
        copy: region.inlineBaseline === undefined || dy === region.inlineBaseline,
      });
      rows.set(row, spans);
    }
  });
  return lines.map((line, row) => {
    const spans = rows.get(row);
    if (!spans) return line;
    const width = Math.max(...spans.map((span) => span.x + span.width));
    // Native display images have visually empty continuation rows. Reserve their
    // cells in the selection grid, just as Unicode placeholders already do.
    const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
    const data = Buffer.from(JSON.stringify(spans)).toString("base64");
    return `${MARKER_PREFIX}${data}\x07${padded}`;
  });
}

function spansInLine(line: string): CopySpan[] {
  const spans: CopySpan[] = [];
  for (const match of line.matchAll(MARKER)) {
    try {
      const value: unknown = JSON.parse(Buffer.from(match[1]!, "base64").toString("utf8"));
      if (!Array.isArray(value)) continue;
      const offset = visibleWidth(line.slice(0, match.index));
      for (const span of value) {
        if (!span || typeof span.id !== "string" || typeof span.source !== "string" ||
            typeof span.copy !== "boolean" || !Number.isSafeInteger(span.x) || span.x < 0 ||
            !Number.isSafeInteger(span.width) || span.width < 1) continue;
        spans.push({ ...span, x: offset + span.x });
      }
    } catch { /* Unknown or damaged metadata leaves the ordinary selection intact. */ }
  }
  return spans.sort((a, b) => a.x - b.x);
}

function findScrollLines(box: LayoutBox, scrollView: object): readonly string[] | undefined {
  if (box.scrollView === scrollView) return box.scrollContentLines;
  for (const child of box.children) {
    const lines = findScrollLines(child, scrollView);
    if (lines) return lines;
  }
  return undefined;
}

/** Substitute whole expressions in the original selection's text-flow order. */
export function mathSelectionText(
  rows: Array<{ line: string; start: number; end: number }>,
): { changed: boolean; text: string | undefined } {
  const copied = new Set<string>();
  const output: string[] = [];
  let changed = false;
  for (const { line, start, end } of rows) {
    const spans = spansInLine(line).filter((span) => span.x < end && span.x + span.width > start);
    if (!spans.length) {
      output.push(stripTerminalSequences(sliceByColumn(line, start, Math.max(0, end - start), true)).trimEnd());
      continue;
    }
    changed = true;
    let text = "";
    let cursor = start;
    for (const span of spans) {
      const left = Math.max(start, span.x);
      const right = Math.min(end, span.x + span.width);
      if (left < cursor) continue;
      text += stripTerminalSequences(sliceByColumn(line, cursor, left - cursor, true));
      if (span.copy && !copied.has(span.id)) {
        text += span.source;
        copied.add(span.id);
      }
      cursor = right;
    }
    text += stripTerminalSequences(sliceByColumn(line, cursor, Math.max(0, end - cursor), true));
    // Omit image-only continuation rows, not genuine paragraph separators.
    if (text.trim()) output.push(text.trimEnd());
  }
  const text = output.join("\n");
  return { changed, text: text.length ? text : undefined };
}

export function installFullscreenMathCopy(): { copy(source: string): void; uninstall(): void } {
  const prototype = TuiAltScreen.prototype as unknown as FullscreenInternals;
  const originalRender = prototype.doRender;
  const originalInput = prototype.handleViewportInput;
  const originalSelection = prototype.getActiveSelectionText;
  let active: FullscreenInternals | undefined;
  let installed = true;
  const supported = [originalRender, originalInput, originalSelection, prototype.getSelectionBounds,
    prototype.getSelectionColumns, prototype.copyTextToClipboard, prototype.flash]
    .every((method) => typeof method === "function");

  function render(this: FullscreenInternals) {
    if (!installed) return originalRender.call(this);
    renderingFullscreen++;
    try { return originalRender.call(this); }
    finally { renderingFullscreen--; }
  }
  function input(this: FullscreenInternals, data: string) {
    const previous = active;
    if (installed) active = this;
    try { return originalInput.call(this, data); }
    finally { active = previous; }
  }
  function selection(this: FullscreenInternals) {
    if (!installed) return originalSelection.call(this);
    const bounds = this.getSelectionBounds();
    if (!bounds) return originalSelection.call(this);
    const lines = bounds.start.scrollView
      ? this.currentLayout && findScrollLines(this.currentLayout.root, bounds.start.scrollView)
      : this.previousScreen;
    if (!lines) return originalSelection.call(this);
    const rows = [];
    for (let row = bounds.start.row; row <= bounds.end.row; row++) {
      const line = lines[row] ?? "";
      rows.push({ line, ...this.getSelectionColumns(line, row, bounds) });
    }
    const result = mathSelectionText(rows);
    return result.changed ? result.text : originalSelection.call(this);
  }
  if (supported) {
    prototype.doRender = render;
    prototype.handleViewportInput = input;
    prototype.getActiveSelectionText = selection;
  }
  return {
    copy(source) {
      const tui = active;
      if (!installed || !tui) return;
      // Same clipboard implementation and top-right flash as ordinary selection.
      void tui.copyTextToClipboard(source).catch((error: unknown) => {
        if (installed) tui.flash(error instanceof Error ? error.message : "Copy failed", 5000);
      });
    },
    uninstall() {
      installed = false;
      active = undefined;
      if (prototype.doRender === render) prototype.doRender = originalRender;
      if (prototype.handleViewportInput === input) prototype.handleViewportInput = originalInput;
      if (prototype.getActiveSelectionText === selection) prototype.getActiveSelectionText = originalSelection;
    },
  };
}
