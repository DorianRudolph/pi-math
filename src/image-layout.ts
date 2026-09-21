import { getCapabilities, renderImage, visibleWidth } from "@earendil-works/pi-tui";
import { kittyPlaceholderSupport, renderKittyVirtualImage } from "./kitty-graphics.js";
import type { FormulaRaster } from "./svg-renderer.js";

export interface FormulaImagePlacement {
  marker: string;
  imageId: number;
  raster: FormulaRaster;
  inline: boolean;
  fallbackText: string;
}

/** Cell bounds relative to the final Markdown output, excluding surrounding prose. */
export interface FormulaHitRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  source: string;
  /** Prose row relative to this rectangle; absent for display math. */
  inlineBaseline?: number;
}

export interface FormulaImageArea {
  renderWidth: number;
  paddingX: number;
}

function renderNativeImage(placement: FormulaImagePlacement) {
  return renderImage(
    placement.raster.base64Data,
    {
      widthPx: placement.raster.widthPx,
      heightPx: placement.raster.heightPx,
    },
    {
      maxWidthCells: placement.raster.columns,
      maxHeightCells: placement.raster.rows,
      imageId: placement.imageId,
      moveCursor: false,
    },
  );
}

function renderBlockPlacement(
  placement: FormulaImagePlacement,
  area: FormulaImageArea,
): string[] | undefined {
  const capabilities = getCapabilities();
  if (!capabilities.images) return undefined;

  const contentWidth = Math.max(1, area.renderWidth - area.paddingX * 2);
  if (placement.raster.columns > contentWidth) return undefined;
  const rendered = renderNativeImage(placement);
  if (!rendered) return undefined;

  const left =
    area.paddingX + Math.max(0, Math.floor((contentWidth - placement.raster.columns) / 2));
  const prefix = " ".repeat(left);
  if (capabilities.images === "kitty") {
    return [
      `${prefix}${rendered.sequence}`,
      ...Array.from({ length: Math.max(0, rendered.rows - 1) }, () => ""),
    ];
  }

  const rowOffset = Math.max(0, rendered.rows - 1);
  const moveUp = rowOffset > 0 ? `\x1b[${rowOffset}A` : "";
  return [
    ...Array.from({ length: rowOffset }, () => ""),
    `${prefix}${moveUp}${rendered.sequence}`,
  ];
}

/** Place a one-row Kitty image without changing the surrounding text flow. */
function renderInlinePlacement(placement: FormulaImagePlacement): string | undefined {
  if (getCapabilities().images !== "kitty" || placement.raster.rows !== 1) return undefined;

  if (kittyPlaceholderSupport()) {
    const virtual = renderKittyVirtualImage(
      placement.raster.base64Data,
      placement.imageId,
      placement.raster.columns,
      1,
    );
    if (virtual) return `${virtual.sequence}${virtual.placeholders[0]}`;
  }

  // Compatibility path for Kitty-protocol terminals without Unicode placeholders.
  const rendered = renderNativeImage(placement);
  if (!rendered || rendered.rows !== 1) return undefined;
  const columns = placement.raster.columns;
  return `${" ".repeat(columns)}\x1b[${columns}D${rendered.sequence}\x1b[${columns}C`;
}

/** Only whitespace and SGR styling are reusable, never borders or image controls. */
function isReusableBlank(line: string): boolean {
  return /^[ \t]*$/.test(line.replace(/\x1b\[[0-9;:]*m/g, ""));
}

/** Balance extra rows around prose, giving an odd extra row to the top. */
function renderInlineBand(
  line: string,
  placements: FormulaImagePlacement[],
): { lines: string[]; above: number; below: number; regions: FormulaHitRegion[] } | undefined {
  const present = placements
    .map((placement) => ({ placement, index: line.indexOf(placement.marker) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index);
  if (!present.some(({ placement }) => placement.raster.rows > 1)) return undefined;
  if (getCapabilities().images !== "kitty") return undefined;

  const prepared = present.map(({ placement, index }) => {
    const { columns, rows } = placement.raster;
    const virtual = kittyPlaceholderSupport()
      ? renderKittyVirtualImage(placement.raster.base64Data, placement.imageId, columns, rows)
      : undefined;
    const native = virtual ? undefined : renderNativeImage(placement);
    const imageRows = virtual
      ? virtual.placeholders.map((row, i) => (i === 0 ? virtual.sequence : "") + row)
      : native
        ? Array.from({ length: rows }, (_, i) => i === 0
            ? `${" ".repeat(columns)}\x1b[${columns}D${native.sequence}\x1b[${columns}C`
            : " ".repeat(columns))
        : undefined;
    return { placement, index, imageRows, column: visibleWidth(line.slice(0, index)) };
  });
  if (prepared.some(({ imageRows }) => !imageRows)) return undefined;

  const above = Math.max(...prepared.map(({ placement }) => Math.ceil((placement.raster.rows - 1) / 2)));
  const below = Math.max(...prepared.map(({ placement }) => Math.floor((placement.raster.rows - 1) / 2)));
  const lines = Array.from({ length: above + 1 + below }, (_, row) => {
    let output = "";
    let endIndex = 0;
    let endColumn = 0;
    for (const { placement, index, column, imageRows } of prepared) {
      output += row === above
        ? line.slice(endIndex, index)
        : " ".repeat(Math.max(0, column - endColumn));
      const imageRow = row - above + Math.ceil((placement.raster.rows - 1) / 2);
      output += imageRows![imageRow] ?? " ".repeat(placement.raster.columns);
      endIndex = index + placement.marker.length;
      endColumn = column + placement.raster.columns;
    }
    if (row === above) output += line.slice(endIndex);
    return output;
  });
  const regions = prepared.map(({ placement, column }) => ({
    x: column,
    y: above - Math.ceil((placement.raster.rows - 1) / 2),
    width: placement.raster.columns,
    height: placement.raster.rows,
    source: placement.fallbackText,
    inlineBaseline: Math.ceil((placement.raster.rows - 1) / 2),
  }));
  return { lines, above, below, regions };
}

/** Replace generated Markdown markers with terminal-native image placements. */
export function insertFormulaImages(
  lines: string[],
  placements: FormulaImagePlacement[],
  area: FormulaImageArea,
  hitRegions?: FormulaHitRegion[],
): string[] {
  if (placements.length === 0) return lines;
  const output: string[] = [];
  const blockPlacements = placements.filter(({ inline }) => !inline);
  const inlinePlacements = placements.filter(({ inline }) => inline);
  // Track only unclaimed source blanks. Native image continuation rows can look
  // empty but are occupied, so inspecting the rendered output is not sufficient.
  let trailingBlanks = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const block = blockPlacements.find(({ marker }) => line.includes(marker));
    if (block) {
      trailingBlanks = 0;
      const imageLines = renderBlockPlacement(block, area);
      const blockLines =
        imageLines ?? [line.replace(block.marker, () => block.fallbackText)];
      // Place one empty row above and below each formula so it never sits
      // flush against text or another formula. Consecutive formula blocks
      // share the boundary row instead of doubling it.
      output.push("");
      if (imageLines) {
        const contentWidth = Math.max(1, area.renderWidth - area.paddingX * 2);
        hitRegions?.push({
          x: area.paddingX + Math.max(0, Math.floor((contentWidth - block.raster.columns) / 2)),
          y: output.length,
          width: block.raster.columns,
          height: imageLines.length,
          source: block.fallbackText,
        });
      }
      output.push(...blockLines);
      const nextIsBlock = blockPlacements.some(({ marker }) =>
        lines[lineIndex + 1]?.includes(marker),
      );
      if (!nextIsBlock) output.push("");
      continue;
    }

    const band = renderInlineBand(line, inlinePlacements);
    if (band) {
      const reuseAbove = Math.min(band.above, trailingBlanks);
      output.length -= reuseAbove;
      for (let reused = 0; reused < band.below; reused++) {
        const next = lines[lineIndex + 1];
        if (next === undefined || !isReusableBlank(next)) break;
        lineIndex++;
      }
      for (const region of band.regions) {
        hitRegions?.push({ ...region, y: output.length + region.y });
      }
      output.push(...band.lines);
      trailingBlanks = 0;
      continue;
    }

    let renderedLine = line;
    for (const placement of inlinePlacements) {
      if (!renderedLine.includes(placement.marker)) continue;
      const image = renderInlinePlacement(placement);
      if (image) {
        hitRegions?.push({
          x: visibleWidth(line.slice(0, line.indexOf(placement.marker))),
          y: output.length,
          width: placement.raster.columns,
          height: 1,
          source: placement.fallbackText,
          inlineBaseline: 0,
        });
      }
      renderedLine = renderedLine.replace(placement.marker, () => image ?? placement.fallbackText);
    }
    output.push(renderedLine);
    trailingBlanks = isReusableBlank(line) ? trailingBlanks + 1 : 0;
  }

  return output;
}
