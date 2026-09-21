import assert from "node:assert/strict";
import test from "node:test";
import { setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import { loadInlineMinScale } from "../src/config.js";
import { createSvgMathRenderer } from "../src/svg-renderer.js";
import { insertFormulaImages, type FormulaImagePlacement } from "../src/image-layout.js";

test("inline minimum scale accepts 0–1 and safely defaults invalid values", () => {
  assert.equal(loadInlineMinScale({}), 0);
  for (const value of ["0", "0.75", "1"]) {
    assert.equal(loadInlineMinScale({ PI_MATH_INLINE_MIN_SCALE: value }), Number(value));
  }
  for (const value of ["-1", "1.1", "NaN", "Infinity", "junk"]) {
    assert.equal(loadInlineMinScale({ PI_MATH_INLINE_MIN_SCALE: value }), 0);
  }
});

test("adaptive raster preserves minimum scale, legacy mode, and width limits", async () => {
  const renderer = await createSvgMathRenderer();
  const layout = { maxWidthCells: 80, maxHeightCells: 31, cellWidthPx: 9, cellHeightPx: 18, fitHeight: true };
  const formula = String.raw`\displaystyle\frac{1}{1+\frac{1}{x}}`;
  const legacy = renderer.render(formula, false, undefined, { ...layout, maxHeightCells: 1 });
  const adaptive = renderer.render(formula, false, undefined, { ...layout, inlineMinScale: 0.75 });
  const full = renderer.render(formula, false, undefined, { ...layout, inlineMinScale: 1 });
  assert.ok(legacy && adaptive && full);
  assert.equal(legacy.rows, 1);
  assert.ok(adaptive.rows > 1);
  const fraction = renderer.render(String.raw`\frac{a}{b}`, false, undefined, { ...layout, inlineMinScale: 1 });
  assert.ok(fraction);
  assert.equal(fraction.rows, 2);
  // Extra cell padding belongs above the formula, not below it.
  assert.ok(fraction.heightPx - fraction.inkBounds.bottom <= 2 * fraction.deviceScale);
  assert.ok(fraction.inkBounds.top > fraction.heightPx - fraction.inkBounds.bottom);
  assert.ok(fraction.inkBounds.bottom < fraction.heightPx);
  const centered = renderer.render(String.raw`\frac{a}{b}`, false, undefined, {
    ...layout, fitHeight: false,
  });
  assert.ok(centered);
  assert.equal(fraction.pixelsPerEx, centered.pixelsPerEx);
  assert.equal(fraction.heightPx, centered.heightPx);
  assert.ok(fraction.inkBounds.bottom > centered.inkBounds.bottom);
  assert.equal(adaptive.pixelsPerEx, 9);
  assert.equal(full.pixelsPerEx, 9);
  assert.equal(adaptive.base64Data, full.base64Data);
  // Below the measured one-row scale, keep the legacy compact raster. Just
  // above it, reserve rows and return to full size instead of using the minimum.
  const threshold = legacy.pixelsPerEx / 9;
  const compact = renderer.render(formula, false, undefined, { ...layout, inlineMinScale: threshold - 0.01 });
  const expanded = renderer.render(formula, false, undefined, { ...layout, inlineMinScale: threshold + 0.01 });
  assert.ok(compact && expanded);
  assert.equal(compact.rows, 1);
  assert.equal(compact.base64Data, legacy.base64Data);
  assert.equal(expanded.pixelsPerEx, 9);
  assert.equal(expanded.base64Data, full.base64Data);
  const small = renderer.render("x", false, undefined, { ...layout, inlineMinScale: 0.75 });
  assert.equal(small?.rows, 1);
  const narrow = renderer.render(formula, false, undefined, { ...layout, maxWidthCells: 1, inlineMinScale: 1 });
  assert.ok(narrow);
  assert.equal(narrow.columns, 1);
  assert.ok(narrow.pixelsPerEx < 9);
});

test("adaptive bands reuse only unclaimed adjacent source blanks", () => {
  const names = ["TERM_PROGRAM", "TERM", "KITTY_WINDOW_ID", "GHOSTTY_RESOURCES_DIR"] as const;
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const placement: FormulaImagePlacement = {
    marker: "\ue001\ue001", imageId: 61, inline: true, fallbackText: "$x$",
    raster: {
      base64Data: "AA==", columns: 2, rows: 2, widthPx: 36, heightPx: 72,
      pixelsPerEx: 9, deviceScale: 2,
      inkBounds: { left: 1, top: 1, right: 35, bottom: 71 },
    },
  };
  const second = { ...placement, marker: "\ue002\ue002", imageId: 62 };
  const line = `left ${placement.marker} right`;
  const next = `next ${second.marker} end`;
  const render = (lines: string[]) => insertFormulaImages(lines, [placement, second], {
    renderWidth: 80, paddingX: 0,
  });
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  try {
    for (const terminal of ["kitty", "wezterm"]) {
      for (const name of names) delete process.env[name];
      process.env.TERM_PROGRAM = terminal;
      process.env.TERM = "xterm-256color";
      const band = render([line]);
      assert.equal(band.length, 2);
      assert.match(band[1]!, /left .* right/u);
      assert.deepEqual(render(["", line]), band);
      assert.deepEqual(render(["", line, ""]), [...band, ""]);
      assert.deepEqual(render(["\x1b[0m  \x1b[39m", line, "   "]), [...band, "   "]);
      assert.deepEqual(render(["", "", line, "", ""]), ["", ...band, "", ""]);
      assert.deepEqual(render(["before", "", line, "", "after"]), ["before", ...band, "", "after"]);
      assert.deepEqual(render(["before", line, "after"]), ["before", ...band, "after"]);
      // Only the following band claims separators; occupied image rows are
      // never reused, including native placements with blank continuation cells.
      assert.deepEqual(render([line, "", next]), [...band, ...render([next])]);
      assert.deepEqual(render([line, next]), [...band, ...render([next])]);
      assert.deepEqual(render([line, "", "", next]), [...band, "", ...render([next])]);
      for (const occupied of ["│", "-", "\x1b_Ga=p,i=1\x1b\\", "\x1b[2C"]) {
        assert.deepEqual(render([occupied, line, occupied]), [occupied, ...band, occupied]);
      }
      const tall = { ...placement, raster: { ...placement.raster, rows: 3, heightPx: 108 } };
      const tallRender = (lines: string[]) => insertFormulaImages(lines, [tall], { renderWidth: 80, paddingX: 0 });
      assert.deepEqual(tallRender(["", line, ""]), tallRender([line]));
      assert.deepEqual(tallRender(["", "", line, "", ""]), ["", ...tallRender([line]), ""]);
      // For every height, the prose row has at most one more image row above
      // than below. Both sides reuse blanks without double-claiming them.
      for (const rows of [2, 3, 4, 5, 6]) {
        const sized = { ...placement, raster: { ...placement.raster, rows, heightPx: rows * 36 } };
        const sizedNext = { ...sized, marker: second.marker, imageId: second.imageId };
        const sizedRender = (lines: string[]) => insertFormulaImages(lines, [sized, sizedNext], { renderWidth: 80, paddingX: 0 });
        const above = Math.ceil((rows - 1) / 2);
        const below = Math.floor((rows - 1) / 2);
        const result = sizedRender([line]);
        assert.equal(result.length, rows);
        assert.match(result[above]!, /left .* right/u);
        assert.deepEqual(sizedRender([
          ...Array<string>(above).fill(""), line, ...Array<string>(below).fill(""),
        ]), result);
        assert.deepEqual(sizedRender([line, "", next]), [...result, ...sizedRender([next])]);
      }
    }
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
  }
});

test("multirow placeholders share a balanced band and preserve ANSI/Unicode columns", async () => {
  const original = process.env.TERM_PROGRAM;
  process.env.TERM_PROGRAM = "kitty";
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  try {
    const renderer = await createSvgMathRenderer();
    const raster = renderer.render(String.raw`\frac{a}{b}`, false, undefined, {
      maxWidthCells: 30, maxHeightCells: 31, cellWidthPx: 9, cellHeightPx: 18, inlineMinScale: 1,
    });
    assert.ok(raster && raster.rows > 1);
    const a: FormulaImagePlacement = {
      marker: "\ue001".repeat(raster.columns), imageId: 51, raster, inline: true, fallbackText: "$a/b$",
    };
    const b = { ...a, marker: "\ue002".repeat(raster.columns), imageId: 52 };
    const line = `\x1b[31m世界 ${a.marker} and ${b.marker} end\x1b[0m`;
    const result = insertFormulaImages(["before", line, "after"], [a, b], { renderWidth: 80, paddingX: 0 });
    assert.equal(result.length, raster.rows + 2);
    assert.equal(result[0], "before");
    assert.equal(result.at(-1), "after");
    assert.match(result[1 + Math.ceil((raster.rows - 1) / 2)]!, /世界 .* and .* end/u);
    assert.ok(result.slice(1, -1).every((row) => visibleWidth(row) <= visibleWidth(line)));
    assert.equal((result.join("\n").match(/a=T/g) ?? []).length, 2);
    assert.ok(!result.join("\n").includes(a.marker));
    assert.deepEqual(insertFormulaImages([line], [a, b], { renderWidth: 80, paddingX: 0 }), result.slice(1, -1));
  } finally {
    if (original === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = original;
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
  }
});
