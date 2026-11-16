// How a run_script run takes over a script's dialogs and console on each engine. A script engine is
// { scope, forgetClosure, closureOf, restore }: the substitutes it adds to the script's scope, how a
// dialog's closing by a handler is told, and the function that undoes what it changed.

// StdDialogCode_Ok and StdDialogCode_Cancel, which the legacy engine defines only through includes.
var DIALOG_ACCEPTED = 1;
var DIALOG_REJECTED = 0;
// A dialog's own OK button: labelled OK, or kept as ok_Button or okButton.
var OK_LABEL = /^ok$/i;
var OK_NAME = /(^|\.)ok_?button$/i;
var CONSOLE_WRITERS = ["writeln", "write", "warningln", "criticalln", "noteln"];
// How often a V8 dialog is checked, in seconds, and on how many checks in a row it must be open before
// it is driven: a dialog closed while execute() is still showing it stays modal and invisible.
var V8_POLL_SECONDS = 0.05;
var V8_OPEN_POLLS = 2;
// Checks a closed V8 dialog may stay hidden, while its run goes on, before it is closed again.
var V8_RECLOSE_POLLS = 20;

function errorText(error) {
   return String(error.message || error);
}

// The named button, or else the dialog's own OK button. Null for none.
function dialogButton(entries, name) {
   var buttons = entries.filter(function (entry) { return entry.kind.kind === "button"; });
   if (name)
      return matchControls(buttons, name)[0] || null;
   return buttons.filter(function (entry) { return OK_LABEL.test(entry.label) || OK_NAME.test(entry.name); })[0] || null;
}

// Records a dialog and, unless inspecting, applies its entry of run.dialogSettings: the controls are
// set, then the named button is clicked, or else the dialog's own OK button, whose handler may read the
// controls. Returns whether the dialog is to be accepted. Every requested control and button must be
// in the dialog, so a misspelled name never runs the script on its defaults.
function driveDialog(run, engine, dialog) {
   if (run.dialogs.length >= MAX_DIALOGS)
      throw new Error("The script opened its dialog " + MAX_DIALOGS + " times" + ASKS_AGAIN);
   var settings = run.dialogSettings[run.dialogs.length] || {};
   var controls = settings.controls || {};
   var entries = dialogControls(dialog);
   var record = { title: String(dialog.windowTitle), controls: entries.map(describeControl) };
   run.dialogs.push(record);
   if (run.inspect)
      return false;

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
   clickButton(button);
   record.clicked = button.label || button.name;
   var closure = engine.closureOf(dialog);
   if (closure !== null)
      return closure === "ok";
   if (!settings.button)
      throw new Error("Dialog '" + record.title + "' stayed open after OK, so its handler refused the settings, see the messages");
   return true;
}

// The legacy engine resolves native methods through prototypes and lets them be replaced, but hides
// console's members from enumeration. Patching Dialog.prototype.execute covers every dialog, which is
// never shown: ok, cancel and done only record how a handler closed it. console's write methods are
// patched in place.
function legacyScriptEngine(run) {
   var patches = [];
   // Each patch keeps the member it replaced, so a stale one left by a run cut short is unwrapped
   // to that member first.
   function patch(owner, name, replacement) {
      var original = owner[name];
      while (typeof original === "function" && original.scriptRunOriginal !== undefined)
         original = original.scriptRunOriginal;
      replacement.scriptRunOriginal = original;
      owner[name] = replacement;
      patches.push({ owner: owner, name: name, original: original });
      return original;
   }

   var engine = {
      scope: {},
      forgetClosure: function (dialog) { dialog.scriptRunClosure = null; },
      closureOf: function (dialog) { return dialog.scriptRunClosure || null; },
      restore: function () {
         patches.forEach(function (entry) { entry.owner[entry.name] = entry.original; });
      }
   };
   patch(Dialog.prototype, "execute", function () {
      try {
         return driveDialog(run, engine, this) ? DIALOG_ACCEPTED : DIALOG_REJECTED;
      } catch (error) {
         run.failure = run.failure || errorText(error);
         return DIALOG_REJECTED;
      }
   });
   patch(Dialog.prototype, "ok", function () { this.scriptRunClosure = "ok"; });
   patch(Dialog.prototype, "cancel", function () { this.scriptRunClosure = "cancel"; });
   patch(Dialog.prototype, "done", function (code) { this.scriptRunClosure = code === DIALOG_ACCEPTED ? "ok" : "cancel"; });
   CONSOLE_WRITERS.forEach(function (name) {
      var original = patch(console, name, function () {
         run.output.push(Array.prototype.join.call(arguments, ""));
         return original.apply(console, arguments);
      });
   });
   patch(console, "show", function () {});
   return engine;
}

// V8 installs most of console's members as read only own properties, so a plain object forwards each
// one, own or inherited (hide is inherited), to the real console and records what the write methods
// print.
function recordingConsole(run) {
   var recording = {};
   var names = Object.getOwnPropertyNames(console);
   for (var proto = Object.getPrototypeOf(console); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto))
      Object.getOwnPropertyNames(proto).forEach(function (name) {
         if (name !== "constructor" && names.indexOf(name) < 0)
            names.push(name);
      });
   names.forEach(function (name) {
      var member = console[name];
      if (name === "show") {
         recording.show = function () {};
      } else if (typeof member === "function" && CONSOLE_WRITERS.indexOf(name) >= 0) {
         recording[name] = function () {
            run.output.push(Array.prototype.join.call(arguments, ""));
            return member.apply(console, arguments);
         };
      } else if (typeof member === "function") {
         recording[name] = member.bind(console);
      } else {
         Object.defineProperty(recording, name, {
            get: function () { return console[name]; },
            set: function (value) { console[name] = value; },
            enumerable: true
         });
      }
   });
   return recording;
}

// On V8 a native class can only be built with new and its methods cannot be replaced, so the Dialog
// substitute builds the real dialog and a timer drives it once it is open, then closes it, each time
// the script opens it. A close that still lands while execute() is showing the dialog leaves
// PixInsight waiting on a hidden one, so a dialog that stays hidden while its run goes on is closed
// once more. The run never adds an event handler the script did not set: PixInsight keeps such a
// handler connected after the run, and calls into the finished script. It only wraps the script's own
// onShow, which may run processes that let the timer run while show() is still going, so a dialog
// with one counts as open once it has returned.
function v8ScriptEngine(run) {
   var timers = [];
   var engine = {
      scope: { console: recordingConsole(run) },
      forgetClosure: function () {},
      // V8 tells that a handler closed a dialog, not how.
      closureOf: function (dialog) { return dialog.visible ? null : "ok"; },
      // A tick already queued is still delivered after stop, so the handlers are emptied and the
      // queue delivered while the run's context still exists.
      restore: function () {
         timers.forEach(function (timer) {
            timer.stop();
            timer.onTimeout = function () {};
         });
         timers.length = 0;
         processEvents();
      }
   };

   // Called with new or through super(), where this.constructor is the script's own dialog class.
   var HeadlessDialog = function () {
      var dialog = Reflect.construct(Dialog, arguments, this.constructor);
      // closing: the run has closed the dialog for this opening. hiddenPolls counts the checks it has
      // stayed hidden since, reclosed tells that it was closed once more.
      var openPolls = 0, hiddenPolls = 0, closing = false, reclosed = false, busy = false, accept = false;
      var showReturned = false;
      function watchShow() {
         var handler = dialog.onShow;
         if (typeof handler !== "function" || handler.scriptRunWatched)
            return;
         var watched = function () {
            try {
               return handler.apply(this, arguments);
            } finally {
               showReturned = true;
            }
         };
         watched.scriptRunWatched = true;
         dialog.onShow = watched;
      }
      function close() {
         if (accept) dialog.ok();
         else dialog.cancel();
      }
      function drive() {
         closing = true;
         reclosed = false;
         hiddenPolls = 0;
         showReturned = false;
         accept = false;
         busy = true;
         try {
            accept = driveDialog(run, engine, dialog);
         } catch (error) {
            run.failure = run.failure || errorText(error);
         } finally {
            busy = false;
         }
      }

      var timer = new Timer();
      timer.interval = V8_POLL_SECONDS;
      timer.periodic = true;
      timer.onTimeout = function () {
         // Driving clicks a button whose work may run this check again before it returns.
         if (busy)
            return;
         if (!dialog.visible) {
            openPolls = 0;
            if (!closing)
               watchShow();
            else if (!reclosed && ++hiddenPolls >= V8_RECLOSE_POLLS) {
               reclosed = true;
               close();
            }
            return;
         }
         // Visible again after the run closed it: the script opened the dialog once more.
         if (closing && hiddenPolls > 0)
            closing = false;
         if (!closing) {
            var showPending = typeof dialog.onShow === "function" && dialog.onShow.scriptRunWatched && !showReturned;
            if (showPending || ++openPolls < V8_OPEN_POLLS)
               return;
            drive();
         }
         if (dialog.visible)
            close();
      };
      timer.start();
      timers.push(timer);
      return dialog;
   };
   HeadlessDialog.prototype = Dialog.prototype;
   // Static members, such as Dialog.browseScriptDocumentation, stay reachable.
   Object.setPrototypeOf(HeadlessDialog, Dialog);
   engine.scope.Dialog = HeadlessDialog;
   return engine;
}
