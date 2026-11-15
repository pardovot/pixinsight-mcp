// The history, export and render handlers and the measurement helpers from the bundle, run in a
// Node context with substitutes for the PixInsight classes they use.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const bundlePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "pjsr", "mcp-handlers.js");

function loadBundle(globals = {}) {
  const context = createContext(globals);
  runInContext(fs.readFileSync(bundlePath, "utf8"), context);
  return context;
}

// Values the bundle builds belong to its own context, so they are copied before a deep comparison.
const plain = (value) => JSON.parse(JSON.stringify(value));

// A process's source as toSource() writes it: the instance, named P, then one assignment per line.
const INSTANCE_NAME = "P";
const assignmentLine = (assignment) => `${INSTANCE_NAME}.${assignment};`;
function processSource(className, assignments) {
  const declaration = ["var", INSTANCE_NAME, "=", "new", `${className};`].join(" ");
  return [declaration, ...assignments.map(assignmentLine), ""].join("\n");
}

test("a step's settings are cut at the limit, and marked only when lines were left out", () => {
  const pjsr = loadBundle();
  const settings = (count) => [...Array(count).keys()].map((index) => `setting${index} = ${index}`);
  const instance = (count) => ({ toSource: () => processSource("Crop", settings(count)) });

  assert.deepEqual(plain(pjsr.settingsLines(instance(3), 3)), settings(3).map(assignmentLine));
  const cut = plain(pjsr.settingsLines(instance(5), 3));
  assert.equal(cut.length, 4);
  assert.match(cut[3], /truncated/);
});

test("a snapshot replaces a hidden window with its id, and refuses a visible one or the view itself", () => {
  const closed = [];
  const windows = {};
  class ImageWindow {
    constructor(width, height, channels, bitsPerSample, isReal, isColor, id) {
      this.isNull = false;
      this.visible = false;
      this.mainView = { id, image: { assign: () => {} }, beginProcess: () => {}, endProcess: () => {} };
      windows[id] = this;
    }

    forceClose() {
      closed.push(this.mainView.id);
      delete windows[this.mainView.id];
    }

    static windowById(id) {
      return windows[id] ?? { isNull: true };
    }
  }
  const pixels = { width: 4, height: 4, numberOfChannels: 1, bitsPerSample: 32, isReal: true, isColor: false };
  const openImage = (id) => {
    const view = { id, isNull: false, image: pixels };
    view.window = { isNull: false, visible: true, mainView: view, forceClose: () => closed.push(id) };
    windows[id] = view.window;
    return view;
  };
  const views = { M31: openImage("M31"), stars: openImage("stars") };
  const pjsr = loadBundle({ ImageWindow, View: { viewById: (id) => views[id] } });
  const snapshot = (snapshotId) => pjsr.handleSnapshot({ parameters: { viewId: "M31", snapshotId } });

  assert.throws(() => snapshot("M31"), /needs an id of its own/);
  assert.throws(() => snapshot("stars"), /is an open image, not a snapshot/);
  assert.deepEqual(closed, []);
  assert.equal(snapshot(undefined).outputs.snapshotId, "M31_snap");
  assert.equal(snapshot(undefined).outputs.snapshotId, "M31_snap");
  assert.deepEqual(closed, ["M31_snap"]);
});

test("a container keeps every table under the columns toSource names, and reports what it cannot write", () => {
  const sources = {
    HistogramTransformation: processSource("HistogramTransformation", [
      "H = [ // c0, m, c1, r0, r1\n" +
      "   [0.00000000, 0.50000000, 1.00000000, 0.00000000, 1.00000000],\n" +
      "   [0.01000000, 0.25000000, 1.00000000, 0.00000000, 1.00000000]\n]",
    ]),
    ChannelCombination: processSource("ChannelCombination", [
      "colorSpace = ChannelCombination.RGB",
      'channels = [ // enabled, id\n   [true, "red & <green>"],\n   [false, ""]\n]',
      "inheritAstrometricSolution = true",
    ]),
    Odd: processSource("Odd", ["mask = 0xFF00", "modes = [ // mode\n   [Odd.Fast]\n]", "amount = 0.5"]),
  };
  const steps = Object.entries(sources).map(([processId, source]) => ({ toSource: () => source, processId: () => processId }));
  const main = { id: "M31", isNull: false, processing: { length: steps.length, at: (index) => steps[index] } };
  main.window = { mainView: main };
  let written = "";
  const pjsr = loadBundle({
    View: { viewById: () => main },
    File: { writeTextFile: (filePath, text) => { written = text; } },
    console: { warningln: () => {} },
  });
  const result = pjsr.handleExportContainer({ parameters: { viewId: "M31", outputPath: "C:/out/linear.xpsm", iconName: "Linear" } });

  assert.match(written, /<table id="H" rows="2">\s*<tr>\s*<td id="c0" value="0"\/>\s*<td id="m" value="0.5"\/>/);
  assert.match(written, /<td id="c0" value="0.01"\/>\s*<td id="m" value="0.25"\/>\s*<td id="c1" value="1"\/>/);
  assert.match(written, /<td id="enabled" value="true"\/>\s*<td id="id">red &amp; &lt;green&gt;<\/td>/);
  assert.match(written, /<td id="enabled" value="false"\/>\s*<td id="id"><\/td>/);
  assert.match(written, /<parameter id="colorSpace" value="RGB"\/>/);
  assert.match(written, /<parameter id="amount" value="0.5"\/>/);
  assert.match(written, /<icon id="Linear" instance="Linear_inst"/);
  assert.deepEqual(plain(result.outputs.skipped), ["Odd.mask", "Odd.modes"]);
  assert.match(result.message, /without Odd\.mask, Odd\.modes/);
});

test("a mono view's STF renders through the combined row, a color view's through its channel rows", () => {
  const pjsr = loadBundle();
  const stretched = [0.2, 0.01, 1, 0, 1];
  const identity = [0.5, 0, 1, 0, 1];
  const mono = { isColor: false, numberOfChannels: 1 };
  const color = { isColor: true, numberOfChannels: 3 };
  const warnings = [];

  assert.deepEqual(plain(pjsr.renderStretch({ image: mono, stf: [stretched, identity, identity, identity] }, "view", warnings)),
    { 3: [0.01, 0.2, 1] });
  assert.deepEqual(plain(pjsr.renderStretch({ image: color, stf: [stretched, identity, stretched, identity] }, "view", warnings)),
    { 0: [0.01, 0.2, 1], 1: [0, 0.5, 1], 2: [0.01, 0.2, 1] });
  assert.deepEqual(warnings, []);
  assert.equal(pjsr.renderStretch({ image: mono, stf: [identity, identity, identity, identity] }, "view", warnings), null);
  assert.match(warnings[0], /no STF set/);
});

test("a render region is clamped to the image and keeps at least one pixel", () => {
  const pjsr = loadBundle();
  const image = { width: 100, height: 50 };
  assert.deepEqual(plain(pjsr.renderRegion(image, null)), { left: 0, top: 0, right: 100, bottom: 50 });
  assert.deepEqual(plain(pjsr.renderRegion(image, [-5, 10, 400, 20])), { left: 0, top: 10, right: 100, bottom: 20 });
  assert.deepEqual(plain(pjsr.renderRegion(image, [200, 200, 300, 300])), { left: 99, top: 49, right: 100, bottom: 50 });
});

test("median, significant figures and the plane fit", () => {
  const pjsr = loadBundle();
  assert.equal(pjsr.median([3, 1, 2]), 2);
  assert.equal(pjsr.median([4, 1, 2, 3]), 2.5);
  assert.equal(pjsr.median([]), null);
  assert.equal(pjsr.significant(0.000012345678), 0.0000123457);
  assert.equal(pjsr.significant(null), null);

  // The normal equations of median = 1 + 2x + 3y sampled at the corners of the unit square.
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rightSide = [0, 0, 0];
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const terms = [1, x, y];
    terms.forEach((rowTerm, row) => {
      terms.forEach((columnTerm, column) => { normal[row][column] += rowTerm * columnTerm; });
      rightSide[row] += rowTerm * (1 + 2 * x + 3 * y);
    });
  }
  assert.deepEqual(plain(pjsr.solvePlane(normal, rightSide)), { a: 1, bx: 2, by: 3 });
  assert.equal(pjsr.solvePlane([[0, 0, 0], [0, 0, 0], [0, 0, 0]], [0, 0, 0]), null);
});

test("maxima closer than the star separation count as one star, the brightest", () => {
  const pjsr = loadBundle();
  const candidates = [{ x: 100, y: 100, value: 0.9 }, { x: 105, y: 102, value: 0.8 }, { x: 200, y: 100, value: 0.5 }];
  assert.deepEqual(plain(pjsr.separateStars(candidates)).map((star) => star.x), [100, 200]);
});
