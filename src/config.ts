import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter as pathDelimiter, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SvgMathRendererOptions, TeXDefinitionMap } from "./svg-renderer.js";

export interface MathConfig extends SvgMathRendererOptions {
  inlineMinScale: number;
  color?: string;
}

function definitionMap(value: unknown, label: string): TeXDefinitionMap | undefined {
  if (value === undefined) return undefined;
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return Object.fromEntries(Object.entries(value).map(([rawName, definition]) => {
    const name = rawName.replace(/^\\/, "");
    if (!name || (typeof definition !== "string" && !Array.isArray(definition))) {
      throw new Error(`${label}.${rawName} must be a string or array definition`);
    }
    return [name, definition];
  }));
}

function json(value: string, label: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new Error(`${label} must contain valid JSON`); }
}

function fontFiles(value: unknown, baseDir: string, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((path) => typeof path !== "string" || !path.trim())) {
    throw new Error(`${label} must be an array of non-empty file paths`);
  }
  const files = value.map((path: string) => resolve(baseDir,
    path.startsWith("~/") ? join(homedir(), path.slice(2)) : path));
  const missing = files.find((path) => !existsSync(path));
  if (missing) throw new Error(`${label} does not exist: ${missing}`);
  return [...new Set(files)];
}

/** Invalid or unset values preserve the legacy one-row behavior. */
export function loadInlineMinScale(environment: NodeJS.ProcessEnv = process.env): number {
  const value = Number(environment.PI_MATH_INLINE_MIN_SCALE ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

/** Environment overrides, optionally layered over file-provided renderer settings. */
export function loadSvgMathRendererOptions(
  environment: NodeJS.ProcessEnv = process.env,
  defaults: SvgMathRendererOptions = {},
): SvgMathRendererOptions {
  const definitions = (key: "macros" | "environments", variable: string) => ({
    ...defaults[key],
    ...definitionMap(environment[variable]?.trim() ? json(environment[variable]!, variable) : undefined, variable),
  });
  const fonts = environment.PI_MATH_FONT_FILES?.trim();
  const systemFonts = environment.PI_MATH_SYSTEM_FONTS;
  const unknownCommands = environment.PI_MATH_RENDER_UNKNOWN_COMMANDS;
  return {
    macros: definitions("macros", "PI_MATH_MACROS"),
    environments: definitions("environments", "PI_MATH_ENVIRONMENTS"),
    fontFiles: fonts
      ? fontFiles(fonts.split(pathDelimiter).map((path) => path.trim()).filter(Boolean), process.cwd(), "PI_MATH_FONT_FILES")
      : defaults.fontFiles,
    loadSystemFonts: systemFonts === undefined ? defaults.loadSystemFonts ?? true
      : systemFonts !== "0" && systemFonts.toLowerCase() !== "false",
    renderUnknownCommands: unknownCommands === undefined ? defaults.renderUnknownCommands ?? false
      : unknownCommands !== "0" && unknownCommands.toLowerCase() !== "false",
  };
}

/** Read the single global file at extension load; environment overrides are applied last. */
export function loadMathConfig(
  environment: NodeJS.ProcessEnv = process.env,
  agentDir: string = getAgentDir(),
): MathConfig {
  const path = join(agentDir, "pi-math.json");
  let value: unknown = {};
  try { value = json(readFileSync(path, "utf8"), path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${path} must contain a JSON object`);
  }
  const file = value as Record<string, unknown>;
  for (const key of Object.keys(file)) {
    if (!["inlineMinScale", "color", "macros", "environments", "systemFonts", "fontFiles", "renderUnknownCommands"].includes(key)) {
      throw new Error(`${path}: unknown option ${key}`);
    }
  }
  const scale = file.inlineMinScale === undefined ? 0 : file.inlineMinScale;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0 || scale > 1) {
    throw new Error(`${path}: inlineMinScale must be a number between 0 and 1`);
  }
  for (const key of ["systemFonts", "renderUnknownCommands"]) {
    if (file[key] !== undefined && typeof file[key] !== "boolean") {
      throw new Error(`${path}: ${key} must be a boolean`);
    }
  }
  if (file.color !== undefined && (typeof file.color !== "string" || !/^#[\da-f]{6}$/i.test(file.color))) {
    throw new Error(`${path}: color must be in #rrggbb format`);
  }
  return {
    ...loadSvgMathRendererOptions(environment, {
      macros: definitionMap(file.macros, `${path}: macros`),
      environments: definitionMap(file.environments, `${path}: environments`),
      fontFiles: fontFiles(file.fontFiles, agentDir, `${path}: fontFiles`),
      loadSystemFonts: file.systemFonts as boolean | undefined,
      renderUnknownCommands: file.renderUnknownCommands as boolean | undefined,
    }),
    inlineMinScale: environment.PI_MATH_INLINE_MIN_SCALE === undefined ? scale : loadInlineMinScale(environment),
    color: environment.PI_MATH_COLOR ?? (file.color as string | undefined),
  };
}
