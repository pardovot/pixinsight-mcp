// run_script: runs an installed PixInsight script with no user interaction, through the script's own
// code. The driver (src/bridge/client.ts) includes the script inside runIncludedScript, whose
// parameters shadow the globals listed in its shadowedNames. This file builds the run and the sandbox,
// a script engine (pjsr/script-engines.js) takes over the dialogs and the console, and
// pjsr/script-controls.js fills the dialogs in.

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

// V8 installs native methods on each instance as read only own properties, the legacy engine keeps
// them on the prototype. Scripts without #engine v8 run on the legacy engine.
function isV8Engine() {
   return Object.prototype.hasOwnProperty.call(new Timer(), "start");
}

// The Parameters a script instance dropped on the view would see, with the given values.
function scriptParameters(view, values) {
   var stored = {};
   Object.keys(values).forEach(function (name) { stored[name] = values[name]; });
   return {
      isViewTarget: view !== null, isGlobalTarget: view === null, targetView: view,
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
   var scope = { Parameters: scriptParameters(view, parameterValues) };
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
         } catch (error) {
            run.failure = run.failure || errorText(error);
            throw error;
         }
         run.messages.push(message + " [" + messageButtonName(answer) + "]");
         return answer;
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
      dialogs: [], messages: [], output: [], failure: null
   };

   var onV8 = isV8Engine();
   var scope = sandboxScope(run, view, parameters.parameters || {});
   var engine = onV8 ? v8ScriptEngine(run) : legacyScriptEngine(run);
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
      run.failure = run.failure || errorText(error);
   } finally {
      engine.restore();
      scope = null;
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
