import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { z } from "zod";
import { definesDialog, findScript } from "../script-files.js";

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
  arguments: z.array(z.string()).optional(),
});

export type DialogSettings = z.output<typeof dialogSettingsSchema>;

/** Validated Script settings, with the script file resolved and the dialog settings in one list. */
export interface ScriptSettings {
  filePath: string;
  parameters?: Record<string, string | number | boolean>;
  dialogs: DialogSettings[];
  answers?: Record<string, string>;
  inspect?: boolean;
  /** The script's command line arguments. */
  arguments: string[];
}

export const SCRIPT_SETTINGS_HELP =
  "**Script** runs a PixInsight script file (.js), on the view if one is given, with no user interaction. Settings:\n" +
  "- script: the Script menu name, e.g. \"StarStretch\" or \"Halo-B-Gon\", found under <PixInsight>/src/scripts\n" +
  "- filePath: absolute path of a script file, in place of script\n" +
  "- parameters: { name: value } a script reads through Parameters. With them the script runs as a script instance " +
  "executed on the view, which many scripts do without their dialog. Without them, and for inspect, it starts as from " +
  "the Script menu, on the view's window brought to the front.\n" +
  "- controls: { name or label: value } controls to set in the first dialog. An image picker takes a view " +
  "id, a color box #RRGGBB, a list the items to check or select.\n" +
  "- button: label or name of the button to click in the first dialog, for scripts that work on a button " +
  "(Execute, Apply). Without one the dialog's own OK button is clicked, if it has one. A dialog still open " +
  "after the click is closed with its own Cancel or Close button, or else accepted.\n" +
  "- dialogs: [{ controls, button }, ...] settings per dialog in the order the script opens them, in place " +
  "of controls and button. Dialogs past the list are accepted as they are, except a dialog the script opens " +
  "again after its work (an Execute and Close loop), which is closed as a user would.\n" +
  "- answers: { text fragment: button } answers message boxes whose text contains the fragment, with Ok, " +
  "Cancel, Yes, No, Abort, Retry, Ignore, YesToAll or NoToAll. Other message boxes get their first button.\n" +
  "- arguments: [\"name=value\", ...] the script's command line arguments, which it reads as Runtime.jsArguments " +
  "(jsArguments on the legacy engine), e.g. WeightedBatchPreprocessing's automation mode (\"automationMode=true\", " +
  "\"dir=<lights and calibration folder>\", \"outputDirectory=<folder>\", its options listed in " +
  "BatchPreprocessing/BPP-automation.js). An argument cannot hold a comma, a quote or a line break.\n" +
  "- inspect: true lists the dialogs and their controls, with labels, tooltips, buttons and current values, " +
  "then cancels them. Inspect is refused for a script that defines no dialog, since it would do its work.\n" +
  "File pickers are cancelled and every message is reported. Every requested control must exist, so run " +
  "inspect first. A drawing area (a control the script draws itself, often a button) takes no value, but button " +
  "can name one to click it at its center. A script that keeps " +
  "asking again is stopped, and a dialog whose OK button refuses " +
  "the settings fails the run. On the legacy engine (scripts without #engine v8) only controls the script " +
  "keeps as dialog properties are found. Windows a script opens stay open and are listed in the result. " +
  "A script that remembers its settings saves the values a run sets, as after a user's run.";

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
  const { filePath, script, controls, button, dialogs, arguments: scriptArguments = [], ...rest } = parsed.data;
  if (dialogs !== undefined && (controls !== undefined || button !== undefined))
    throw new Error("Script takes dialogs or controls and button, not both");
  const dialogSettings = dialogs ?? (controls !== undefined || button !== undefined ? [{ controls, button }] : []);
  const common = { ...rest, arguments: scriptArguments, dialogs: dialogSettings };
  if (script !== undefined) {
    if (filePath !== undefined) throw new Error("Script takes script (a name) or filePath, not both");
    return checkInspectable({ ...common, filePath: findScript(script, directory) });
  }
  if (filePath === undefined) throw new Error(`Script needs script (a name) or filePath.\n\n${SCRIPT_SETTINGS_HELP}`);
  if (!isAbsolute(filePath)) throw new Error(`Script filePath must be absolute: ${filePath}`);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`No script file at ${filePath}`);
  return checkInspectable({ ...common, filePath });
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
  /** Opened again after its work with no settings given, so closed. */
  closed?: boolean;
  /** Still open after the click, so closed with its own Cancel or Close button, else accepted. */
  stayedOpen?: boolean;
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
const MS_PER_SECOND = 1_000;
// PixInsight console markup such as <end>, <cbr>, <br> and <b>.
const CONSOLE_TAG = /<\/?[a-z]+[^>]*>/gi;

function describeControl(control: ControlDescription): string {
  const label = control.label ? ` "${control.label}"` : "";
  const value = control.value === undefined ? "" : ` = ${JSON.stringify(control.value)}`;
  const range = control.range ? ` range ${control.range[0]} to ${control.range[1]}` : "";
  const items = control.items ? ` items ${JSON.stringify(control.items)}` : "";
  const tip = control.tip ? `, tip: ${control.tip}` : "";
  const kind = control.kind === "canvas" ? "drawing area, button can click it" : control.kind;
  return `  - ${control.name} (${kind})${label}${value}${range}${items}${tip}`;
}

export function formatScriptRun(message: string, outputs: ScriptRunOutputs): string {
  const lines = [`${message} (${outputs.engine} engine, ${(outputs.milliseconds / MS_PER_SECOND).toFixed(1)} s)`];
  if (outputs.historyBefore !== null && outputs.historyAfter !== null) {
    const steps = outputs.historyAfter - outputs.historyBefore;
    lines.push(steps === 0 ? "- The view is unchanged." : `- History ${outputs.historyBefore} to ${outputs.historyAfter} (${steps} step(s)).`);
  }
  if (outputs.dialogs.length === 0) lines.push("- No dialog opened.");
  for (const dialog of outputs.dialogs) {
    lines.push(`- Dialog "${dialog.title}"${dialog.closed ? " opened again, closed" : ""}`);
    if (dialog.applied && Object.keys(dialog.applied).length) lines.push(`  set ${JSON.stringify(dialog.applied)}`);
    if (dialog.clicked) lines.push(`  clicked "${dialog.clicked}"${dialog.stayedOpen ? ", stayed open, closed" : ""}`);
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
