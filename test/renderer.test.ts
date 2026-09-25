import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTerminalMathRenderer } from "../src/renderer.js";
import type { FormulaRasterLayout } from "../src/svg-renderer.js";
import { MATH_FONTS } from "../src/mathjax-fonts.js";
import { mathjax } from "@mathjax/src/cjs/mathjax.js";

const layout: FormulaRasterLayout = {
  maxWidthCells: 120,
  maxHeightCells: 32,
  cellWidthPx: 9,
  cellHeightPx: 18,
};

function isPng(base64: string): boolean {
  return Buffer.from(base64, "base64").subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

function assertTransparentBleed(result: NonNullable<ReturnType<Awaited<ReturnType<typeof createTerminalMathRenderer>>["render"]>>): void {
  assert.ok(result.inkBounds.left > 0);
  assert.ok(result.inkBounds.top > 0);
  assert.ok(result.inkBounds.right < result.widthPx);
  assert.ok(result.inkBounds.bottom < result.heightPx);
}

test("rasterizes LaTeX through MathJax SVG", async () => {
  const renderer = await createTerminalMathRenderer();
  const result = renderer.render(
    String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
    true,
    "#b5bd68",
    layout,
  );
  assert.ok(result);
  assert.ok(isPng(result.base64Data));
  assert.equal(result.widthPx, result.columns * layout.cellWidthPx * 2);
  assert.equal(result.heightPx, result.rows * layout.cellHeightPx * 2);
  assert.equal(result.pixelsPerEx, layout.cellHeightPx * 0.5);
  assert.equal(result.deviceScale, 2);
  assertTransparentBleed(result);
});

test("raster scale changes PNG resolution without changing terminal size", async () => {
  const low = await createTerminalMathRenderer({ rasterScale: 1 });
  const high = await createTerminalMathRenderer({ rasterScale: 2 });
  for (const display of [false, true]) {
    const formula = String.raw`\frac{x^2+1}{y}`;
    const first = low.render(formula, display, "#ffffff", layout);
    const second = high.render(formula, display, "#ffffff", layout);
    assert.ok(first && second);
    assert.equal(first.deviceScale, 1);
    assert.equal(second.deviceScale, 2);
    assert.equal(first.rows, second.rows);
    assert.equal(first.columns, second.columns);
    assert.equal(first.pixelsPerEx, second.pixelsPerEx);
    assert.equal(first.widthPx * 2, second.widthPx);
    assert.equal(first.heightPx * 2, second.heightPx);
    assertTransparentBleed(first);
    assertTransparentBleed(second);
    assert.equal(low.render(formula, display, "#ffffff", layout), first);
  }
});

test("base scale controls math size independently of raster density", async () => {
  for (const baseScale of [0.4, 0.6]) {
    const renderer = await createTerminalMathRenderer({ baseScale, rasterScale: 1 });
    for (const display of [false, true]) {
      const result = renderer.render("x+1", display, "#ffffff", layout);
      assert.ok(result, renderer.lastFailure?.message);
      assert.equal(result.pixelsPerEx, layout.cellHeightPx * baseScale);
      assert.equal(result.deviceScale, 1);
      assertTransparentBleed(result);
    }
    const expanded = renderer.render(String.raw`\frac{a}{b}`, false, "#ffffff", {
      ...layout, inlineMinScale: 1,
    });
    assert.ok(expanded);
    assert.equal(expanded.pixelsPerEx, layout.cellHeightPx * baseScale);
    const narrow = renderer.render("a+b+c+d+e+f", true, "#ffffff", { ...layout, maxWidthCells: 2 });
    assert.ok(narrow);
    assert.ok(narrow.pixelsPerEx < layout.cellHeightPx * baseScale);
    assert.equal(narrow.columns, 2);
  }
  for (const baseScale of [0, -1, NaN, Infinity]) {
    await assert.rejects(createTerminalMathRenderer({ baseScale }), /baseScale/u);
  }
});

test("uses one fixed font scale for every formula", async () => {
  const renderer = await createTerminalMathRenderer();
  const formulas = [
    String.raw`(a+b)^2=a^2+2ab+b^2`,
    String.raw`a^2+b^2=c^2`,
    String.raw`\int_a^b f(x)\,dx=F(b)-F(a)`,
    String.raw`e^x=\sum_{n=0}^{\infty}\frac{x^n}{n!}`,
  ];
  const rasters = formulas.map((formula) => renderer.render(formula, true, "#ffffff", layout));
  assert.ok(rasters.every(Boolean));
  assert.deepEqual(
    rasters.map((raster) => raster!.pixelsPerEx),
    Array.from({ length: formulas.length }, () => layout.cellHeightPx * 0.5),
  );
});

test("uses the smallest width-only shrink needed for oversized formulas", async () => {
  const renderer = await createTerminalMathRenderer();
  const formula = String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`;
  const medium = renderer.render(formula, true, "#fff000", { ...layout, maxWidthCells: 12 });
  const narrow = renderer.render(formula, true, "#fff000", { ...layout, maxWidthCells: 8 });
  assert.ok(medium);
  assert.ok(narrow);
  assert.equal(narrow.columns, 8);
  assert.ok(narrow.pixelsPerEx < medium.pixelsPerEx);
  assert.ok(medium.pixelsPerEx <= layout.cellHeightPx * 0.5);
  assert.equal(narrow.widthPx, 8 * layout.cellWidthPx * 2);
});

test("fits embedded inline formulas into one row without distortion", async () => {
  const renderer = await createTerminalMathRenderer();
  const result = renderer.render(String.raw`\frac{x^2+1}{y_1}`, false, "#ffffff", {
    ...layout,
    maxHeightCells: 1,
    fitHeight: true,
  });
  assert.ok(result);
  assert.equal(result.rows, 1);
  assert.ok(result.pixelsPerEx < layout.cellHeightPx * 0.5);
  assertTransparentBleed(result);
});

test("supports configured macros, explicit tags, and Unicode text", async () => {
  const renderer = await createTerminalMathRenderer({
    macros: { RR: String.raw`\mathbb{R}` },
  });
  for (const formula of [
    String.raw`x\in\RR`,
    String.raw`\begin{equation}a=b\tag{1}\end{equation}`,
    String.raw`x\text{ 是正数}`,
  ]) {
    const result = renderer.render(formula, true, "#ffffff", layout);
    assert.ok(result, renderer.lastFailure?.message);
    assertTransparentBleed(result);
  }
});

test("renders formulas taller than the former 32-row limit", async () => {
  const renderer = await createTerminalMathRenderer();
  const rows = Array.from({ length: 40 }, (_, index) => `x_{${index}}`).join(String.raw`\\`);
  const result = renderer.render(String.raw`\begin{matrix}${rows}\end{matrix}`, true, "#ffffff", {
    ...layout,
    maxHeightCells: 100,
  });
  assert.ok(result, renderer.lastFailure?.message);
  assert.ok(result.rows > 32);
  assertTransparentBleed(result);
});

test("drops raster density rather than rejecting very wide terminal canvases", async () => {
  const renderer = await createTerminalMathRenderer();
  const formula = Array.from({ length: 700 }, (_, index) => `x_{${index}}`).join("+");
  const result = renderer.render(formula, true, "#ffffff", {
    ...layout,
    maxWidthCells: 300,
    maxHeightCells: 100,
  });
  assert.ok(result, renderer.lastFailure?.message);
  assert.equal(result.columns, 300);
  assert.equal(result.deviceScale, 1);
  assert.equal(result.widthPx, 300 * layout.cellWidthPx);
  assertTransparentBleed(result);
});

test("rasterizes commutative diagrams and dense display structures without clipping", async () => {
  const renderer = await createTerminalMathRenderer();
  const formulas = [
    String.raw`\begin{CD}
0 @>>> A @>{f}>> B @>{g}>> C @>>> 0 \\
@. @VV{\alpha}V @VV{\beta}V @VV{\gamma}V @. \\
0 @>>> A' @>>{f'}> B' @>>{g'}> C' @>>> 0
\end{CD}`,
    String.raw`\begin{CD}
P @>{\pi_1}>> B \\
@V{\pi_2}VV @VV{f}V \\
A @>>{g}> C
\end{CD}`,
    String.raw`\begin{CD}
A @>{h}>> B \\
@| @VV{k}V \\
A @>>{kh}> C
\end{CD}`,
    String.raw`\begin{array}{ccc}
\ker f & \xrightarrow{\ \iota\ } & A \\
\downarrow & & \downarrow f \\
0 & \xrightarrow{\ \ } & B
\end{array}`,
    String.raw`\begin{aligned}
\oint_C \mathbf{B}\cdot d\mathbf{l} &= \mu_0\left(I_{\mathrm{enc}} + \varepsilon_0\frac{d\Phi_E}{dt}\right) \\
\nabla\cdot\mathbf{E} &= \frac{\rho}{\varepsilon_0}
\end{aligned}`,
    String.raw`\mathbb{E}\big[e^{itX}\big] = \prod_{k=1}^{n}\frac{1}{1 - it/k}`,
    String.raw`\begin{pmatrix}
1 & \alpha & \alpha^2 & \cdots & \alpha^{n-1} \\
1 & \beta & \beta^2 & \cdots & \beta^{n-1}
\end{pmatrix}`,
    String.raw`\boxed{E = mc^2} \qquad\text{and}\qquad \boxed{\zeta(3)=\sum_{n=1}^{\infty}\frac{1}{n^3}}`,
  ];

  for (const formula of formulas) {
    const result = renderer.render(formula, true, "#b5bd68", layout);
    assert.ok(result, renderer.lastFailure?.message);
    assert.ok(isPng(result.base64Data));
    assertTransparentBleed(result);
  }
});

test("all bundled MathJax 4 fonts render synchronously after local preloading", async () => {
  const images = new Set<string>();
  for (const font of MATH_FONTS) {
    const renderer = await createTerminalMathRenderer({ font });
    const originalLoader = mathjax.asyncLoad;
    mathjax.asyncLoad = () => { throw new Error("Unexpected render-time module loading"); };
    try {
      for (const display of [false, true]) {
        for (const formula of [
          String.raw`X_{uv}=|u\rangle\langle v|+|v\rangle\langle u|`,
          String.raw`\mathbb{R}\quad\mathcal{F}\quad\mathfrak{g}\quad\boldsymbol{\alpha}\quad\sum_{n=0}^{\infty}\frac{x^n}{n!}`,
          String.raw`\left(\begin{matrix}\sqrt{x}&\int_0^1 f(t)\,dt\\\frac{a}{b}&y\end{matrix}\right)`,
        ]) {
          const result = renderer.render(formula, display, "#ffffff", layout);
          assert.ok(result, `${font}: ${renderer.lastFailure?.message}`);
          assertTransparentBleed(result);
          assert.equal(renderer.render(formula, display, "#ffffff", layout), result);
        }
      }
      const simple = renderer.render("x+1", false, "#ffffff", layout);
      assert.ok(simple, `${font}: ${renderer.lastFailure?.message}`);
      images.add(simple.base64Data);
    } finally {
      mathjax.asyncLoad = originalLoader;
      renderer.clear();
    }
  }
  assert.equal(images.size, MATH_FONTS.length);
});

test("rasterizes golden-ratio inequalities with XML-safe TeX metadata", async () => {
  const renderer = await createTerminalMathRenderer();
  const formulas = [
    String.raw`\|x\|_{\mathbb R/\mathbb Z}:=\min_{k\in\mathbb Z}|x-k|.`,
    String.raw`0\le j<\frac{3}{\eta}
\qquad\text{such that}\qquad
\|j\varphi-x\|_{\mathbb R/\mathbb Z}\le\eta.`,
    String.raw`\left|\varphi-\frac pq\right|<\frac1{q^2},`,
    String.raw`\|j\varphi-x\|_{\mathbb R/\mathbb Z}
\le j\left|\varphi-\frac pq\right|
+\left\|\frac{k}{q}-x\right\|_{\mathbb R/\mathbb Z}
<\frac1q+\frac1{2q}
\le\eta.`,
    String.raw`\begin{aligned}a&<b\\c&>d\end{aligned}`,
  ];
  for (const display of [false, true]) {
    for (const formula of formulas) {
      const result = renderer.render(formula, display, "#ffffff", layout);
      assert.ok(result, renderer.lastFailure?.message);
      assert.ok(isPng(result.base64Data));
      assertTransparentBleed(result);
    }
  }
});

test("rejects invalid LaTeX with structured diagnostics", async () => {
  const renderer = await createTerminalMathRenderer();
  assert.equal(renderer.render(String.raw`\definitelyUnknown{x}`, true, "#fff000", layout), undefined);
  assert.equal(renderer.lastFailure?.code, "tex-error");
  assert.equal(renderer.render(String.raw`\frac{x}{`, true, "#fff000", layout), undefined);
  assert.equal(renderer.lastFailure?.code, "tex-error");
});

test("optionally renders unknown command names without hiding other TeX errors", async () => {
  const renderer = await createTerminalMathRenderer({ renderUnknownCommands: true });
  const source = String.raw`\paperMacro{x}+\frac{1}{\missingConstant}`;
  const result = renderer.render(source, true, "#ffffff", layout);
  assert.ok(result, renderer.lastFailure?.message);
  assert.ok(isPng(result.base64Data));
  assertTransparentBleed(result);
  assert.equal(renderer.render(source, true, "#ffffff", layout), result);
  const inline = renderer.render(source, false, "#ffffff", layout);
  assert.ok(inline, renderer.lastFailure?.message);

  const configured = await createTerminalMathRenderer({
    renderUnknownCommands: true, macros: { paperMacro: [String.raw`\mathbf{#1}`, 1] },
  });
  const defined = configured.render(source, true, "#ffffff", layout);
  assert.ok(defined);
  assert.notEqual(defined.base64Data, result.base64Data);

  assert.equal(renderer.render(String.raw`\frac{x}{`, true, "#ffffff", layout), undefined);
  assert.equal(renderer.lastFailure?.code, "tex-error");
  assert.equal(renderer.render(String.raw`\begin{unknownEnvironment}x\end{unknownEnvironment}`, true, "#ffffff", layout), undefined);
  assert.equal(renderer.lastFailure?.code, "tex-error");
  const strict = await createTerminalMathRenderer();
  assert.equal(strict.render(source, true, "#ffffff", layout), undefined);
  assert.equal(strict.lastFailure?.code, "tex-error");
});

test("rasterizes the deeply nested regression without clipping", async () => {
  const renderer = await createTerminalMathRenderer();
  const source = readFileSync(new URL("./fixtures/field-theory.tex", import.meta.url), "utf8");
  const result = renderer.render(source, true, "#b5bd68", layout);
  assert.ok(result);
  assert.ok(isPng(result.base64Data));
  assert.ok(result.columns <= layout.maxWidthCells);
  assert.ok(result.rows <= layout.maxHeightCells);
  assert.ok(result.widthPx <= 4096);
  assert.ok(result.heightPx <= 4096);

  const cached = renderer.render(source, true, "#b5bd68", layout);
  assert.equal(cached, result);
  assert.ok(renderer.cacheSize >= 1);
  assert.ok(renderer.cacheBytes > 0);
  renderer.clear();
  assert.equal(renderer.cacheSize, 0);
});
