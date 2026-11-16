import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { pixinsightRoot } from "../pixinsight.js";

/** The process id run_process treats as a request to run a script file. */
export const SCRIPT_PROCESS_ID = "Script";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
// A list takes the items to check or select.
const controlValue = z.union([scalar, z.array(z.string())]);

const dialogSettingsSchema = z.strictObject({
  controls: z.record(z.string(), controlValue).optional(),
  button: z.string().optional(),
});

const scriptSettingsSchema = z.strictObject({
  filePath: z.string().optional(),
  script: z.string().optional(),
  parameters: z.record(z.string(), scalar).optional(),
  controls: dialogSettingsSchema.shape.controls,
  button: dialogSettingsSchema.shape.button,
  dialogs: z.array(dialogSettingsSchema).optional(),
  answers: z.record(z.string(), z.string()).optional(),
  inspect: z.boolean().optional(),
});

export type DialogSettings = z.output<typeof dialogSettingsSchema>;

/** Validated Script settings, with the script file resolved and the dialog settings in one list. */
export interface ScriptSettings {
  filePath: string;
  parameters?: Record<string, string | number | boolean>;
  dialogs: DialogSettings[];
  answers?: Record<string, string>;
  inspect?: boolean;
}

export const SCRIPT_SETTINGS_HELP =
  "**Script** runs a PixInsight script file (.js) on the view with no user interaction. Settings:\n" +
  "- script: the Script menu name, e.g. \"StarStretch\" or \"Halo-B-Gon\", found under <PixInsight>/src/scripts\n" +
  "- filePath: absolute path of a script file, in place of script\n" +
  "- parameters: { name: value } a script reads through Parameters, as a script instance on a view would carry\n" +
  "- controls: { name or label: value } controls to set in the first dialog. An image picker takes a view " +
  "id, a color box #RRGGBB, a list the items to check or select.\n" +
  "- button: label or name of the button to click in the first dialog, for scripts that work on a button " +
  "(Execute, Apply). Without one the dialog's own OK button is clicked, if it has one.\n" +
  "- dialogs: [{ controls, button }, ...] settings per dialog in the order the script opens them, in place " +
  "of controls and button. Dialogs past the list are accepted as they are.\n" +
  "- answers: { text fragment: button } answers message boxes whose text contains the fragment, with Ok, " +
  "Cancel, Yes, No, Abort, Retry, Ignore, YesToAll or NoToAll. Other message boxes get their first button.\n" +
  "- inspect: true lists the dialogs and their controls, with labels, tooltips, buttons and current values, " +
  "then cancels them. Inspect is refused for a script that defines no dialog, since it would do its work.\n" +
  "File pickers are cancelled and every message is reported. Every requested control must exist, so run " +
  "inspect first. A drawing area that needs the mouse is listed but cannot be used. A script that keeps " +
  "asking again (the same dialog 10 times, 30 messages) is stopped, and a dialog whose OK button refuses " +
  "the settings fails the run. On the legacy engine (scripts without #engine v8) only controls the script " +
  "keeps as dialog properties are found. Windows a script opens stay open and are listed in the result.";

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

/** Refuses an inspect of a script without a dialog, which would do the script's work. */
function checkInspectable(settings: ScriptSettings): ScriptSettings {
  if (settings.inspect && !definesDialog(settings.filePath))
    throw new Error(`${basename(settings.filePath)} defines no dialog, so inspect would run it rather than list anything. ` +
      "Run it without inspect.");
  return settings;
}

/** Validates the settings of a Script run and resolves its file, throwing a message the assistant can act on. */
export function parseScriptSettings(settings: Record<string, unknown>, directory?: string): ScriptSettings {
  const parsed = scriptSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`);
    throw new Error(`Invalid Script settings, ${problems.join("; ")}.\n\n${SCRIPT_SETTINGS_HELP}`);
  }
  const { filePath, script, controls, button, dialogs, ...rest } = parsed.data;
  if (dialogs !== undefined && (controls !== undefined || button !== undefined))
    throw new Error("Script takes dialogs or controls and button, not both");
  const dialogSettings = dialogs ?? (controls !== undefined || button !== undefined ? [{ controls, button }] : []);
  if (script !== undefined) {
    if (filePath !== undefined) throw new Error("Script takes script (a name) or filePath, not both");
    return checkInspectable({ ...rest, dialogs: dialogSettings, filePath: findScript(script, directory) });
  }
  if (filePath === undefined) throw new Error(`Script needs script (a name) or filePath.\n\n${SCRIPT_SETTINGS_HELP}`);
  if (!isAbsolute(filePath)) throw new Error(`Script filePath must be absolute: ${filePath}`);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`No script file at ${filePath}`);
  return checkInspectable({ ...rest, dialogs: dialogSettings, filePath });
}

interface ControlDescription {
  name: string;
  kind: string;
  label: string;
  tip?: string;
  value?: unknown;
  range?: [number, number];
  items?: string[];
  unreadable?: string;
}

interface DialogRecord {
  title: string;
  controls: ControlDescription[];
  applied?: Record<string, unknown>;
  clicked?: string;
}

/** The outputs of handleRunScript in pjsr/scripts.js. */
export interface ScriptRunOutputs {
  filePath: string;
  engine: "v8" | "legacy";
  inspect: boolean;
  milliseconds: number;
  historyBefore: number | null;
  historyAfter: number | null;
  newWindows: string[];
  dialogs: DialogRecord[];
  messages: string[];
  output: string[];
  /** answers keys no message box matched. */
  unusedAnswers: string[];
}

// Console lines quoted back after a run.
const OUTPUT_LINES_SHOWN = 8;
// PixInsight console markup such as <end>, <cbr>, <br> and <b>.
const CONSOLE_TAG = /<\/?[a-z]+[^>]*>/gi;

function describeControl(control: ControlDescription): string {
  const label = control.label ? ` "${control.label}"` : "";
  const value = control.value === undefined ? "" : ` = ${JSON.stringify(control.value)}`;
  const range = control.range ? ` range ${control.range[0]} to ${control.range[1]}` : "";
  const items = control.items ? ` items ${JSON.stringify(control.items)}` : "";
  const tip = control.tip ? `, tip: ${control.tip}` : "";
  const kind = control.kind === "canvas" ? "drawing area, needs the mouse" : control.kind;
  return `  - ${control.name} (${kind})${label}${value}${range}${items}${tip}`;
}

export function formatScriptRun(message: string, outputs: ScriptRunOutputs): string {
  const lines = [`${message} (${outputs.engine} engine, ${(outputs.milliseconds / 1000).toFixed(1)} s)`];
  if (outputs.historyBefore !== null && outputs.historyAfter !== null) {
    const steps = outputs.historyAfter - outputs.historyBefore;
    lines.push(steps === 0 ? "- The view is unchanged." : `- History ${outputs.historyBefore} to ${outputs.historyAfter} (${steps} step(s)).`);
  }
  if (outputs.dialogs.length === 0) lines.push("- No dialog opened.");
  for (const dialog of outputs.dialogs) {
    lines.push(`- Dialog "${dialog.title}"`);
    if (dialog.applied && Object.keys(dialog.applied).length) lines.push(`  set ${JSON.stringify(dialog.applied)}`);
    if (dialog.clicked) lines.push(`  clicked "${dialog.clicked}"`);
    if (outputs.inspect) lines.push(...dialog.controls.map(describeControl));
  }
  if (outputs.newWindows.length) lines.push(`- New windows: ${outputs.newWindows.join(", ")}`);
  if (outputs.messages.length) lines.push(`- Messages: ${outputs.messages.join(" | ")}`);
  if (outputs.unusedAnswers.length) lines.push(`- No message matched answers for: ${outputs.unusedAnswers.join(", ")}`);
  const output = outputs.output.map((line) => line.replace(CONSOLE_TAG, "").trimEnd())
    .filter((line) => line.trim() !== "").slice(-OUTPUT_LINES_SHOWN);
  if (output.length) lines.push("- Console:", ...output.map((line) => `  ${line}`));
  return lines.join("\n");
}
