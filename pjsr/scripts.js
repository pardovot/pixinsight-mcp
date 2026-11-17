// run_script: runs an installed PixInsight script with no user interaction, through the script's own
// code. The driver (src/bridge/client.ts) includes the script inside runIncludedScript, whose
// parameters shadow the globals listed in its shadowedNames. This file builds the run and the sandbox
// and drives each dialog with its settings, a script engine (pjsr/script-engines.js) takes over the
// dialogs and the console, and pjsr/script-controls.js finds and sets a dialog's controls.

// Console lines kept for the result.
var OUTPUT_LINES = 60;
var PICKERS = ["OpenFileDialog", "SaveFileDialog", "GetDirectoryDialog", "ColorDialog", "FontDialog"];
// The StdButton values, which the legacy engine defines only through includes.
var MESSAGE_BUTTONS = { Ok: 1, Cancel: 2, Yes: 3, No: 4, Abort: 5, Retry: 6, Ignore: 7, YesToAll: 8, NoToAll: 9 };
// Scripts ask again in a loop when an answer does not satisfy them, and a headless run gives the same
// answer every time, so a run that reaches these counts is stopped.
var MAX_DIALOGS = 10;
var MAX_MESSAGES = 30;
var ASKS_AGAIN = ", it asks again for something this run cannot change, see the messages";
// A dialog's own OK button: labelled OK, or kept as ok_Button or okButton.
var OK_LABEL = /^ok$/i;
var OK_NAME = /(^|\.)ok_?button$/i;
// A dialog's own Cancel or Close button, labelled so or kept as cancel_Button, closeButton and the like.
var CANCEL_LABEL = /^(cancel|close)$/i;
var CANCEL_NAME = /(^|\.)(cancel|close)_?button$/i;

function errorText(error) {
   return String(error.message || error);
}

// A run reports its first failure, the one the others follow from.
function recordFailure(run, error) {
   if (!run.failure)
      run.failure = errorText(error);
}

// V8 installs native methods on each instance as read only own properties, the legacy engine keeps
// them on the prototype. Scripts without #engine v8 run on the legacy engine.
function isV8Engine() {
   return Object.prototype.hasOwnProperty.call(new Timer(), "start");
}

// The Parameters a script sees. With values it runs as a script instance with them, executed on the
// view or globally, which many scripts do without their dialog. Without values, and when inspecting,
// it starts as it does from the Script menu, on the active window.
function scriptParameters(view, values, asInstance) {
   var stored = {};
   Object.keys(values).forEach(function (name) { stored[name] = values[name]; });
   return {
      isViewTarget: asInstance && view !== null, isGlobalTarget: asInstance && view === null, targetView: asInstance ? view : null,
      has: function (name) { return Object.prototype.hasOwnProperty.call(stored, name); },
      get: function (name) { return String(stored[name]); },
      getString: function (name) { return String(stored[name]); },
      getReal: function (name) { return Number(stored[name]); },
      getInteger: function (name) { return Math.round(Number(stored[name])); },
      getUInt: function (name) { return Math.round(Number(stored[name])); },
      getBoolean: function (name) { return stored[name] === true || stored[name] === "true" || stored[name] === "1"; },
      set: function (name, value) { stored[name] = value; },
      remove: function (name) { delete stored[name]; },
      clear: function () { stored = {}; },
      clearInstance: function () {},
      indexedId: function (name, index) { return name + "_" + index; }
   };
}

function messageButtonName(code) {
   var names = Object.keys(MESSAGE_BUTTONS).filter(function (name) { return MESSAGE_BUTTONS[name] === code; });
   return names.length ? names[0] : String(code);
}

// The answer to a message box: the button named for the first answers key found in its text, case
// insensitive, or else its first button. The named button must be one the box offers.
function messageAnswer(run, text, offered) {
   var lowered = text.toLowerCase();
   var keys = Object.keys(run.answers).filter(function (key) { return lowered.indexOf(key.toLowerCase()) >= 0; });
   if (keys.length === 0)
      return offered[0];
   run.usedAnswers[keys[0]] = true;
   var wanted = String(run.answers[keys[0]]).toLowerCase();
   var names = Object.keys(MESSAGE_BUTTONS).filter(function (name) { return name.toLowerCase() === wanted; });
   if (names.length === 0)
      throw new Error("Unknown button '" + run.answers[keys[0]] + "', one of " + Object.keys(MESSAGE_BUTTONS).join(", "));
   if (offered.indexOf(MESSAGE_BUTTONS[names[0]]) < 0)
      throw new Error("Message '" + text + "' offers " + offered.map(messageButtonName).join(", ") + ", not " + names[0]);
   return MESSAGE_BUTTONS[names[0]];
}

// The sandbox both engines share: Parameters, message boxes answered as requested or with their first
// button, and file pickers that cancel. None of them is a Control, so plain objects replace them.
function sandboxScope(run, view, parameterValues) {
   var asInstance = !run.inspect && Object.keys(parameterValues).length > 0;
   var scope = { Parameters: scriptParameters(view, parameterValues, asInstance) };
   scope.MessageBox = function (text, caption, icon, button0, button1, button2) {
      var offered = [button0, button1, button2].filter(function (button) { return typeof button === "number" && button !== 0; });
      if (offered.length === 0)
         offered = [MESSAGE_BUTTONS.Ok];
      return { text: text, caption: caption, execute: function () {
         var message = cleanLabel(text);
         try {
            if (run.messages.length >= MAX_MESSAGES)
               throw new Error("The script showed " + MAX_MESSAGES + " messages" + ASKS_AGAIN);
            var answer = messageAnswer(run, message, offered);
            run.messages.push(message + " [" + messageButtonName(answer) + "]");
            return answer;
         } catch (error) {
            recordFailure(run, error);
            throw error;
         }
      } };
   };
   PICKERS.forEach(function (name) {
      scope[name] = function () {
         return { fileName: "", fileNames: [], directory: "", filters: [], execute: function () {
            run.messages.push(name + " cancelled, a headless run cannot pick files");
            return false;
         } };
      };
   });
   return scope;
}

function buttonEntries(entries) {
   return entries.filter(function (entry) { return entry.kind.kind === "button"; });
}

// The dialog's own button whose label or name matches. Null for none.
function ownButton(entries, labelPattern, namePattern) {
   var matches = buttonEntries(entries).filter(function (entry) { return labelPattern.test(entry.label) || namePattern.test(entry.name); });
   return matches[0] || null;
}

// The named button, a button or a drawing area the script may draw as a button, or else the dialog's own
// OK button. Null for none.
function dialogButton(entries, name) {
   if (name) {
      var drawn = entries.filter(function (entry) { return entry.kind.kind === "canvas"; });
      return matchControls(buttonEntries(entries), name)[0] || matchControls(drawn, name)[0] || null;
   }
   return ownButton(entries, OK_LABEL, OK_NAME);
}

// Clicks the dialog's own Cancel or Close button, whose handler may clean up what the dialog made, such
// as preview windows. Returns whether there is one.
function clickCancel(entries) {
   var button = ownButton(entries, CANCEL_LABEL, CANCEL_NAME);
   if (button !== null)
      clickButton(button);
   return button !== null;
}

// Rejects a dialog the way a user does, with its own Cancel or Close button.
function cancelDialog(entries) {
   clickCancel(entries);
   return false;
}

// Records a dialog and, unless inspecting, applies its entry of run.dialogSettings: the controls are
// set, then the named button is clicked, or else the dialog's own OK button, whose handler may read the
// controls. Returns whether the dialog is to be accepted. Every requested control and button must be
// in the dialog, so a misspelled name never runs the script on its defaults. A dialog still open after
// the click, and one a script that works after each OK opens again with no settings given, is closed
// as a user would close it.
function driveDialog(run, engine, dialog) {
   if (run.dialogs.length >= MAX_DIALOGS)
      throw new Error("The script opened its dialog " + MAX_DIALOGS + " times" + ASKS_AGAIN);
   var settings = run.dialogSettings[run.dialogs.length];
   var reopened = run.openedDialogs.indexOf(dialog) >= 0;
   run.openedDialogs.push(dialog);
   var entries = dialogControls(dialog);
   var record = { title: String(dialog.windowTitle), controls: entries.map(describeControl) };
   run.dialogs.push(record);
   if (run.inspect)
      return cancelDialog(entries);
   if (reopened && settings === undefined) {
      record.closed = true;
      return cancelDialog(entries);
   }
   settings = settings || {};
   var controls = settings.controls || {};

   record.applied = {};
   Object.keys(controls).forEach(function (key) {
      var matches = matchControls(entries, key).filter(function (entry) { return entry.kind.kind !== "button"; });
      if (matches.length > 1)
         throw new Error("Control '" + key + "' is ambiguous in dialog '" + record.title + "': " +
                         matches.map(function (entry) { return entry.name; }).join(", ") + ", use one of these names");
      if (matches.length === 0)
         throw new Error("Dialog '" + record.title + "' has no control '" + key + "', run with inspect to list them");
      setControl(matches[0], controls[key]);
      record.applied[key] = describeControl(matches[0]).value;
   });

   var button = dialogButton(entries, settings.button);
   if (button === null && settings.button)
      throw new Error("Dialog '" + record.title + "' has no button '" + settings.button + "', run with inspect to list them");
   if (button === null)
      return true;
   engine.forgetClosure(dialog);
   var messagesBefore = run.messages.length;
   clickButton(button);
   record.clicked = button.label || button.name;
   var closure = engine.closureOf(dialog);
   if (closure !== null)
      return closure === "ok";
   // An OK that refuses the settings says why in a message. A button that keeps the dialog open
   // otherwise did its work in it, and the user closes the dialog next, with its own Cancel or Close
   // button, whose handler decides how. Without one the dialog is accepted, as the Exit and Close
   // buttons that end such dialogs usually do.
   if (!settings.button && run.messages.length > messagesBefore)
      throw new Error("Dialog '" + record.title + "' stayed open after OK, so its handler refused the settings, see the messages");
   record.stayedOpen = true;
   if (clickCancel(entries)) {
      closure = engine.closureOf(dialog);
      if (closure !== null)
         return closure === "ok";
   }
   return true;
}

// The engine for a run, driving each dialog the script opens. A failure is recorded and the dialog
// rejected, so the script ends the way it does when a user cancels.
function scriptEngine(run, onV8) {
   var engine = null;
   function handleDialog(dialog) {
      try {
         return driveDialog(run, engine, dialog);
      } catch (error) {
         recordFailure(run, error);
         return false;
      }
   }
   engine = onV8 ? v8ScriptEngine(run.output, handleDialog) : legacyScriptEngine(run.output, handleDialog);
   return engine;
}

// A script's dialogs and controls live until collected, and meanwhile their controls still react to
// PixInsight, a view list to an image closing, calling into the finished script. Enough of them left
// over from earlier runs makes PixInsight read freed memory, so a run's objects are collected while
// its context still exists.
function collectScriptObjects() {
   processEvents();
   if (typeof gc === "function")
      gc(true);
   processEvents();
}

function openWindowIds() {
   return ImageWindow.windows.map(function (window) { return window.mainView.id; });
}

// Messages in order, a run of the same message shown once with its count.
function collapsedMessages(messages) {
   var collapsed = [];
   messages.forEach(function (message, index) {
      if (index > 0 && message === messages[index - 1])
         collapsed[collapsed.length - 1].count++;
      else
         collapsed.push({ message: message, count: 1 });
   });
   return collapsed.map(function (entry) { return entry.count > 1 ? entry.message + " (x" + entry.count + ")" : entry.message; });
}

// The messages and last console lines, appended to an error.
function runContext(run) {
   var context = "";
   if (run.messages.length)
      context += "\nMessages: " + collapsedMessages(run.messages).join(" | ");
   var lines = run.output.slice(-5).map(cleanLabel).filter(function (line) { return line !== ""; });
   if (lines.length)
      context += "\nLast console lines: " + lines.join(" | ");
   return context;
}

// The dialogs settings were given for that the script never opened, numbered from 1.
function unopenedDialogs(run) {
   var unopened = [];
   run.dialogSettings.forEach(function (settings, index) {
      var given = Object.keys(settings.controls || {}).length > 0 || Boolean(settings.button);
      if (given && index >= run.dialogs.length)
         unopened.push(index + 1);
   });
   return unopened;
}

function handleRunScript(command) {
   var parameters = command.parameters;
   var filePath = parameters.filePath;
   var included = GLOBAL_SCOPE.runIncludedScript;
   if (typeof included !== "function" || !(included.shadowedNames instanceof Array))
      throw new Error("run_script needs the driver that includes " + filePath);
   var view = command.targetView ? requireView(command.targetView) : null;
   var run = {
      inspect: parameters.inspect === true, dialogSettings: parameters.dialogs || [],
      answers: parameters.answers || {}, usedAnswers: {},
      dialogs: [], openedDialogs: [], messages: [], output: [], failure: null
   };

   var onV8 = isV8Engine();
   var scope = sandboxScope(run, view, parameters.parameters || {});
   var engine = scriptEngine(run, onV8);
   Object.keys(engine.scope).forEach(function (name) { scope[name] = engine.scope[name]; });
   var unshadowed = Object.keys(scope).filter(function (name) { return included.shadowedNames.indexOf(name) < 0; });
   if (unshadowed.length) {
      engine.restore();
      throw new Error("The script driver does not shadow " + unshadowed.join(", "));
   }

   var windowsBefore = openWindowIds();
   var historyBefore = view ? view.historyIndex : null;
   if (view)
      view.window.bringToFront();
   var started = Date.now();
   try {
      included.apply(GLOBAL_SCOPE, included.shadowedNames.map(function (name) {
         return Object.prototype.hasOwnProperty.call(scope, name) ? scope[name] : GLOBAL_SCOPE[name];
      }));
   } catch (error) {
      recordFailure(run, error);
   } finally {
      engine.restore();
      // The run's own references to the script's objects go first, or they survive the collection.
      scope = null;
      run.openedDialogs.length = 0;
      collectScriptObjects();
   }
   var milliseconds = Date.now() - started;

   var unopened = run.inspect ? [] : unopenedDialogs(run);
   if (!run.failure && unopened.length)
      run.failure = "The script opened " + run.dialogs.length + " dialog(s), so the settings for dialog " +
                    unopened.join(", ") + " were never applied";
   if (run.failure)
      throw new Error(run.failure + runContext(run));

   var outputs = {
      filePath: filePath, engine: onV8 ? "v8" : "legacy", inspect: run.inspect, milliseconds: milliseconds,
      historyBefore: historyBefore, historyAfter: view !== null && !view.isNull ? view.historyIndex : null,
      newWindows: openWindowIds().filter(function (id) { return windowsBefore.indexOf(id) < 0; }),
      dialogs: run.dialogs, messages: run.messages, output: run.output.slice(-OUTPUT_LINES),
      unusedAnswers: Object.keys(run.answers).filter(function (key) { return !run.usedAnswers[key]; })
   };
   return success(outputs, File.extractName(filePath) + (run.inspect ? " inspected" : " ran") + (view ? " on " + view.id : ""));
}
