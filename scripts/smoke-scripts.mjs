// Runs bundled PixInsight scripts through run_process("Script") on a synthetic image and checks each
// result. PixInsight must be running. Windows the scripts open are left open.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// A run that hangs fails within this, instead of holding the session.
const CALL_TIMEOUT_MS = 120_000;
const VIEW = "script_smoke";
const SIZE = 512;
// Sky with a gradient, three stars and an elongated galaxy, in [0, 1].
const SYNTHETIC_IMAGE =
  `0.08 + 0.04*x()/${SIZE} + 0.9*exp(-((x()-128)^2 + (y()-140)^2)/18) + 0.7*exp(-((x()-380)^2 + (y()-90)^2)/12)` +
  " + 0.5*exp(-((x()-300)^2 + (y()-400)^2)/10) + 0.25*exp(-(((x()-256)/90)^2 + ((y()-256)/30)^2))";
// Gaussian noise on top, which noise measuring scripts need.
const NOISE_AMOUNT = 0.01;
const NORMAL_DISTRIBUTION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repoRoot, "build", "index.js")],
  env: { ...process.env, PIXINSIGHT_MCP_TIMEOUT_MS: String(CALL_TIMEOUT_MS) },
  stderr: "ignore",
});
const client = new Client({ name: "smoke-scripts", version: "1.0.0" });
await client.connect(transport);

let failures = 0;
async function step(label, tool, args, { expectError = false, expect = [], absent = [] } = {}) {
  const started = Date.now();
  const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS + 30_000 });
  const text = result.content[0].text;
  const missing = expect.filter((pattern) => !pattern.test(text));
  const present = absent.filter((pattern) => pattern.test(text));
  const failed = Boolean(result.isError) !== expectError || missing.length > 0 || present.length > 0;
  if (failed) failures++;
  console.log(`${failed ? "FAIL" : "ok  "}  ${label} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (failed) console.log(`${text}\n${[...missing.map((pattern) => `missing: ${pattern}`), ...present.map((pattern) => `present: ${pattern}`)].join("\n")}`);
  return text;
}
const script = (name, settings = {}) => ({ processId: "Script", viewId: VIEW, settings: { script: name, ...settings } });

// Runs PJSR source as a script file, with no view.
async function runSource(label, source, expectations) {
  const file = path.join(os.tmpdir(), `script-smoke-${process.pid}.js`);
  fs.writeFileSync(file, source);
  try {
    return await step(label, "run_process", { processId: "Script", settings: { filePath: file } }, expectations);
  } finally {
    fs.rmSync(file);
  }
}

await step("synthetic image", "run_process", {
  processId: "NewImage",
  settings: { id: VIEW, width: SIZE, height: SIZE, numberOfChannels: 3, colorSpace: 0, sampleFormat: 3, v0: 0, v1: 0, v2: 0 },
});
await step("synthetic image content", "run_process",
  { processId: "PixelMath", viewId: VIEW, settings: { expression: SYNTHETIC_IMAGE, useSingleExpression: true, truncate: true } });
await step("synthetic image noise", "run_process",
  { processId: "NoiseGenerator", viewId: VIEW, settings: { amount: NOISE_AMOUNT, distribution: NORMAL_DISTRIBUTION } });

await step("Script settings help", "get_process_parameters", { processId: "Script" }, { expect: [/answers/] });
await step("inspect, legacy engine", "run_process", script("DarkStructureEnhance", { inspect: true }),
  { expect: [/legacy engine/, /\(view\) "Target image"/, /The view is unchanged/] });
await step("controls and an image picker, legacy engine", "run_process",
  script("DarkStructureEnhance", { controls: { "Target image": VIEW, "Amount": 0.5 } }), { expect: [/set \{/, /\(1 step/] });
await step("inspect, V8 engine", "run_process", script("Halo-B-Gon", { inspect: true }), { expect: [/v8 engine/, /"Execute"/] });
await step("combo box and button, V8 engine", "run_process",
  script("Halo-B-Gon", { controls: { "Select stars-only image": VIEW }, button: "Execute" }), { expect: [/clicked "Execute"/] });
await step("image picker and an unlabelled button, V8 engine", "run_process",
  script("RepairStarCores", { controls: { Image: VIEW, Threshold: 0.9 }, button: "buttonFrame[0]" }), { expect: [/step/] });
await step("parameters through the view target path", "run_process",
  script("StatisticalStretch", { parameters: { targetMedian: 0.3, openDialogbox: false } }), { expect: [/step/, /No dialog opened/] });
await step("button on a script with saved settings", "run_process", script("StarStretch", { button: "Execute" }), { expect: [/step/] });
await step("script without a dialog, console captured", "run_process", script("NoiseEvaluation"),
  { expect: [/No dialog opened/, /Console:/] });
await step("message box answered as requested", "run_process",
  script("PreviewAggregator", { answers: { "No preview was selected": "No" } }), { expect: [/\[No\]/] });
await step("color box, and labels by position, legacy engine", "run_process", script("ImageInsert", { inspect: true }),
  { expect: [/\(color\) .*= "#FFFFFFFF"/, /xMargin_SpinBox \(spin\) "Horizontal Margin"/, /tip: /] });
await step("a dialog whose onShow runs processes, V8 engine", "run_process", script("FAME", { inspect: true }),
  { expect: [/FAME/, /The view is unchanged/] });
await step("inspect of a script without a dialog is refused", "run_process", script("NoiseEvaluation", { inspect: true }),
  { expectError: true, expect: [/defines no dialog/] });
await step("the dialog's own OK button, V8 engine", "run_process",
  script("AutoLinearFit", { controls: { "Target View": VIEW } }), { expect: [/clicked "ok_Button"/, /step/] });
await step("a list, and settings for a dialog the script never opens", "run_process",
  script("PreviewAggregator", { dialogs: [{ controls: { target_List: [] } }, { controls: { target_List: [] } }], answers: { "No preview": "No" } }),
  { expectError: true, expect: [/settings for dialog 2 were never applied/] });

await step("a dialog opened again with no settings for it is closed", "run_process", script("PreviewAggregator"),
  { expect: [/opened again, closed/, /\[Yes\]/] });
await step("an Execute and Close loop runs once, and a checkbox reaches onClick", "run_process",
  script("CorrectMagentaStars", { controls: { "Amount": 0.5, "Show Automask": false }, button: "Execute" }),
  { expect: [/\(1 step/, /opened again, closed/], absent: [/Magenta_Automask/] });
await step("inspect with parameters shows the dialog of a script that runs view targets without one", "run_process",
  script("CorrectMagentaStars", { inspect: true, parameters: { CMSAmount: 0.5 } }), { expect: [/The view is unchanged/, /Amount/] });
await step("inspect clicks Cancel, whose handler closes the windows the dialog made", "run_process",
  script("BackgroundEnhance", { inspect: true }), { expect: [/"Small Scales Layers"/], absent: [/New windows/] });
await step("a button the script draws itself", "run_process",
  script("AstroContrastEnhancer", { controls: { Texture: "20" }, button: "applyButton" }), { expect: [/\(1 step/, /\[Yes\]/] });
await step("a misspelled control is refused before running", "run_process",
  script("DarkStructureEnhance", { controls: { Strength: 1 } }), { expectError: true, expect: [/has no control 'Strength'/] });
// A failed V8 run followed by a legacy run with a dialog, which leftovers of the failed run could break.
await step("a missing button is refused", "run_process", script("Halo-B-Gon", { button: "Apply" }),
  { expectError: true, expect: [/has no button 'Apply'/] });
await step("an answer the message box does not offer is refused", "run_process",
  script("PreviewAggregator", { answers: { "No preview was selected": "Retry" } }), { expectError: true, expect: [/offers Yes, No/] });
await step("an unknown script name is refused", "run_process", script("NoSuchScript"),
  { expectError: true, expect: [/No Script menu script named/] });
await step("an unknown setting is refused", "run_process", script("Halo-B-Gon", { md5sum: "x" }),
  { expectError: true, expect: [/Invalid Script settings/] });

// Closing an image that finished runs' view lists showed, which calls their handlers if they are
// still alive.
const CLOSING = "script_smoke_closing";
await step("second image", "run_process", {
  processId: "NewImage", settings: { id: CLOSING, width: SIZE / 4, height: SIZE / 4, numberOfChannels: 3, colorSpace: 0, sampleFormat: 3 },
});
await step("view list showing it, legacy engine", "run_process",
  { processId: "Script", viewId: CLOSING, settings: { script: "DarkStructureEnhance", inspect: true } }, { expect: [/Target image/] });
await step("view list showing it, V8 engine", "run_process",
  { processId: "Script", viewId: CLOSING, settings: { script: "AutoLinearFit", inspect: true } }, { expect: [/Target View/] });
await step("close the image the view lists showed", "close_image", { viewId: CLOSING });
await step("close the synthetic image", "close_image", { viewId: VIEW });

// A failed LocalFuzzyHistogramHyperbolization run and EZ Soft Stretch both select the image in a view
// list, and EZ Soft Stretch adds members to native prototypes. Closing the image right after, with no
// other run between, calls their freed handlers unless the runs cleared the selections.
const STRETCHED = "script_smoke_stretch";
const onStretched = (name, settings) => ({ processId: "Script", viewId: STRETCHED, settings: { script: name, ...settings } });
await step("image to stretch", "run_process", {
  processId: "NewImage", settings: { id: STRETCHED, width: SIZE / 2, height: SIZE / 2, numberOfChannels: 3, colorSpace: 0, sampleFormat: 3 },
});
await step("image to stretch noise", "run_process",
  { processId: "NoiseGenerator", viewId: STRETCHED, settings: { amount: NOISE_AMOUNT, distribution: NORMAL_DISTRIBUTION } });
await step("a failed run with a view list showing the image", "run_process",
  onStretched("LocalFuzzyHistogramHyperbolization", { controls: { "Target Image": STRETCHED, "NoSuchControl": 1 } }),
  { expectError: true, expect: [/has no control 'NoSuchControl'/] });
await step("a script that adds members to native prototypes", "run_process",
  onStretched("EZ Soft Stretch", { controls: { mainViewSelector: STRETCHED }, button: "Run EZ Soft Stretch" }),
  { expect: [/clicked "Run EZ Soft Stretch"/, /step/] });
await step("close the image they showed", "close_image", { viewId: STRETCHED });
await runSource("the members the script added are deleted", "console.writeln(\"Sizer.prototype.items is \" + typeof Sizer.prototype.items);\n",
  { expect: [/items is undefined/] });
await client.close();
console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
