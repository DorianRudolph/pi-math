import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { highlightMathSelectionLine } from "../src/selection-highlight.js";

function stateAt(line: string, text: string) {
  const index = line.indexOf(text);
  assert.ok(index >= 0);
  const state = { reverse: false, bold: false, foreground: "default", background: "default", underlineColor: "default" };
  for (const match of line.slice(0, index).matchAll(/\x1b\[([0-9;]*)m/g)) {
    const codes = match[1]!.split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) Object.assign(state, { reverse: false, bold: false, foreground: "default", background: "default", underlineColor: "default" });
      else if (code === 1) state.bold = true;
      else if (code === 7) state.reverse = true;
      else if (code === 27) state.reverse = false;
      else if (code === 38 || code === 48 || code === 58) {
        const count = codes[i + 1] === 2 ? 5 : 3;
        const key = code === 38 ? "foreground" : code === 48 ? "background" : "underlineColor";
        state[key] = codes.slice(i, i + count).join(";");
        i += count - 1;
      } else if (code! >= 40 && code! <= 47) state.background = String(code);
    }
  }
  return state;
}

test("selection preserves image IDs, controls, wide graphemes, and original styling", () => {
  const placeholder = String.fromCodePoint(0x10eeee) + "\u0305\u0305";
  const graphics = "\x1b_Ga=T,U=1,i=12;AAAA\x1b\\";
  const metadata = "\x1b]7777;pi-math-copy;AAAA\x07";
  const link = "\x1b]8;;https://example.com\x1b\\";
  const line = `${metadata}\x1b[1;44m界${link}e\u0301\x1b]8;;\x1b\\ ${graphics}\x1b[38;2;0;0;12;58;2;0;0;5m${placeholder}\x1b[0m tail`;
  const result = highlightMathSelectionLine(line, 2, 6, [{ x: 4, width: 1 }]);
  assert.equal(visibleWidth(result), visibleWidth(line));
  assert.equal(stripTerminalSequences(result), stripTerminalSequences(line));
  for (const control of [graphics, metadata, link]) assert.equal(result.split(control).length, 2);
  assert.deepEqual(stateAt(result, "界"), stateAt(line, "界"));
  assert.equal(stateAt(result, "e\u0301").reverse, true);
  assert.deepEqual(stateAt(result, placeholder), {
    reverse: false, bold: true, foreground: "38;2;0;0;12",
    background: "48;2;128;128;128", underlineColor: "58;2;0;0;5",
  });
  assert.deepEqual(stateAt(result, "tail"), stateAt(line, "tail"));
});

test("selection survives SGR resets and restores styles after the selected range", () => {
  const result = highlightMathSelectionLine("a\x1b[0mbc", 0, 2, []);
  assert.equal(stateAt(result, "a").reverse, true);
  assert.equal(stateAt(result, "b").reverse, true);
  assert.equal(stateAt(result, "c").reverse, false);
  const untouched = "\x1b[31mxyz\x1b[0m";
  assert.equal(highlightMathSelectionLine(untouched, 1, 1, []), untouched);
});
