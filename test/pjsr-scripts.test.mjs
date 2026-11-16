// The run_script handler code from the bundle, run in a Node context with small substitutes for the
// PixInsight classes it uses. PixInsight itself is covered by npm run smoke:scripts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const bundlePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "pjsr", "mcp-handlers.js");

// Controls with a position in their parent, as PJSR lays them out.
class Control {
  constructor(parent, { x = 0, y = 0, width = 0, height = 0 } = {}) {
    this.parent = parent ?? null;
    this.position = { x, y };
    this.width = width;
    this.height = height;
  }
}
class Label extends Control {}
class CheckBox extends Control {}
class ComboBox extends Control {}
class SpinBox extends Control {}
class PushButton extends Control {}

// Timers that fire only when the test ticks them, as PixInsight's event loop would.
class Timer {
  static running = [];
  start() { Timer.running.push(this); }
  stop() { Timer.running = Timer.running.filter((timer) => timer !== this); }
}
function tick(context, times = 1) {
  for (let count = 0; count < times; ++count) context.Timer.running.forEach((timer) => timer.onTimeout());
}

function loadBundle(extra = {}) {
  const context = createContext({ Control, Label, CheckBox, ComboBox, SpinBox, PushButton, Timer, ...extra });
  runInContext(fs.readFileSync(bundlePath, "utf8"), context);
  context.Timer.running = [];
  return context;
}

test("colors read as #AARRGGBB and take #RRGGBB, #AARRGGBB or a number", () => {
  const pjsr = loadBundle();
  assert.equal(pjsr.colorText(0xffff0000), "#FFFF0000");
  assert.equal(pjsr.colorValue("#FF0000"), 0xffff0000);
  assert.equal(pjsr.colorValue("80112233"), 0x80112233);
  assert.equal(pjsr.colorValue(255), 255);
  assert.throws(() => pjsr.colorValue("red"), /not #RRGGBB/);
});

test("labels lose markup, mnemonics and a trailing colon", () => {
  const pjsr = loadBundle();
  assert.equal(pjsr.cleanLabel("<b>&Amount:</b> "), "Amount");
});

test("a message box gets the button its answer names, or else its first button", () => {
  const pjsr = loadBundle();
  const run = { answers: { "continue?": "No" }, usedAnswers: {} };
  const yesNo = [pjsr.MESSAGE_BUTTONS.Yes, pjsr.MESSAGE_BUTTONS.No];
  assert.equal(pjsr.messageAnswer(run, "Do you want to CONTINUE?", yesNo), pjsr.MESSAGE_BUTTONS.No);
  assert.deepEqual(Object.keys(run.usedAnswers), ["continue?"]);
  assert.equal(pjsr.messageAnswer(run, "Something else", yesNo), pjsr.MESSAGE_BUTTONS.Yes);
  assert.throws(() => pjsr.messageAnswer({ answers: { continue: "Retry" }, usedAnswers: {} }, "continue", yesNo), /offers Yes, No, not Retry/);
  assert.throws(() => pjsr.messageAnswer({ answers: { continue: "Maybe" }, usedAnswers: {} }, "continue", yesNo), /Unknown button/);
});

test("a run of the same message is shown once with its count", () => {
  const pjsr = loadBundle();
  assert.deepEqual([...pjsr.collapsedMessages(["a", "a", "a", "b", "a"])], ["a (x3)", "b", "a"]);
});

test("controls are found through properties and children, and labelled by position", () => {
  const pjsr = loadBundle();
  const dialog = new Control(null, { width: 300, height: 200 });
  const row = new Control(dialog, { y: 40, width: 300, height: 30 });
  const amountLabel = Object.assign(new Label(row, { x: 0, width: 60, height: 20 }), { text: "Amount:" });
  const amount = Object.assign(new SpinBox(row, { x: 70, width: 80, height: 20 }), { value: 3, minValue: 0, maxValue: 9 });
  // A label met later in property order, placed above another control, which must not take it.
  const modeLabel = Object.assign(new Label(dialog, { y: 90, width: 100, height: 20 }), { text: "Mode" });
  const mode = Object.assign(new ComboBox(dialog, { y: 112, width: 120, height: 20 }), {
    numberOfItems: 2, currentItem: 1, itemText: (index) => ["Fast", "Slow"][index],
  });
  const ok = Object.assign(new PushButton(dialog, { y: 170, width: 60, height: 20 }), { text: "&OK" });
  dialog.children = [row, modeLabel, mode];
  row.children = [amountLabel, amount];
  Object.assign(dialog, { ok_Button: ok });

  const entries = pjsr.dialogControls(dialog);
  // Array.from copies the bundle context's arrays into this realm, so they compare.
  const summary = Array.from(entries, (entry) => [entry.name, entry.kind.kind, entry.label]);
  assert.deepEqual(summary, [["ok_Button", "button", "OK"], ["[0][1]", "spin", "Amount"], ["[2]", "combo", "Mode"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(pjsr.describeControl(entries[2]))),
    { name: "[2]", kind: "combo", label: "Mode", value: "Slow", items: ["Fast", "Slow"] });
  assert.equal(pjsr.matchControls(entries, "amount")[0].control, amount);
});

// A script's V8 dialog built on the run's Dialog substitute, with an OK button that closes it.
function v8Dialog(pjsr, run, { withShowHandler }) {
  class NativeDialog extends Control {
    constructor() {
      super(null, { width: 200, height: 100 });
      this.visible = false;
      this.windowTitle = "Tool";
      this.shown = 0;
    }

    ok() { this.done(1); }
    cancel() { this.done(0); }
    done(code) { this.visible = false; this.result = code; }
  }
  pjsr.NativeDialog = NativeDialog;
  const engine = runInContext("Dialog = NativeDialog; v8ScriptEngine", pjsr)(run);
  const ToolDialog = class extends engine.scope.Dialog {
    constructor() {
      super();
      if (withShowHandler) this.onShow = () => { this.shown++; };
      this.ok_Button = Object.assign(new PushButton(this, { width: 50, height: 20 }), { text: "OK", onClick: () => this.ok() });
    }
  };
  return { engine, dialog: new ToolDialog() };
}

const newRun = (inspect = false) => ({ inspect, dialogSettings: [], dialogs: [], output: [], failure: null });

test("a V8 dialog is driven after two checks open, through its own OK button", () => {
  const pjsr = loadBundle({ processEvents: () => {} });
  const run = newRun();
  const { engine, dialog } = v8Dialog(pjsr, run, { withShowHandler: false });
  tick(pjsr);
  dialog.visible = true;
  tick(pjsr);
  assert.equal(run.dialogs.length, 0);
  tick(pjsr);
  assert.equal(run.dialogs.length, 1);
  assert.equal(run.dialogs[0].clicked, "OK");
  assert.equal(dialog.visible, false);
  assert.equal(dialog.result, 1);
  engine.restore();
  assert.equal(pjsr.Timer.running.length, 0);
});

test("a V8 dialog waits while the script's onShow is still running", () => {
  const pjsr = loadBundle({ processEvents: () => {} });
  const run = newRun(true);
  const { engine, dialog } = v8Dialog(pjsr, run, { withShowHandler: true });
  tick(pjsr);
  dialog.visible = true;
  tick(pjsr, 5);
  assert.equal(run.dialogs.length, 0);
  dialog.onShow();
  assert.equal(dialog.shown, 1);
  tick(pjsr, 2);
  assert.equal(run.dialogs.length, 1);
  assert.equal(dialog.result, 0);
  engine.restore();
});

test("a V8 dialog the script opens again is driven again", () => {
  const pjsr = loadBundle({ processEvents: () => {} });
  const run = newRun(true);
  const { engine, dialog } = v8Dialog(pjsr, run, { withShowHandler: false });
  for (let opening = 0; opening < 2; ++opening) {
    dialog.visible = true;
    tick(pjsr, 2);
    tick(pjsr);
  }
  assert.equal(run.dialogs.length, 2);
  engine.restore();
});
