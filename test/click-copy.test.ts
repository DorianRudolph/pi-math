import assert from "node:assert/strict";
import test from "node:test";
import {
  Markdown, Container, Text, TuiAltScreen, TuiMainScreen,
  setCapabilities, setCellDimensions, stripTerminalSequences, visibleWidth,
  type Component, type MarkdownTheme, type Terminal, type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { createTerminalMathRenderer } from "../src/renderer.js";
import { installMarkdownMathPatch } from "../src/markdown-patch.js";
import { installFullscreenMathCopy } from "../src/fullscreen-copy.js";
import { insertFormulaImages, type FormulaHitRegion, type FormulaImagePlacement } from "../src/image-layout.js";

const identity = (text: string) => text;
const theme: MarkdownTheme = {
  heading: identity, link: identity, linkUrl: identity, code: identity,
  codeBlock: identity, codeBlockBorder: identity, quote: identity,
  quoteBorder: identity, hr: identity, listBullet: identity, bold: identity,
  italic: identity, strikethrough: identity, underline: identity,
};
const click = (x: number, y: number, width: number, height: number): TuiMouseEvent => ({
  type: "click", button: "left", x, y, screenX: x, screenY: y,
  width, height, shift: false, alt: false, ctrl: false,
});

class TestTerminal implements Terminal {
  columns = 60;
  rows = 24;
  kittyProtocolActive = false;
  input: (data: string) => void = () => {};
  start(onInput: (data: string) => void) { this.input = onInput; }
  stop() {}
  async drainInput() {}
  output = "";
  write(data: string) { this.output += data; }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
}

function setup() {
  const names = ["TERM_PROGRAM", "PI_MATH_INLINE_MIN_SCALE"] as const;
  const saved = names.map((name) => process.env[name]);
  process.env.TERM_PROGRAM = "kitty";
  process.env.PI_MATH_INLINE_MIN_SCALE = "1";
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  setCellDimensions({ widthPx: 9, heightPx: 18 });
  return () => {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
  };
}

function placeholderCell(lines: string[]): { x: number; y: number } {
  for (const [y, line] of lines.entries()) {
    const plain = stripTerminalSequences(line);
    const index = plain.indexOf(String.fromCodePoint(0x10eeee));
    if (index >= 0) return { x: visibleWidth(plain.slice(0, index)), y };
  }
  throw new Error("No formula placeholder");
}

test("hit regions follow reused blank rows, mixed heights, blocks, and fallback", () => {
  const restore = setup();
  const make = (marker: string, rows: number, inline = true): FormulaImagePlacement => ({
    marker, imageId: marker.charCodeAt(0), inline, fallbackText: `$${marker}$`,
    raster: { base64Data: "AA==", widthPx: 36, heightPx: rows * 36,
      columns: 2, rows, pixelsPerEx: 9, deviceScale: 2,
      inkBounds: { left: 1, top: 1, right: 35, bottom: rows * 36 - 1 } },
  });
  try {
    const a = make("aa", 3), b = make("bb", 1), c = make("cc", 2, false);
    const regions: FormulaHitRegion[] = [];
    const lines = ["before", "", "\x1b[31m世界 aa bb\x1b[0m", "", "cc", "after"];
    const area = { renderWidth: 20, paddingX: 2 };
    const result = insertFormulaImages(lines, [a, b, c], area, regions);
    assert.deepEqual(regions, [
      { x: 5, y: 1, width: 2, height: 3, source: "$aa$", inlineBaseline: 1 },
      { x: 8, y: 2, width: 2, height: 1, source: "$bb$", inlineBaseline: 0 },
      { x: 9, y: 5, width: 2, height: 2, source: "$cc$" },
    ]);
    assert.deepEqual(result, insertFormulaImages(lines, [a, b, c], area));
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    const fallback: FormulaHitRegion[] = [];
    insertFormulaImages(lines, [a, b, c], area, fallback);
    assert.deepEqual(fallback, []);
  } finally { restore(); }
});

test("Markdown clicks copy exact source, ignore non-clicks, and discard stale bounds", async () => {
  const restore = setup();
  const before = Object.getOwnPropertyDescriptor(Markdown.prototype, "handleMouse");
  const copied: string[] = [];
  const patch = installMarkdownMathPatch(await createTerminalMathRenderer(), (source) => copied.push(source));
  try {
    const formula = String.raw`\(\frac{a}{b}\)`;
    const markdown = new Markdown(`A long introductory sentence before 世界 ${formula} end`, 1, 1, theme);
    const component = markdown as Component;
    for (const width of [60, 20]) {
      const lines = markdown.render(width);
      const cell = placeholderCell(lines);
      const event = click(cell.x, cell.y, width, lines.length);
      assert.equal(component.handleMouse?.({ ...event, type: "press" }), undefined);
      assert.equal(component.handleMouse?.({ ...event, type: "drag" }), undefined);
      assert.equal(component.handleMouse?.({ ...event, type: "wheel" }), undefined);
      assert.equal(component.handleMouse?.({ ...event, shift: true }), undefined);
      assert.equal(component.handleMouse?.({ ...event, button: "right" }), undefined);
      assert.equal(component.handleMouse?.({ ...event, x: 0 }), undefined);
      assert.equal(component.handleMouse?.({ ...event, width: width + 1 }), undefined);
      assert.equal(component.handleMouse?.(event)?.handled, true);
      assert.equal(copied.at(-1), formula);
      assert.equal(component.handleMouse?.({ ...event, y: cell.y + 1 })?.handled, true);
    }
    const displaySource = String.raw`\[\frac{x}{y}\]`;
    const display = new Markdown(displaySource, 1, 0, theme);
    const displayLines = display.render(60);
    const imageY = displayLines.findIndex((line) => line.includes("\x1b_G"));
    assert.ok(imageY >= 0);
    const imageX = displayLines[imageY]!.indexOf("\x1b_G");
    assert.equal((display as Component).handleMouse?.(click(imageX, imageY, 60, displayLines.length))?.handled, true);
    assert.equal(copied.at(-1), displaySource);
    assert.equal((display as Component).handleMouse?.(click(0, imageY, 60, displayLines.length)), undefined);

    const lines = markdown.render(60), cell = placeholderCell(lines);
    const event = click(cell.x, cell.y, 60, lines.length);
    patch.setEnabled(false);
    assert.equal(component.handleMouse?.(event), undefined);
    patch.setEnabled(true);
    assert.equal(component.handleMouse?.(event), undefined);
    markdown.render(60);
    patch.clearTransformCache();
    assert.equal(component.handleMouse?.(event), undefined);
    markdown.render(60);
    markdown.setText("No formula");
    assert.equal(component.handleMouse?.(event), undefined);
    markdown.render(60);
    assert.equal(component.handleMouse?.(event), undefined);
  } finally {
    patch.uninstall();
    assert.deepEqual(Object.getOwnPropertyDescriptor(Markdown.prototype, "handleMouse"), before);
    restore();
  }
});

test("real fullscreen mouse dispatch copies; regular mode and drags do not", async () => {
  const restore = setup();
  const copied: string[] = [];
  const patch = installMarkdownMathPatch(await createTerminalMathRenderer(), (source) => copied.push(source));
  try {
    for (const fullscreen of [true, false]) {
      const terminal = new TestTerminal();
      const tui = fullscreen
        ? new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false })
        : new TuiMainScreen(terminal);
      const markdown = new Markdown(String.raw`left $\frac{a}{b}$ right`, 1, 0, theme);
      const container = new Container();
      container.addChild(new Text("Heading", 0, 0));
      container.addChild(markdown);
      tui.addChild(container);
      tui.start();
      try {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const cell = placeholderCell(markdown.render(terminal.columns));
        const x = cell.x, y = cell.y + 1; // Nested component-local coordinates.
        const startCount = copied.length;
        terminal.input(`\x1b[<0;${x + 1};${y + 1}M`);
        terminal.input(`\x1b[<32;${x + 2};${y + 1}M`);
        terminal.input(`\x1b[<0;${x + 2};${y + 1}m`);
        assert.equal(copied.length, startCount);
        terminal.input(`\x1b[<0;${x + 1};${y + 1}M`);
        terminal.input(`\x1b[<0;${x + 1};${y + 1}m`);
        assert.equal(copied.length, startCount + (fullscreen ? 1 : 0));
        if (fullscreen) assert.equal(copied.at(-1), String.raw`$\frac{a}{b}$`);
      } finally { tui.stop(); }
    }
  } finally { patch.uninstall(); restore(); }
});
