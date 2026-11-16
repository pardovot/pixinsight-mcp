// Script runs without PixInsight: the driver each engine gets, and the validation of Script settings.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BridgeClient, driverSource, SCRIPT_SHADOWED_NAMES } from "../build/bridge/client.js";
import { definesDialog, findScript, parseScriptSettings, scriptNames } from "../build/tools/script.js";

const files = { bundlePath: "C:\\bridge\\mcp-handlers.js", commandPath: "C:\\bridge\\command.json", resultPath: "C:\\bridge\\result.json" };

test("a plain command driver includes the bundle and dispatches, on the default engine", () => {
  const driver = driverSource(files);
  const lines = driver.split("\n");
  assert.equal(lines[0], '#include "C:/bridge/mcp-handlers.js"');
  assert.ok(driver.includes("dispatchCommand( __command )"));
  assert.ok(!driver.includes("#engine"));
  assert.ok(!driver.includes("runIncludedScript"));
});

test("a legacy script is included inside runIncludedScript on the legacy engine", () => {
  const driver = driverSource({ ...files, script: { path: "C:\\scripts\\Dark.js", source: "#include <pjsr/Sizer.jsh>\nmain();\n" } });
  const lines = driver.split("\n");
  assert.equal(lines[0], '#include "C:/bridge/mcp-handlers.js"');
  const start = lines.indexOf(`function runIncludedScript( ${SCRIPT_SHADOWED_NAMES.join(", ")} ) {`);
  assert.ok(start > 0);
  assert.equal(lines[start + 1], '#include "C:/scripts/Dark.js"');
  assert.equal(lines[start + 2], "}");
  assert.equal(lines[start + 3], `runIncludedScript.shadowedNames = ${JSON.stringify(SCRIPT_SHADOWED_NAMES)};`);
  assert.ok(!driver.includes("#engine"));
});

test("a script declaring #engine v8 gets a V8 driver", () => {
  const driver = driverSource({ ...files, script: { path: "/scripts/Boost.js", source: "// header\n#engine v8\nclass A {}\n" } });
  assert.equal(driver.split("\n")[0], "#engine v8");
});

test("#engine v8 counts only at the start of a line", () => {
  const driver = driverSource({ ...files, script: { path: "/scripts/Old.js", source: "// runs fine without #engine v8\nmain();\n" } });
  assert.ok(!driver.startsWith("#engine"));
});

test("a path that would break the #include string is refused", () => {
  assert.throws(() => driverSource({ ...files, script: { path: 'C:\\odd"name.js', source: "" } }), /not usable in a PixInsight #include/);
});

test("the client hands the script path to the dispatcher", async (context) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixinsight-mcp-test-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  let handed;
  const client = new BridgeClient({ bridgeDir: dir, pollIntervalMs: 25, defaultTimeoutMs: 200 }, {
    dispatch: async (command, commandPath, includeScript) => {
      handed = includeScript;
    },
  });
  await client.call("run_script", { filePath: "/scripts/A.js" }, { includeScript: "/scripts/A.js" });
  assert.equal(handed, "/scripts/A.js");
});

test("Script settings need an absolute path to an existing file", async (context) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixinsight-mcp-test-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scriptPath = path.join(dir, "Example.js");
  await fs.writeFile(scriptPath, "main();\n");

  assert.deepEqual(parseScriptSettings({ filePath: scriptPath, controls: { Amount: 0.6 }, button: "Execute" }),
    { filePath: scriptPath, dialogs: [{ controls: { Amount: 0.6 }, button: "Execute" }] });
  assert.deepEqual(parseScriptSettings({ filePath: scriptPath }), { filePath: scriptPath, dialogs: [] });
  assert.throws(() => parseScriptSettings({}), /needs script \(a name\) or filePath/);
  assert.throws(() => parseScriptSettings({ filePath: "Example.js" }), /must be absolute/);
  assert.throws(() => parseScriptSettings({ filePath: path.join(dir, "Missing.js") }), /No script file/);
  assert.throws(() => parseScriptSettings({ filePath: dir }), /No script file/);
});

test("unknown Script settings and non scalar values are refused", async (context) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixinsight-mcp-test-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scriptPath = path.join(dir, "Example.js");
  await fs.writeFile(scriptPath, "main();\n");
  assert.throws(() => parseScriptSettings({ filePath: scriptPath, md5sum: "abc" }), /Invalid Script settings/);
  assert.throws(() => parseScriptSettings({ filePath: scriptPath, controls: { Amount: [1] } }), /controls\.Amount/);
});

test("a script answers to its file name and menu items, and apart from those its feature ids", () => {
  const source = "#feature-id    StarStretch : SetiAstro > Star Stretch | Utilities > Stretch Stars\n" +
    "#feature-id Utilities > DarkStructureEnhance \\\n";
  assert.deepEqual(scriptNames(source, "/scripts/star_stretch.js"), {
    names: ["star_stretch", "Star Stretch", "Stretch Stars", "DarkStructureEnhance"],
    featureIds: ["StarStretch"],
  });
});

test("a script name finds its file under the scripts folder, ignoring case and spaces", async (context) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixinsight-mcp-test-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, "Toolbox"));
  const starStretch = path.join(dir, "star_stretch.js");
  await fs.writeFile(starStretch, "#feature-id StarStretch : SetiAstro > Star Stretch\nmain();\n");
  await fs.writeFile(path.join(dir, "Toolbox", "Boost.js"), "#feature-id Boost : Toolbox > Color Boost\nmain();\n");
  await fs.writeFile(path.join(dir, "Toolbox", "OtherBoost.js"), "#feature-id OtherBoost : Utilities > Color Boost\nmain();\n");
  await fs.writeFile(path.join(dir, "helper.js"), "// no menu entry\n");
  // A bundle sharing one feature id, as NoiseEvaluation and NoiseEvaluationCFA do.
  await fs.writeFile(path.join(dir, "Noise.js"), "#feature-id Noise : Analysis > Noise\nmain();\n");
  await fs.writeFile(path.join(dir, "NoiseCFA.js"), "#feature-id Noise : Analysis > Noise (CFA)\nmain();\n");

  assert.equal(findScript("Noise", dir), path.join(dir, "Noise.js"));
  assert.equal(findScript("Noise (CFA)", dir), path.join(dir, "NoiseCFA.js"));
  assert.equal(findScript("starstretch", dir), starStretch);
  assert.equal(findScript("Star Stretch", dir), starStretch);
  assert.equal(findScript("Boost", dir), path.join(dir, "Toolbox", "Boost.js"));
  assert.throws(() => findScript("Color Boost", dir), /Several scripts/);
  assert.throws(() => findScript("helper", dir), /No Script menu script/);
});

test("Script settings take a name or a path, not both", async (context) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixinsight-mcp-test-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scriptPath = path.join(dir, "Example.js");
  await fs.writeFile(scriptPath, "#feature-id Example : Utilities > Example\nmain();\n");
  assert.equal(parseScriptSettings({ script: "Example", answers: { continue: "No" } }, dir).filePath, scriptPath);
  assert.throws(() => parseScriptSettings({ script: "Example", filePath: scriptPath }, dir), /not both/);
  assert.throws(() => parseScriptSettings({ answers: { continue: 3 } }, dir), /answers\.continue/);
});

test("settings for several dialogs go in dialogs, in place of controls and button", async (context) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixinsight-mcp-test-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scriptPath = path.join(dir, "Example.js");
  await fs.writeFile(scriptPath, "main();\n");
  const dialogs = [{ controls: { Previews: ["view->Preview01"], Border: "#FF0000" } }, { button: "Execute" }];
  assert.deepEqual(parseScriptSettings({ filePath: scriptPath, dialogs }).dialogs, dialogs);
  assert.throws(() => parseScriptSettings({ filePath: scriptPath, dialogs, button: "OK" }), /dialogs or controls and button/);
  assert.throws(() => parseScriptSettings({ filePath: scriptPath, dialogs: [{ inspect: true }] }), /Invalid Script settings/);
});

test("a script defines a dialog in itself or in a file it includes from its folder", async (context) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixinsight-mcp-test-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  const write = (name, source) => fs.writeFile(path.join(dir, name), source);
  await write("Class.js", "class Tool extends Dialog {}\nmain();\n");
  await write("Base.js", "function ToolDialog() { this.__base__ = Dialog; this.__base__(); }\n");
  await write("Gui.jsh", "ToolDialog.prototype = new Dialog;\n");
  await write("Includer.js", "#include <pjsr/Sizer.jsh>\n#include \"Gui.jsh\"\nmain();\n");
  await write("Plain.js", "#include <pjsr/StdButton.jsh>\nconsole.writeln(\"no dialog here\");\n");
  for (const name of ["Class.js", "Base.js", "Includer.js"]) assert.equal(definesDialog(path.join(dir, name)), true, name);
  assert.equal(definesDialog(path.join(dir, "Plain.js")), false);

  assert.throws(() => parseScriptSettings({ filePath: path.join(dir, "Plain.js"), inspect: true }), /defines no dialog/);
  assert.equal(parseScriptSettings({ filePath: path.join(dir, "Plain.js") }).filePath, path.join(dir, "Plain.js"));
  assert.equal(parseScriptSettings({ filePath: path.join(dir, "Includer.js"), inspect: true }).inspect, true);
});
