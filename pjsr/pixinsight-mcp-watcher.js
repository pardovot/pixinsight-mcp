// PixInsight MCP Watcher Script
// Runs inside PixInsight's PJSR engine (V8 runtime, PixInsight 1.9.4+)
// Polls the bridge directory for commands, executes them, writes results.

#engine v8

#feature-id    PixInsightMCPWatcher : PixInsight MCP > Start Watcher
#feature-info  Starts the PixInsight MCP bridge watcher. Polls \
   ~/.pixinsight-mcp/bridge for commands issued by AI assistants \
   (via the MCP server) and executes them inside PixInsight. \
   Leave running during an MCP session.

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

// ============================================================================
// Plate solving DISABLED in the V8 port (Bloco 2, Option A)
// ----------------------------------------------------------------------------
// The AdP/ImageSolver library and its 6 AdP dependency includes were removed,
// together with the defines that only fed the solver (USE_SOLVER_LIBRARY,
// SETTINGS_MODULE, SETTINGS_MODULE_SCRIPT, TITLE, STAR_CSV_FILE and
// __PJSR_USE_STAR_DETECTOR_V2). Reasons: the installed AdP/ImageSolver.js 6.3.1
// is not V8-compatible (duplicate `let toolTip`, a V8 SyntaxError) and no
// watcher handler used the solver anyway. See TODO-v8-port.md for the
// end-to-end fix (watcher + Node) before re-enabling plate solving.
// ============================================================================

// ============================================================================
// Configuration
// ============================================================================

var BRIDGE_DIR = File.homeDirectory + "/.pixinsight-mcp/bridge";
var COMMANDS_DIR = BRIDGE_DIR + "/commands";
var RESULTS_DIR = BRIDGE_DIR + "/results";
var LOGS_DIR = BRIDGE_DIR + "/logs";
// Effective idle poll cadence: the main loop sleeps 25 x 20 ms between
// directory checks (see runWatcher). This constant is informational (banner).
var POLL_INTERVAL_MS = 500;
// Version of this standalone JS watcher (dev fallback channel). The native
// module has its own version in module/src/Version.h; the MCP server reports
// package.json's. They ship independently and are versioned independently.
var WATCHER_VERSION = "0.1.0";

// ============================================================================
// File Helpers (PJSR File API)
// ============================================================================

function readTextFile(path) {
   var lines = File.readLines(path);
   return lines.join("\n");
}

function writeTextFile(path, text) {
   File.writeTextFile(path, text);
}

function deleteFile(path) {
   if (File.exists(path)) {
      File.remove(path);
   }
}

function ensureDirectory(path) {
   if (!File.directoryExists(path)) {
      File.createDirectory(path, true);
   }
}

function listJsonFiles(dirPattern) {
   try {
      return File.searchDirectory(dirPattern);
   } catch (e) {
      return [];
   }
}

function getTimestamp() {
   var d = new Date();
   return d.toISOString();
}

//__MCP_HANDLERS_BEGIN__ (do not remove: marks the block embedded into the native module)
// ============================================================================
// Command Handlers
// ============================================================================

// Bump on ANY behavioral handler change. Every success result echoes it as
// outputs.handlersRev so the MCP server detects an outdated installed module
// generically (client.ts EXPECTED_HANDLERS_REV must match; the drift test
// enforces equality). Per-feature markers (save_image outputs.hints) remain
// for gaps that must hard-error.
var HANDLERS_REVISION = 1;

function handleListOpenImages(command) {
   var windows = ImageWindow.windows;
   var images = [];
   for (var i = 0; i < windows.length; ++i) {
      var w = windows[i];
      var v = w.mainView;
      var img = v.image;
      images.push({
         id: v.id,
         filePath: w.filePath || null,
         width: img.width,
         height: img.height,
         channels: img.numberOfChannels,
         isColor: img.isColor,
         bitDepth: img.bitsPerSample
      });
   }
   return {
      status: "success",
      outputs: { images: images },
      message: "Found " + images.length + " open image(s)"
   };
}

function handleOpenImage(command) {
   var filePath = command.parameters.filePath;
   if (!File.exists(filePath)) {
      throw new Error("File not found: " + filePath);
   }
   var windows = ImageWindow.open(filePath);
   if (windows.length === 0) {
      throw new Error("Failed to open image: " + filePath);
   }
   var w = windows[0];
   w.show();
   var v = w.mainView;
   var img = v.image;
   return {
      status: "success",
      outputs: {
         id: v.id,
         width: img.width,
         height: img.height,
         channels: img.numberOfChannels
      },
      message: "Opened " + v.id
   };
}

function handleSaveImage(command) {
   var viewId = command.parameters.viewId;
   var filePath = command.parameters.filePath;
   var overwrite = command.parameters.overwrite || false;
   // Default compressed. On a 6159x7396 float RGB master: 521.7 MB -> 384.2 MB.
   var compression = command.parameters.compression || "zlib+sh";
   // Same list the MCP tool's enum enforces; direct bridge callers get a clean
   // rejection instead of writer-defined behavior on a typo.
   var validCodecs = ["zlib", "zlib+sh", "zstd", "zstd+sh", "lz4", "lz4+sh", "lz4hc", "lz4hc+sh", "none"];
   if (validCodecs.indexOf(compression) < 0)
      throw new Error("Unknown compression codec: " + compression + " (valid: " + validCodecs.join(", ") + ")");

   var window = findWindowByViewId(viewId);
   if (!window) {
      throw new Error("Image not found: " + viewId);
   }
   if (File.exists(filePath) && !overwrite) {
      throw new Error("File already exists (set overwrite=true): " + filePath);
   }

   // ALWAYS pass an explicit codec for XISF. An empty hints string means "format defaults",
   // and those defaults are SESSION-MUTABLE: one saveAs with a codec hint changes them, so a
   // later empty-hint save silently inherits it (probed live: the same image wrote 16.95 MB
   // with "", then 12.07 MB with "" after a single zlib+sh save). Explicit hints are what make
   // written file sizes reproducible. Non-XISF writers reject an unknown codec hint, so gate it.
   var isXisf = /\.xisf$/i.test(filePath);
   var hints = isXisf ? ("compression-codec " + compression) : "";
   window.saveAs(filePath, false, false, false, false, hints);

   // File.size() does NOT exist in PJSR; FileInfo carries the size.
   var bytes = -1;
   try { bytes = new FileInfo(filePath).size; } catch (e) {}

   return {
      status: "success",
      // `hints` is also the CAPABILITY MARKER the MCP server checks: if it is absent, the
      // installed module predates compression support and the server must say so loudly
      // rather than silently writing uncompressed files.
      outputs: { filePath: filePath, hints: hints, bytes: bytes },
      message: "Saved " + viewId + " to " + filePath
   };
}

function handleCloseImage(command) {
   var viewId = command.parameters.viewId;
   var window = findWindowByViewId(viewId);
   if (!window) {
      throw new Error("Image not found: " + viewId);
   }
   window.forceClose();
   return {
      status: "success",
      outputs: {},
      message: "Closed " + viewId
   };
}

function handleGetImageStatistics(command) {
   var viewId = command.parameters.viewId;
   var window = findWindowByViewId(viewId);
   if (!window) {
      throw new Error("Image not found: " + viewId);
   }
   var img = window.mainView.image;
   var stats = [];
   var channelNames = img.isColor ? ["Red", "Green", "Blue"] : ["Gray"];

   for (var c = 0; c < img.numberOfChannels; ++c) {
      img.selectedChannel = c;
      stats.push({
         channel: c,
         channelName: c < channelNames.length ? channelNames[c] : "Channel_" + c,
         mean: img.mean(),
         median: img.median(),
         stdDev: img.stdDev(),
         min: img.minimum(),
         max: img.maximum()
      });
   }
   img.resetSelections();

   return {
      status: "success",
      outputs: { statistics: stats },
      message: "Statistics for " + viewId + " (" + stats.length + " channel(s))"
   };
}

// ============================================================================
// Process Execution Handlers
// ============================================================================

function handleRunPixelMath(command) {
   var P = new PixelMath;
   P.expression = command.parameters.expression || "";
   P.expression1 = command.parameters.expression1 || "";
   P.expression2 = command.parameters.expression2 || "";
   P.useSingleExpression = command.parameters.useSingleExpression !== false;
   P.createNewImage = command.parameters.createNewImage || false;
   if (command.parameters.newImageId) {
      P.newImageId = command.parameters.newImageId;
   }

   if (command.targetView) {
      var view = findViewById(command.targetView);
      if (!view) throw new Error("View not found: " + command.targetView);
      P.executeOn(view);
   } else {
      P.executeGlobal();
   }
   return {
      status: "success",
      outputs: {},
      message: "PixelMath executed: " + command.parameters.expression
   };
}

// ============================================================================
// Generic process runner, run ANY PixInsight process by name.
// This is the primary mechanism (legacy per-process wrappers were removed
// 2026-07-22; use run_process, or run_script for anything exotic).
// ============================================================================

function instantiateProcess(processId) {
   if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(processId || "")) {
      throw new Error("Invalid process id: " + processId);
   }
   var P;
   try {
      P = eval("new " + processId + ";");
   } catch (e) {
      throw new Error("Unknown process: " + processId + " (" + e.message + ")");
   }
   return P;
}

function handleRunProcess(command) {
   var p = command.parameters || {};
   var processId = p.processId || command.process;
   var P = instantiateProcess(processId);

   // Apply settings: { paramName: value, ... } assigned directly on the instance.
   // Reject unknown names, a typo would otherwise create a plain JS property,
   // run the process with defaults, and still report the setting as applied.
   var known = {};
   for (var q in P) if (typeof P[q] !== "function") known[q] = true;   // same filter as handleGetProcessParameters, else executeOn etc. would pass validation
   var settings = p.settings || {};
   var applied = [];
   for (var k in settings) {
      if (settings.hasOwnProperty(k)) {
         if (!known.hasOwnProperty(k))
            throw new Error("Unknown parameter '" + k + "' for " + processId +
                            ", check get_process_parameters(\"" + processId + "\")");
         P[k] = settings[k];
         applied.push(k);
      }
   }

   if (command.targetView) {
      var view = findViewById(command.targetView);
      if (!view) throw new Error("View not found: " + command.targetView);
      P.executeOn(view);
      return {
         status: "success",
         outputs: { processId: processId, applied: applied },
         message: processId + " executed on " + command.targetView +
                  (applied.length ? " [" + applied.join(", ") + "]" : " (defaults)")
      };
   } else {
      P.executeGlobal();
      return {
         status: "success",
         outputs: { processId: processId, applied: applied },
         message: processId + " executed globally" +
                  (applied.length ? " [" + applied.join(", ") + "]" : " (defaults)")
      };
   }
}

function handleGetProcessParameters(command) {
   var p = command.parameters || {};
   var processId = p.processId;
   var P = instantiateProcess(processId);
   var params = {};
   for (var k in P) {
      if (typeof P[k] !== "function") {
         params[k] = P[k];   // name -> default value
      }
   }
   return {
      status: "success",
      outputs: { processId: processId, parameters: params },
      message: processId + ": " + Object.keys(params).length + " parameter(s)"
   };
}

function handleRunScript(command) {
   var code = command.parameters.code;
   try {
      // returnValue is the script's final expression value (String(eval(code))),
      // NOT captured console output.
      var result = eval(code);
      return {
         status: "success",
         outputs: { returnValue: String(result !== undefined ? result : "Script executed.") },
         message: "Script executed successfully"
      };
   } catch (e) {
      throw new Error("Script error: " + e.message);
   }
}

// ============================================================================
// Session / process-history: revert + checkpoint
// ----------------------------------------------------------------------------
// Scripted executeOn accumulates an undoable process history; ImageWindow.undo()
// / redo() / go() and view.historyIndex / view.canGoBackward all work here and
// persist across bridge commands. (The old "canUndo=false" was a misdiagnosis:
// canUndo is not an ImageWindow property, the real signal is view.canGoBackward.)
// ============================================================================

function handleGetHistory(command) {
   var viewId = command.parameters.viewId;
   var w = findWindowByViewId(viewId);
   if (!w) throw new Error("Image not found: " + viewId);
   var v = w.mainView;
   return {
      status: "success",
      outputs: { historyIndex: v.historyIndex, canUndo: v.canGoBackward, canRedo: v.canGoForward },
      message: viewId + " history: index=" + v.historyIndex + " canUndo=" + v.canGoBackward + " canRedo=" + v.canGoForward
   };
}

// get_full_history, the complete named step list WITH per-step settings.
// KEY FACT (verified live): view.processing is the CUMULATIVE ProcessContainer of
// every history step (its entries .at(0..N-1) are states 1..N); view.initialProcessing
// is the base (state 0); view.historyIndex is the current pointer. So the whole history
// reads out of these two objects with NO navigation, fully read-only, no pixel swap.
// PixInsight prunes the redo branch when a process is applied after an undo, so
// view.processing already reflects the surviving linear history the GUI shows; steps
// ahead of the pointer are redo-able (not applied to current pixels).
function handleGetFullHistory(command) {
   var viewId = command.parameters.viewId;
   var maxLines = command.parameters.maxParamLines || 12;
   var w = findWindowByViewId(viewId);
   if (!w) throw new Error("Image not found: " + viewId);
   var v = w.mainView;
   var current = v.historyIndex;

   function innerIds(pc) {
      var ids = [];
      try { for (var k = 0; k < pc.length; ++k) ids.push(pc.at(k).processId()); } catch (e) {}
      return ids;
   }
   // Extract just the `P.<param> = ...;` assignment lines, dropping the huge
   // pixel/path/comment blobs (e.g. ImageIntegration's 80 KB file list).
   function compactParams(p, limit) {
      var out = [];
      try {
         var lines = String(p.toSource()).split("\n");
         for (var i = 0; i < lines.length; ++i) {
            var ln = lines[i].replace(/^\s+/, "");
            if (ln.substring(0, 2) === "P." || ln.substring(0, 2) === "P[") {
               if (ln.length > 200) ln = ln.substring(0, 160) + " ...";
               out.push(ln);
               if (out.length >= limit) { out.push("... (truncated; " + lines.length + " source lines)"); break; }
            }
         }
      } catch (e) { out.push("(source unavailable: " + e.message + ")"); }
      return out;
   }

   var steps = [];
   // Base state (index 0), usually a ProcessContainer (the WBPP/integration).
   // Its source can be enormous, so we list inner process names but skip params.
   var baseId = "(none)", baseInner = null;
   try {
      var init = v.initialProcessing;
      baseId = init.processId();
      if (baseId === "ProcessContainer") baseInner = innerIds(init);
   } catch (e) {}
   steps.push({ index: 0, processId: baseId, inner: baseInner, params: [], applied: true, current: current === 0 });

   var c = v.processing, n = 0;
   try { n = c.length; } catch (e) { n = 0; }
   for (var j = 0; j < n; ++j) {
      var p = c.at(j);
      var pid = p.processId();
      var stateIndex = j + 1;
      steps.push({
         index: stateIndex,
         processId: pid,
         inner: (pid === "ProcessContainer") ? innerIds(p) : null,
         params: compactParams(p, maxLines),
         applied: stateIndex <= current,
         current: stateIndex === current
      });
   }

   var msg = [];
   msg.push(viewId + " history: " + n + " step(s) after base; current index=" + current +
            ", canUndo=" + v.canGoBackward + ", canRedo=" + v.canGoForward);
   for (var s = 0; s < steps.length; ++s) {
      var st = steps[s];
      var head = "[" + st.index + "] " + st.processId;
      if (st.inner && st.inner.length) head += " {" + st.inner.join(", ") + "}";
      var flags = [];
      if (st.current) flags.push("CURRENT");
      if (!st.applied) flags.push("redo-able, not applied");
      if (flags.length) head += "  <" + flags.join("; ") + ">";
      msg.push(head);
      for (var q = 0; q < st.params.length; ++q) msg.push("      " + st.params[q]);
   }

   return {
      status: "success",
      outputs: { historyIndex: current, stepCount: n, canUndo: v.canGoBackward, canRedo: v.canGoForward, steps: steps },
      message: msg.join("\n")
   };
}

function handleUndo(command) {
   var viewId = command.parameters.viewId;
   var steps = command.parameters.steps || 1;
   var w = findWindowByViewId(viewId);
   if (!w) throw new Error("Image not found: " + viewId);
   var v = w.mainView;
   var done = 0;
   for (var i = 0; i < steps && v.canGoBackward; ++i) { w.undo(); ++done; }
   return {
      status: "success",
      outputs: { undone: done, historyIndex: v.historyIndex, canUndo: v.canGoBackward, canRedo: v.canGoForward },
      message: "Undid " + done + " step(s) on " + viewId + " (index=" + v.historyIndex + ")"
   };
}

function handleRedo(command) {
   var viewId = command.parameters.viewId;
   var steps = command.parameters.steps || 1;
   var w = findWindowByViewId(viewId);
   if (!w) throw new Error("Image not found: " + viewId);
   var v = w.mainView;
   var done = 0;
   for (var i = 0; i < steps && v.canGoForward; ++i) { w.redo(); ++done; }
   return {
      status: "success",
      outputs: { redone: done, historyIndex: v.historyIndex, canUndo: v.canGoBackward, canRedo: v.canGoForward },
      message: "Redid " + done + " step(s) on " + viewId + " (index=" + v.historyIndex + ")"
   };
}

function handleSnapshot(command) {
   var viewId = command.parameters.viewId;
   var snapId = command.parameters.snapshotId || (viewId + "_snap");
   var w = findWindowByViewId(viewId);
   if (!w) throw new Error("Image not found: " + viewId);
   var src = w.mainView.image;
   var ex = ImageWindow.windowById(snapId);
   if (!ex.isNull) ex.forceClose();   // overwrite an existing snapshot of the same id
   var sw = new ImageWindow(src.width, src.height, src.numberOfChannels,
                            src.bitsPerSample, src.isReal, src.isColor, snapId);
   var sv = sw.mainView;
   sv.beginProcess();
   sv.image.assign(src);
   sv.endProcess();
   // Left hidden (not shown), findable via windowById, no UI clutter.
   return {
      status: "success",
      outputs: { snapshotId: snapId, width: src.width, height: src.height, channels: src.numberOfChannels },
      message: "Snapshot " + snapId + " taken from " + viewId
   };
}

function handleRestore(command) {
   var viewId = command.parameters.viewId;
   var snapId = command.parameters.snapshotId;
   var w = findWindowByViewId(viewId);
   if (!w) throw new Error("Target image not found: " + viewId);
   var sw = ImageWindow.windowById(snapId);
   if (sw.isNull) throw new Error("Snapshot not found: " + snapId);
   var tv = w.mainView;
   var ti = tv.image, si = sw.mainView.image;
   if (ti.width !== si.width || ti.height !== si.height || ti.numberOfChannels !== si.numberOfChannels)
      throw new Error("Geometry mismatch: target " + ti.width + "x" + ti.height + "x" + ti.numberOfChannels +
                      " vs snapshot " + si.width + "x" + si.height + "x" + si.numberOfChannels);
   tv.beginProcess();   // registers an undoable step
   tv.image.assign(si);
   tv.endProcess();
   return {
      status: "success",
      outputs: { restored: true, historyIndex: tv.historyIndex },
      message: "Restored " + viewId + " from snapshot " + snapId
   };
}

// ============================================================================
// Utility Functions
// ============================================================================

function findWindowByViewId(viewId) {
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; ++i) {
      if (windows[i].mainView.id === viewId) {
         return windows[i];
      }
      // Check previews too
      for (var j = 0; j < windows[i].previews.length; ++j) {
         if (windows[i].previews[j].id === viewId) {
            return windows[i];
         }
      }
   }
   return null;
}

function findViewById(viewId) {
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; ++i) {
      if (windows[i].mainView.id === viewId) {
         return windows[i].mainView;
      }
      for (var j = 0; j < windows[i].previews.length; ++j) {
         if (windows[i].previews[j].id === viewId) {
            return windows[i].previews[j];
         }
      }
   }
   return null;
}

// ============================================================================
// Reproducibility export, write a loadable ProcessContainer .xpsm from a view's
// process-history slice. .xpsm is plain XML; PixInsight opens it -> icon appears.
// The scripting API CANNOT mint icons (writeIcon only overwrites an existing one),
// so we write the file directly. Format cracked from a real PI 1.9.4 save.
// ============================================================================

function handleExportContainer(command) {
   var p = command.parameters;
   var viewId = p.viewId, iconName = p.iconName || "ProcessContainer", outPath = p.outputPath;
   if (!outPath) throw new Error("outputPath is required");
   var w = findWindowByViewId(viewId);
   if (!w) throw new Error("Image not found: " + viewId);
   var pc = w.mainView.processing;
   var total = 0; try { total = pc.length; } catch (e) { total = 0; }
   var from = (p.fromIndex != null) ? p.fromIndex : 0;
   var to = (p.toIndex != null) ? p.toIndex : total;
   if (from < 0) from = 0;
   if (to > total) to = total;
   var procs = [];
   for (var i = from; i < to; ++i) procs.push(pc.at(i));
   if (!procs.length)
      throw new Error("No history steps in [" + from + "," + to + ") for " + viewId + " (history has " +
                      total + "). Note: view.processing RESETS on save+reopen and createNewImage outputs " +
                      "start with empty history, export while the view is still live.");

   function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
   function tableRows(arr) {
      var s = "";
      for (var r = 0; r < arr.length; ++r)
         s += '         <tr>\n            <td id="x" value="' + arr[r][0] + '"/>\n            <td id="y" value="' + arr[r][1] + '"/>\n         </tr>\n';
      return s;
   }
   // ProcessInstance -> <instance> XML. Handles scalars/bools/enums/strings AND (crucially)
   // MULTI-LINE curve/HS point arrays, a line-by-line parser silently drops those tables.
   function instanceToXpsm(P, indent) {
      var src = P.toSource();
      var cls = /new\s+(\w+)/.exec(src)[1];
      var body = src.substring(src.indexOf(";") + 1);
      var pad = indent + "   ";
      var x = indent + '<instance class="' + cls + '" version="256" enabled="true">\n';
      var re = /P\.(\w+)\s*=\s*([\s\S]*?);\s*(?=P\.\w+\s*=|$)/g, m;
      while ((m = re.exec(body)) !== null) {
         var id = m[1], v = m[2].replace(/^\s+|\s+$/g, "");
         if (v === "true" || v === "false") x += pad + '<parameter id="' + id + '" value="' + v + '"/>\n';
         else if (/^-?[0-9.]+([eE]-?[0-9]+)?$/.test(v)) x += pad + '<parameter id="' + id + '" value="' + v + '"/>\n';
         else if (/^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(v)) x += pad + '<parameter id="' + id + '" value="' + v.split(".").pop() + '"/>\n';
         else if (v.charAt(0) === '"') { var str = v.slice(1, -1); x += str === "" ? pad + '<parameter id="' + id + '"></parameter>\n' : pad + '<parameter id="' + id + '">' + xmlEsc(str) + "</parameter>\n"; }
         else if (v.charAt(0) === "[") {
            var arr; try { arr = eval(v); } catch (e) { arr = null; }
            if (arr && arr.length && arr[0] && arr[0].length === 2) x += pad + '<table id="' + id + '" rows="' + arr.length + '">\n' + tableRows(arr) + pad + "</table>\n";
            else x += pad + '<table id="' + id + '" rows="0"/>\n';
         }
      }
      return x + indent + "</instance>\n";
   }

   var instId = iconName + "_inst";
   var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<xpsm version="1.0" xmlns="http://www.pixinsight.com/xpsm" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.pixinsight.com/xpsm http://pixinsight.com/xpsm/xpsm-1.0.xsd">\n' +
      '   <instance class="ProcessContainer" id="' + instId + '">\n';
   var ids = [];
   for (var k = 0; k < procs.length; ++k) { xml += instanceToXpsm(procs[k], "      "); ids.push(procs[k].processId()); }
   xml += "   </instance>\n" +
      '   <icon id="' + iconName + '" instance="' + instId + '" xpos="16" ypos="688" workspace="Workspace01"/>\n</xpsm>\n';

   File.writeTextFile(outPath, xml);
   return {
      status: "success",
      outputs: { path: outPath, count: procs.length, processes: ids, fromIndex: from, toIndex: to },
      message: "Wrote " + procs.length + "-process container '" + iconName + "' (" + ids.join(", ") + ") to " + outPath
   };
}

// ============================================================================
// Command Router
// ============================================================================

// Commands older than this are refused. Rationale: the MCP client abandons a
// command after its timeout (default 5 min); anything older is a leftover from
// a dead session, and executing it minutes/days later (e.g. a queued save or
// close firing on watcher start) would be a surprising side effect. Matches the
// client-side cleanStaleCommands threshold.
var STALE_COMMAND_MS = 10 * 60 * 1000;

function dispatchCommand(command) {
   var result = routeCommand(command);
   if (!result.outputs) result.outputs = {};
   result.outputs.handlersRev = HANDLERS_REVISION;
   return result;
}

function routeCommand(command) {
   var tool = command.tool;

   if (command.timestamp) {
      var age = Date.now() - Date.parse(command.timestamp);
      if (isFinite(age) && age > STALE_COMMAND_MS)
         throw new Error("Stale command refused (queued " + Math.round(age / 60000) +
                         " min ago, limit " + (STALE_COMMAND_MS / 60000) + "), " +
                         "its client is gone; re-issue the command if still wanted.");
   }

   // Internal commands
   if (tool === "list_open_images") return handleListOpenImages(command);
   if (tool === "open_image") return handleOpenImage(command);
   if (tool === "save_image") return handleSaveImage(command);
   if (tool === "close_image") return handleCloseImage(command);
   if (tool === "get_image_statistics") return handleGetImageStatistics(command);

   // Processing commands
   if (tool === "run_pixelmath") return handleRunPixelMath(command);

   // Generic: run any process by name, or introspect its parameters
   if (tool === "run_process") return handleRunProcess(command);
   if (tool === "get_process_parameters") return handleGetProcessParameters(command);

   // Session / process-history: revert + checkpoint
   if (tool === "get_history") return handleGetHistory(command);
   if (tool === "get_full_history") return handleGetFullHistory(command);
   if (tool === "undo") return handleUndo(command);
   if (tool === "redo") return handleRedo(command);
   if (tool === "snapshot") return handleSnapshot(command);
   if (tool === "restore") return handleRestore(command);

   // Reproducibility: emit a per-section ProcessContainer .xpsm
   if (tool === "export_container") return handleExportContainer(command);

   // Script execution
   if (tool === "run_script") return handleRunScript(command);

   throw new Error("Unknown tool: " + tool);
}
//__MCP_HANDLERS_END__

// ============================================================================
// Main Polling Loop
// ============================================================================

function processNextCommand() {
   var files = listJsonFiles(COMMANDS_DIR + "/*.json");
   if (files.length === 0) {
      return false;
   }

   // Sort by filename. UUIDv4 names, order is arbitrary; fine because the MCP
   // client is serial (one in-flight command).
   files.sort();

   // Process the first command
   var filePath = files[0];
   var commandJson, command;

   try {
      commandJson = readTextFile(filePath);
      command = JSON.parse(commandJson);
   } catch (e) {
      console.criticalln("[MCP Watcher] Failed to parse command file: " + filePath + " - " + e.message);
      deleteFile(filePath);
      return true;
   }

   var startTime = Date.now();
   var resultObj;

   try {
      console.writeln("[MCP Watcher] Executing: " + command.tool + " (id: " + command.id + ")");
      var handlerResult = dispatchCommand(command);
      resultObj = {
         id: command.id,
         timestamp: getTimestamp(),
         status: handlerResult.status,
         process: command.process,
         duration_ms: Date.now() - startTime,
         outputs: handlerResult.outputs || {},
         message: handlerResult.message || ""
      };
   } catch (e) {
      console.criticalln("[MCP Watcher] Error executing " + command.tool + ": " + e.message);
      resultObj = {
         id: command.id,
         timestamp: getTimestamp(),
         status: "error",
         process: command.process,
         duration_ms: Date.now() - startTime,
         error: {
            message: e.message,
            type: e.name || "Error",
            stack: e.stack || ""
         }
      };
   }

   // Write result atomically: tmp then rename, so the MCP client (polling the
   // exact <id>.json name) never sees a partial file. Tmp is "<id>.tmp", no
   // .json suffix, so it stays outside every *.json glob.
   var resultPath = RESULTS_DIR + "/" + command.id + ".json";
   var tmpPath = RESULTS_DIR + "/" + command.id + ".tmp";
   try {
      writeTextFile(tmpPath, JSON.stringify(resultObj));
      File.move(tmpPath, resultPath);
      console.writeln("[MCP Watcher] Result written: " + resultObj.status +
         " (" + resultObj.duration_ms + "ms)");
   } catch (e) {
      console.criticalln("[MCP Watcher] Failed to write result: " + e.message);
   }

   // Delete command file. Note the crash window: the command was already
   // executed, so a crash between execution and this delete means the command
   // re-runs on restart (non-idempotent processes apply twice). Accepted -
   // deleting first would instead lose commands on a crash mid-execution.
   deleteFile(filePath);

   return true;
}

function runWatcher() {
   // Ensure directories exist
   ensureDirectory(BRIDGE_DIR);
   ensureDirectory(COMMANDS_DIR);
   ensureDirectory(RESULTS_DIR);
   ensureDirectory(LOGS_DIR);

   console.noteln("===========================================");
   console.noteln("  PixInsight MCP Watcher v" + WATCHER_VERSION);
   console.noteln("  Bridge: " + BRIDGE_DIR);
   console.noteln("  Polling every " + POLL_INTERVAL_MS + "ms");
   console.noteln("  Ctrl+F11 to abort");
   console.noteln("===========================================");

   var commandCount = 0;

   console.show();

   // Graceful shutdown: check for sentinel file
   var SHUTDOWN_FILE = BRIDGE_DIR + "/shutdown";

   function shouldShutdown() {
      if (console.abortRequested) return true;
      if (File.exists(SHUTDOWN_FILE)) {
         try { File.remove(SHUTDOWN_FILE); } catch(e) {}
         return true;
      }
      return false;
   }

   // Main loop, processEvents() keeps PixInsight UI responsive
   // Use short sleeps (20ms) with frequent processEvents() for UI responsiveness
   for (;;) {
      // Yield to PixInsight UI
      CoreApplication.processEvents();

      // Check abort or shutdown signal
      if (shouldShutdown()) {
         console.warningln("[MCP Watcher] Shutdown requested. Stopping.");
         break;
      }

      var processed = processNextCommand();
      if (processed) {
         commandCount++;
         // Yield heavily after command execution so UI can catch up
         for (var y = 0; y < 20; ++y) {
            CoreApplication.processEvents();
            System.msleep(20);
            if (shouldShutdown()) break;
         }
      } else {
         // No commands, yield frequently with short sleeps for UI responsiveness
         // Total idle cycle: ~500ms (25 x 20ms) before re-checking commands
         for (var i = 0; i < 25; ++i) {
            System.msleep(20);
            CoreApplication.processEvents();
            if (shouldShutdown()) break;
         }
      }
   }

   console.noteln("[MCP Watcher] Stopped. Processed " + commandCount + " command(s).");
}

// ============================================================================
// Entry Point
// ============================================================================

runWatcher();
