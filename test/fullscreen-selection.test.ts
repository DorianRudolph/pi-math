import assert from "node:assert/strict";
import test from "node:test";
import {
  Box, Markdown, TuiAltScreen, TuiMainScreen, setCapabilities, setCellDimensions,
  stripTerminalSequences, visibleWidth, type MarkdownTheme, type Terminal,
} from "@earendil-works/pi-tui";
import { installFullscreenMathCopy } from "../src/fullscreen-copy.js";
import { installMarkdownMathPatch } from "../src/markdown-patch.js";
import { createTerminalMathRenderer } from "../src/renderer.js";

const identity = (text: string) => text;
const theme: MarkdownTheme = {
  heading: identity, link: identity, linkUrl: identity, code: identity,
  codeBlock: identity, codeBlockBorder: identity, quote: identity,
  quoteBorder: identity, hr: identity, listBullet: identity, bold: identity,
  italic: identity, strikethrough: identity, underline: identity,
};
class FakeTerminal implements Terminal {
  columns = 60;
  rows = 40;
  kittyProtocolActive = false;
  input: (data: string) => void = () => {};
  output = "";
  start(onInput: (data: string) => void) { this.input = onInput; }
  stop() {}
  async drainInput() {}
  write(data: string) { this.output += data; }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  mouse(x: number, y: number, button: number, release = false) {
    this.input(`\x1b[<${button};${x + 1};${y + 1}${release ? "m" : "M"}`);
  }
  async drag(x1: number, y1: number, x2: number, y2: number) {
    this.mouse(x1, y1, 0);
    this.mouse(x2, y2, 32);
    this.mouse(x2, y2, 0, true);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function firstImageCell(line: string): number {
  const plain = stripTerminalSequences(line);
  const index = plain.indexOf(String.fromCodePoint(0x10eeee));
  assert.ok(index >= 0);
  return visibleWidth(plain.slice(0, index));
}

test("fullscreen selection substitutes LaTeX in text flow and uses native copy flashes", async () => {
  const savedTerm = process.env.TERM_PROGRAM;
  const savedScale = process.env.PI_MATH_INLINE_MIN_SCALE;
  process.env.TERM_PROGRAM = "kitty";
  process.env.PI_MATH_INLINE_MIN_SCALE = "1";
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  setCellDimensions({ widthPx: 9, heightPx: 18 });
  const copy = installFullscreenMathCopy();
  const patch = installMarkdownMathPatch(await createTerminalMathRenderer(), (source) => copy.copy(source));
  const terminal = new FakeTerminal();
  const copied: string[] = [];
  const flashes: string[] = [];
  let copyError: string | undefined;
  const tui = new TuiAltScreen(terminal, false, undefined, {
    copySelection: async (text) => { copied.push(text); return copyError ?? true; },
  });
  tui.flash = (message) => { flashes.push(message); };
  const inline = String.raw`$\frac{a}{b}$`;
  const second = String.raw`\(x+1\)`;
  const display = String.raw`\[\frac{A}{B}\]`;
  const markdown = new Markdown(`left ${inline} then ${second} right\n\n${display}\n\nlast paragraph`, 0, 0, theme);
  // Enclosing Box padding must shift metadata along with the visible content.
  const box = new Box(2, 1);
  box.addChild(markdown);
  tui.addChild(box);
  tui.start();
  try {
    tui.renderNow();
    assert.match(terminal.output, /pi-math-copy/);
    const lines = markdown.render(terminal.columns - 4);
    const proseY = lines.findIndex((line) => stripTerminalSequences(line).startsWith("left"));
    assert.ok(proseY > 0); // fraction occupies an extra row above
    const x = firstImageCell(lines[proseY]!) + 2;
    const y = proseY + 1;
    // Selecting only the elevated fraction cells does not copy inline math.
    await terminal.drag(x, y - 1, x + 1, y - 1);
    assert.equal(copied.length, 0);
    // Any overlap on the prose row includes the complete original expression.
    await terminal.drag(x, y, x + 1, y);
    assert.equal(copied.at(-1), inline);
    assert.equal(flashes.at(-1), "Copied!");
    await terminal.drag(x + 1, y, x, y);
    assert.equal(copied.at(-1), inline);
    const right = visibleWidth(lines[proseY]!) - 1 + 2;
    await terminal.drag(2, y, right, y);
    assert.equal(copied.at(-1), `left ${inline} then ${second} right`);
    // Upper image-only rows disappear from copied text, rather than leaving artifacts.
    await terminal.drag(2, y - 1, right, y);
    assert.equal(copied.at(-1), `  left ${inline} then ${second} right`);
    assert.doesNotMatch(copied.at(-1)!, /\x1b|\u{10eeee}/u);
    // The keyboard/manual copy path uses the same substitution when auto-copy is off.
    tui.setCopyOnSelect(false);
    const count = copied.length;
    await terminal.drag(x, y, x + 1, y);
    assert.equal(copied.length, count);
    assert.equal(await tui.copyActiveSelectionToClipboard(), true);
    assert.equal(copied.at(-1), inline);
    tui.setCopyOnSelect(true);

    // Click uses the very same clipboard callback and flash as selection.
    terminal.mouse(x, y, 0);
    terminal.mouse(x, y, 0, true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(copied.at(-1), inline);
    assert.equal(flashes.at(-1), "Copied!");

    const displayY = lines.findIndex((line, i) => i > proseY && line.includes("\x1b_G"));
    assert.ok(displayY > proseY);
    const displayLine = lines[displayY]!;
    const displayX = visibleWidth(displayLine.slice(0, displayLine.indexOf("\x1b_G"))) + 2;
    // Even native display-image continuation rows (normally empty strings) select.
    await terminal.drag(displayX, displayY + 2, displayX + 1, displayY + 2);
    assert.equal(copied.at(-1), display);
    await terminal.drag(displayX, displayY + 1, displayX + 1, displayY + 2);
    assert.equal(copied.at(-1), display); // emitted once across multiple rows
    // Selections spanning prose and display preserve their document order.
    await terminal.drag(2, y, displayX + 1, displayY + 2);
    const mixed = copied.at(-1)!;
    assert.ok(mixed.indexOf(inline) < mixed.indexOf(second));
    assert.ok(mixed.indexOf(second) < mixed.indexOf(display));
    assert.equal(mixed.split(display).length, 2);
    assert.doesNotMatch(mixed, /\x1b|\u{10eeee}/u);

    copyError = "Clipboard unavailable";
    terminal.mouse(x, y, 0);
    terminal.mouse(x, y, 0, true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(flashes.at(-1), copyError);
    copyError = undefined;

    // Standard prose still follows Pi's normal selection path.
    await terminal.drag(2, y, 5, y);
    assert.equal(copied.at(-1), "left");
    // Reflow updates both image placement and selection coordinates.
    terminal.columns = 24;
    tui.renderNow(true);
    const narrow = markdown.render(20);
    const baseline = narrow.findIndex((line) => stripTerminalSequences(line).startsWith("left"));
    const nx = firstImageCell(narrow[baseline]!) + 2;
    await terminal.drag(nx, baseline + 1, nx + 1, baseline + 1);
    assert.equal(copied.at(-1), inline);

    // Scroll clipping translates cell coordinates back to the same source rows.
    terminal.rows = 5;
    tui.renderNow(true);
    tui.scrollToTop();
    tui.scrollBy(1);
    tui.renderNow();
    await terminal.drag(nx, baseline, nx + 1, baseline);
    assert.equal(copied.at(-1), inline);
  } finally {
    tui.stop();
    patch.uninstall();
    copy.uninstall();
    if (savedTerm === undefined) delete process.env.TERM_PROGRAM; else process.env.TERM_PROGRAM = savedTerm;
    if (savedScale === undefined) delete process.env.PI_MATH_INLINE_MIN_SCALE; else process.env.PI_MATH_INLINE_MIN_SCALE = savedScale;
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
  }
});

test("regular mode emits no selection metadata and adapter cleanup restores fullscreen methods", async () => {
  const prototype = TuiAltScreen.prototype as unknown as Record<string, unknown>;
  const methods = ["doRender", "handleViewportInput", "getActiveSelectionText"];
  const original = methods.map((name) => prototype[name]);
  const adapter = installFullscreenMathCopy();
  const patch = installMarkdownMathPatch(await createTerminalMathRenderer(), (source) => adapter.copy(source));
  const terminal = new FakeTerminal();
  const tui = new TuiMainScreen(terminal);
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  tui.addChild(new Markdown("before $x$ after", 0, 0, theme));
  tui.start();
  try {
    tui.renderNow();
    assert.doesNotMatch(terminal.output, /pi-math-copy/);
  } finally {
    tui.stop(); patch.uninstall(); adapter.uninstall();
    assert.deepEqual(methods.map((name) => prototype[name]), original);
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
  }
});
