// How a run_script run takes over a script's dialogs and console on each engine. An engine is built
// from the array that collects console output and handleDialog(dialog), which drives a dialog the
// script opens, returns whether to accept it and never throws. It is { scope, forgetClosure, closureOf,
// restore }: the substitutes it adds to the script's scope, how a dialog's closing by a handler is
// told, and the function that undoes what it changed.

// StdDialogCode_Ok and StdDialogCode_Cancel, which the legacy engine defines only through includes.
var DIALOG_ACCEPTED = 1;
var DIALOG_REJECTED = 0;
var CONSOLE_WRITERS = ["writeln", "write", "warningln", "criticalln", "noteln"];
// How often a V8 dialog is checked, in seconds, and on how many checks in a row it must be open before
// it is driven: a dialog closed while execute() is still showing it stays modal and invisible.
var V8_POLL_SECONDS = 0.05;
var V8_OPEN_POLLS = 2;
// Checks a closed V8 dialog may stay hidden, while its run goes on, before it is closed again.
var V8_RECLOSE_POLLS = 20;
// Checks a driven V8 dialog left open stays open before it is closed: work its handlers queued on the
// script's own timers runs first, since a close before it leaves PixInsight waiting on the hidden
// dialog, as AstroContrastEnhancer's preview refresh after Apply does.
var V8_SETTLE_POLLS = 10;

// The legacy engine resolves native methods through prototypes and lets them be replaced, but hides
// console's members from enumeration. Patching Dialog.prototype.execute covers every dialog, which is
// never shown: ok, cancel and done only record how a handler closed it. console's write methods are
// patched in place.
function legacyScriptEngine(output, handleDialog) {
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
   // Some scripts read the dialog's result rather than what execute returns.
   patch(Dialog.prototype, "execute", function () {
      this.result = handleDialog(this) ? DIALOG_ACCEPTED : DIALOG_REJECTED;
      return this.result;
   });
   patch(Dialog.prototype, "ok", function () { this.scriptRunClosure = "ok"; });
   patch(Dialog.prototype, "cancel", function () { this.scriptRunClosure = "cancel"; });
   patch(Dialog.prototype, "done", function (code) { this.scriptRunClosure = code === DIALOG_ACCEPTED ? "ok" : "cancel"; });
   CONSOLE_WRITERS.forEach(function (name) {
      var original = patch(console, name, function () {
         output.push(Array.prototype.join.call(arguments, ""));
         return original.apply(console, arguments);
      });
   });
   patch(console, "show", function () {});
   return engine;
}

// A plain object standing in for a native one whose members cannot be replaced, as on V8, which
// installs them as read only own properties that not even a Proxy may change. Each member, own or
// inherited, forwards to the native object, a method called on it and a property read and written
// there, except those replace(name, member) returns a substitute for.
function forwardingObject(target, replace) {
   var forwarding = {};
   var names = Object.getOwnPropertyNames(target);
   var prototype = Object.getPrototypeOf(target);
   while (prototype && prototype !== Object.prototype) {
      Object.getOwnPropertyNames(prototype).forEach(function (name) {
         if (name !== "constructor" && names.indexOf(name) < 0)
            names.push(name);
      });
      prototype = Object.getPrototypeOf(prototype);
   }
   names.forEach(function (name) {
      var member = target[name];
      var substitute = replace(name, member);
      if (substitute !== undefined) {
         forwarding[name] = substitute;
      } else if (typeof member === "function") {
         forwarding[name] = member.bind(target);
      } else {
         Object.defineProperty(forwarding, name, {
            get: function () { return target[name]; },
            set: function (value) { target[name] = value; },
            enumerable: true
         });
      }
   });
   return forwarding;
}

// The V8 console, recording what the write methods print (hide is inherited, so it forwards too).
function recordingConsole(output) {
   return forwardingObject(console, function (name, member) {
      if (name === "show")
         return function () {};
      if (typeof member === "function" && CONSOLE_WRITERS.indexOf(name) >= 0)
         return function () {
            output.push(Array.prototype.join.call(arguments, ""));
            return member.apply(console, arguments);
         };
      return undefined;
   });
}

// On V8 a native class can only be built with new and its methods cannot be replaced, so the Dialog
// substitute builds the real dialog and a timer drives it once it is open, then closes it once it
// settles, each time the script opens it. A close that still lands while execute() is showing the
// dialog leaves PixInsight waiting on a hidden one, so a dialog that stays hidden while its run goes
// on is closed once more. The run never adds an event handler the script did not set: PixInsight
// keeps such a handler connected after the run, and calls into the finished script. It only wraps
// the script's own onShow, which may run processes that let the timer run while show() is still
// going, so a dialog with one counts as open once it has returned.
function v8ScriptEngine(output, handleDialog) {
   var timers = [];
   var engine = {
      scope: { console: recordingConsole(output) },
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
      var showReturned = false, settlePolls = 0;
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
            accept = handleDialog(dialog);
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
            settlePolls = V8_SETTLE_POLLS;
         }
         if (dialog.visible && --settlePolls <= 0)
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
