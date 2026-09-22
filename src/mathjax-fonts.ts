import type { SvgFontDataClass } from "@mathjax/src/cjs/output/svg/FontData.js";

export const MATH_FONTS = ["newcm", "tex", "stix2", "fira", "dejavu"] as const;
export type MathFont = typeof MATH_FONTS[number];

export function parseMathFont(value: unknown, label = "font"): MathFont {
  if (typeof value !== "string" || !MATH_FONTS.includes(value as MathFont)) {
    throw new Error(`${label} must be one of: ${MATH_FONTS.join(", ")}`);
  }
  return value as MathFont;
}

// Explicit CJS paths keep the font and core on the same module instance under
// both Node ESM and Pi's extension loader. Only the selected font is loaded.
export async function loadMathFont(font: MathFont): Promise<SvgFontDataClass> {
  switch (parseMathFont(font)) {
    case "newcm": return (await import("@mathjax/mathjax-newcm-font/cjs/svg.js")).MathJaxNewcmFont;
    case "tex": return (await import("@mathjax/mathjax-tex-font/cjs/svg.js")).MathJaxTexFont;
    case "stix2": return (await import("@mathjax/mathjax-stix2-font/cjs/svg.js")).MathJaxStix2Font;
    case "fira": return (await import("@mathjax/mathjax-fira-font/cjs/svg.js")).MathJaxFiraFont;
    case "dejavu": return (await import("@mathjax/mathjax-dejavu-font/cjs/svg.js")).MathJaxDejavuFont;
  }
}
