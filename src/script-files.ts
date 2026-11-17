// PixInsight script files on disk: finding a bundled script by its menu name, and telling whether a
// script defines a dialog.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { pixinsightRoot } from "./pixinsight.js";

/** The folder of PixInsight's bundled scripts. Verified on Windows, the same layout is assumed elsewhere. */
export function scriptsDirectory(): string {
  return join(pixinsightRoot(), "src", "scripts");
}

// A Script menu registration, `#feature-id Id : Category > Item | Other > Item` or
// `#feature-id Category > Item`. Group 1 is everything after the directive.
const FEATURE_ID = /^#feature-id\s+(.+?)\s*\\?$/gm;

// Names compare without case, spaces or punctuation, so "Star Stretch" finds StarStretch.
function comparable(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The names a script answers to: its file name and menu items, and apart from those its feature ids,
 * which the scripts of one bundle may share.
 */
export function scriptNames(source: string, filePath: string): { names: string[]; featureIds: string[] } {
  const names = [basename(filePath, extname(filePath))];
  const featureIds: string[] = [];
  for (const match of source.matchAll(FEATURE_ID)) {
    const colon = match[1].indexOf(":");
    if (colon > 0) featureIds.push(match[1].slice(0, colon).trim());
    for (const menu of match[1].slice(colon + 1).split("|")) {
      const path = menu.split(">");
      names.push(path[path.length - 1].trim());
    }
  }
  return { names: names.filter((name) => name !== ""), featureIds: featureIds.filter((name) => name !== "") };
}

function* scriptFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) yield* scriptFiles(entryPath);
    else if (entry.name.endsWith(".js")) yield entryPath;
  }
}

/**
 * The menu script answering to name under directory, by file name or menu item, else by feature id.
 * Throws when none or several do.
 */
export function findScript(name: string, directory = scriptsDirectory()): string {
  if (!existsSync(directory)) throw new Error(`No scripts folder at ${directory}, give filePath instead`);
  const wanted = comparable(name);
  const byName: string[] = [];
  const byFeatureId: string[] = [];
  for (const filePath of scriptFiles(directory)) {
    const source = readFileSync(filePath, "utf8");
    if (!/^#feature-id/m.test(source)) continue;
    const { names, featureIds } = scriptNames(source, filePath);
    if (names.some((candidate) => comparable(candidate) === wanted)) byName.push(filePath);
    else if (featureIds.some((candidate) => comparable(candidate) === wanted)) byFeatureId.push(filePath);
  }
  const matches = byName.length ? byName : byFeatureId;
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No Script menu script named "${name}" under ${directory}, give filePath instead`);
  throw new Error(`Several scripts are named "${name}": ${matches.join(", ")}. Give filePath instead.`);
}

// Ways a script builds a dialog: a class or the __base__ idiom on Dialog, new Dialog, or
// Reflect.construct(Dialog, ...).
const DIALOG_DEFINITION = /\bextends\s+Dialog\b|__base__\s*=\s*Dialog\b|\bnew\s+Dialog\b|Reflect\.construct\(\s*Dialog\b/;
// A script's own include, `#include "file"`. Group 1 is the path, relative to the including file.
const LOCAL_INCLUDE = /^#include\s+"([^"]+)"/gm;

/** Whether a script or one of the files it includes from its own folder defines a dialog. */
export function definesDialog(filePath: string, visited = new Set<string>()): boolean {
  if (visited.has(filePath) || !existsSync(filePath)) return false;
  visited.add(filePath);
  const source = readFileSync(filePath, "utf8");
  if (DIALOG_DEFINITION.test(source)) return true;
  return [...source.matchAll(LOCAL_INCLUDE)].some((match) => definesDialog(join(dirname(filePath), match[1]), visited));
}
