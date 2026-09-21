import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { loadMathConfig, loadSvgMathRendererOptions } from "../src/config.js";

test("loads cross-platform renderer options without fixed font paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-math-config-"));
  const firstFont = join(directory, "math.ttf");
  const secondFont = join(directory, "text.otf");
  writeFileSync(firstFont, "fixture");
  writeFileSync(secondFont, "fixture");

  try {
    const options = loadSvgMathRendererOptions({
      PI_MATH_MACROS: JSON.stringify({ RR: String.raw`\mathbb{R}`, "\\vect": [String.raw`\mathbf{#1}`, 1] }),
      PI_MATH_ENVIRONMENTS: JSON.stringify({ braced: [String.raw`\left\{`, String.raw`\right\}`] }),
      PI_MATH_FONT_FILES: `${firstFont}${delimiter}${secondFont}`,
      PI_MATH_SYSTEM_FONTS: "false",
    });
    assert.deepEqual(options.macros, {
      RR: String.raw`\mathbb{R}`,
      vect: [String.raw`\mathbf{#1}`, 1],
    });
    assert.deepEqual(options.environments, {
      braced: [String.raw`\left\{`, String.raw`\right\}`],
    });
    assert.deepEqual(options.fontFiles, [firstFont, secondFont]);
    assert.equal(options.loadSystemFonts, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loads one global file with environment overrides and config-relative fonts", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-math-config-"));
  const path = join(directory, "pi-math.json");
  try {
    const defaults = loadMathConfig({}, directory);
    assert.equal(defaults.inlineMinScale, 0);
    assert.equal(defaults.loadSystemFonts, true);
    assert.equal(defaults.color, undefined);
    assert.equal(defaults.renderUnknownCommands, false);
    writeFileSync(join(directory, "font.ttf"), "fixture");
    writeFileSync(path, JSON.stringify({
      inlineMinScale: 0.75, color: "#112233", systemFonts: false, fontFiles: ["font.ttf"],
      renderUnknownCommands: true,
      macros: { RR: "global", keep: "keep" }, environments: { foo: ["begin", "end"] },
    }));
    const config = loadMathConfig({}, directory);
    assert.equal(config.inlineMinScale, 0.75);
    assert.equal(config.color, "#112233");
    assert.equal(config.loadSystemFonts, false);
    assert.equal(config.renderUnknownCommands, true);
    assert.deepEqual(config.fontFiles, [join(directory, "font.ttf")]);
    const override = loadMathConfig({
      PI_MATH_INLINE_MIN_SCALE: "0", PI_MATH_COLOR: "#abcdef", PI_MATH_SYSTEM_FONTS: "true",
      PI_MATH_RENDER_UNKNOWN_COMMANDS: "false",
      PI_MATH_MACROS: '{"RR":"env"}', PI_MATH_ENVIRONMENTS: '{"bar":["start","end"]}',
    }, directory);
    assert.equal(override.inlineMinScale, 0);
    assert.equal(override.color, "#abcdef");
    assert.equal(override.loadSystemFonts, true);
    assert.equal(override.renderUnknownCommands, false);
    assert.equal(loadMathConfig({ PI_MATH_RENDER_UNKNOWN_COMMANDS: "true" }, directory).renderUnknownCommands, true);
    assert.deepEqual(override.macros, { RR: "env", keep: "keep" });
    assert.deepEqual(override.environments, { foo: ["begin", "end"], bar: ["start", "end"] });
    writeFileSync(path, '{"fontFiles":[]}');
    assert.deepEqual(loadMathConfig({}, directory).fontFiles, []);
    assert.deepEqual(loadMathConfig({ PI_MATH_FONT_FILES: join(directory, "font.ttf") }, directory).fontFiles,
      [join(directory, "font.ttf")]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("invalid global config reports the file path", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-math-config-"));
  const path = join(directory, "pi-math.json");
  try {
    for (const value of ["broken JSON", "[]", '{"inlineMinScale":2}', '{"inlineMinScale":null}',
      '{"color":"blue"}', '{"systemFonts":"false"}', '{"macros":[]}',
      '{"fontFiles":["missing.ttf"]}', '{"renderUnknownCommands":"true"}', '{"unknown":true}']) {
      writeFileSync(path, value);
      assert.throws(() => loadMathConfig({}, directory), (error: Error) => error.message.includes(path));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("enables system font discovery by default and rejects malformed options", () => {
  assert.equal(loadSvgMathRendererOptions({}).loadSystemFonts, true);
  assert.throws(
    () => loadSvgMathRendererOptions({ PI_MATH_MACROS: "[]" }),
    /PI_MATH_MACROS must be a JSON object/u,
  );
  assert.throws(
    () =>
      loadSvgMathRendererOptions({
        PI_MATH_FONT_FILES: join(tmpdir(), "pi-math-font-does-not-exist.ttf"),
      }),
    /does not exist/u,
  );
});
