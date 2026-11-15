// Process history: position, full step list, undo, redo, and snapshots.
//
// Scripted executeOn calls build the same undoable history as the GUI, and ImageWindow.undo(),
// redo(), view.historyIndex and view.canGoBackward all work from PJSR and persist across bridge
// commands. ImageWindow has no canUndo property, view.canGoBackward is the signal.

// Longest settings line kept in get_full_history, and the length it is cut to.
var MAX_SETTINGS_LINE = 200;
var TRUNCATED_SETTINGS_LINE = 160;

function historyState(view) {
   return { historyIndex: view.historyIndex, canUndo: view.canGoBackward, canRedo: view.canGoForward };
}

function handleGetHistory(command) {
   var view = requireView(command.parameters.viewId).window.mainView;
   var state = historyState(view);
   return success(state, view.id + " history: index=" + state.historyIndex);
}

function containerProcessIds(container) {
   var ids = [];
   for (var index = 0; index < container.length; ++index)
      ids.push(container.at(index).processId());
   return ids;
}

// The `P.<parameter> = ...` lines of a process's source, without the pixel, path and comment
// data some processes carry (ImageIntegration's file list alone can be 80 KB).
function settingsLines(instance, limit) {
   var lines = String(instance.toSource()).split("\n");
   var kept = [];
   for (var index = 0; index < lines.length; ++index) {
      var line = lines[index].replace(/^\s+/, "");
      if (line.indexOf("P.") !== 0 && line.indexOf("P[") !== 0)
         continue;
      if (kept.length >= limit) {
         kept.push("... (truncated, " + lines.length + " source lines)");
         break;
      }
      if (line.length > MAX_SETTINGS_LINE)
         line = line.substring(0, TRUNCATED_SETTINGS_LINE) + " ...";
      kept.push(line);
   }
   return kept;
}

// view.processing is the cumulative container of every history step, entry N being state N+1,
// and view.initialProcessing is the base state 0. The whole history reads out of these two
// objects with no navigation and no pixel change. PixInsight prunes the redo branch when a
// process runs after an undo, so the container holds exactly the steps the GUI shows, and
// those past historyIndex are redoable.
function handleGetFullHistory(command) {
   var view = requireView(command.parameters.viewId).window.mainView;
   var limit = command.parameters.maxParamLines;
   var current = view.historyIndex;

   // The base is usually the integration container, whose source is too large to list, so only
   // its inner process names are reported.
   var base = view.initialProcessing;
   var baseId = base ? base.processId() : "(none)";
   var steps = [{
      index: 0,
      processId: baseId,
      inner: baseId === "ProcessContainer" ? containerProcessIds(base) : null,
      settings: [],
      applied: true,
      current: current === 0
   }];

   var container = view.processing;
   var stepCount = container ? container.length : 0;
   for (var index = 0; index < stepCount; ++index) {
      var instance = container.at(index);
      var processId = instance.processId();
      var state = index + 1;
      steps.push({
         index: state,
         processId: processId,
         inner: processId === "ProcessContainer" ? containerProcessIds(instance) : null,
         settings: settingsLines(instance, limit),
         applied: state <= current,
         current: state === current
      });
   }

   var outputs = historyState(view);
   outputs.stepCount = stepCount;
   outputs.steps = steps;
   return success(outputs, view.id + ": " + stepCount + " step(s) after the base");
}

// Walks the history up to `steps` times while `canMove` holds, returns how many moves happened.
function walkHistory(steps, canMove, move) {
   var moved = 0;
   while (moved < steps && canMove()) {
      move();
      ++moved;
   }
   return moved;
}

function handleUndo(command) {
   var window = requireView(command.parameters.viewId).window;
   var view = window.mainView;
   var undone = walkHistory(command.parameters.steps,
                            function () { return view.canGoBackward; },
                            function () { window.undo(); });
   var outputs = historyState(view);
   outputs.undone = undone;
   return success(outputs, "Undid " + undone + " step(s) on " + view.id);
}

function handleRedo(command) {
   var window = requireView(command.parameters.viewId).window;
   var view = window.mainView;
   var redone = walkHistory(command.parameters.steps,
                            function () { return view.canGoForward; },
                            function () { window.redo(); });
   var outputs = historyState(view);
   outputs.redone = redone;
   return success(outputs, "Redid " + redone + " step(s) on " + view.id);
}

// A snapshot is a hidden window holding a copy of the pixels, findable by id and kept out of
// the workspace. Taking one again replaces it, which closes the window that has the id, so an
// id that names a visible window, or the view itself, is refused: that window is an image.
function handleSnapshot(command) {
   var view = requireView(command.parameters.viewId).window.mainView;
   var snapshotId = command.parameters.snapshotId || view.id + "_snap";
   var source = view.image;
   var existing = ImageWindow.windowById(snapshotId);
   if (snapshotId === view.id)
      throw new Error("A snapshot of " + view.id + " needs an id of its own");
   if (!existing.isNull) {
      if (existing.visible)
         throw new Error(snapshotId + " is an open image, not a snapshot, pick another snapshotId");
      existing.forceClose();
   }
   var snapshot = new ImageWindow(source.width, source.height, source.numberOfChannels,
                                  source.bitsPerSample, source.isReal, source.isColor, snapshotId);
   snapshot.mainView.beginProcess();
   snapshot.mainView.image.assign(source);
   snapshot.mainView.endProcess();
   // The id the window got, which is the one restore finds it by.
   var takenId = snapshot.mainView.id;
   return success({ snapshotId: takenId, width: source.width, height: source.height,
                    channels: source.numberOfChannels },
                  "Snapshot " + takenId + " taken from " + view.id);
}

function handleRestore(command) {
   var view = requireView(command.parameters.viewId).window.mainView;
   var snapshotId = command.parameters.snapshotId;
   var snapshot = ImageWindow.windowById(snapshotId);
   if (snapshot.isNull)
      throw new Error("Snapshot not found: " + snapshotId);
   var target = view.image;
   var source = snapshot.mainView.image;
   if (target.width !== source.width || target.height !== source.height ||
       target.numberOfChannels !== source.numberOfChannels)
      throw new Error("Geometry mismatch: target " + target.width + "x" + target.height + "x" +
                      target.numberOfChannels + " vs snapshot " + source.width + "x" + source.height +
                      "x" + source.numberOfChannels);
   // beginProcess and endProcess make the restore an undoable history step.
   view.beginProcess();
   try {
      view.image.assign(source);
   } finally {
      view.endProcess();
   }
   return success({ restored: true, historyIndex: view.historyIndex },
                  "Restored " + view.id + " from snapshot " + snapshotId);
}
