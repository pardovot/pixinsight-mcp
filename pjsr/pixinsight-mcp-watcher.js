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

// The recipes the module embeds (module/gen-handlers.mjs RECIPE_FILES).
#include "../recipes/osc-rgb-linear.js"
#include "../scripts/crop-select.js"
#include "../scripts/profile.js"

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

// Per-instance bridge slot, so N PixInsight instances never poll the same
// commands dir. Precedence mirrors the native module + MCP server:
//   PIXINSIGHT_MCP_INSTANCE env  >  CoreApplication.instance (-n=N)  >  slot 1.
// Kept OUTSIDE the __MCP_HANDLERS_* block below, so the embedded-handler hash
// (scripts/handlers-rev.lock.json) is untouched, no HANDLERS_REVISION bump.
function resolveBridgeSlot() {
   try {
      var env = getEnvironmentVariable( "PIXINSIGHT_MCP_INSTANCE" );
      if ( env && parseInt( env, 10 ) > 0 )
         return parseInt( env, 10 );
   } catch ( e ) {}
   try {
      if ( CoreApplication.instance > 0 )
         return CoreApplication.instance;
   } catch ( e ) {}
   return 1;
}
var BRIDGE_SLOT = resolveBridgeSlot();
var BRIDGE_DIR = File.homeDirectory + "/.pixinsight-mcp/bridge"
   + (BRIDGE_SLOT > 1 ? ("-" + BRIDGE_SLOT) : "");
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
var HANDLERS_REVISION = 3;

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
// This is the primary mechanism, there are no per-process wrappers.
// ============================================================================

function instantiateProcess(processId) {
   if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(processId || "")) {
      throw new Error("Invalid process id: " + processId);
   }
   var ProcessClass = globalThis[processId];
   if (typeof ProcessClass !== "function")
      throw new Error("Unknown process: " + processId);
   var P = new ProcessClass();
   if (!(P instanceof ProcessInstance))
      throw new Error("Not a process: " + processId);
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
            var arr; try { arr = JSON.parse(v); } catch (e) { arr = null; }
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

// ============================================================================
// Measurement and rendering
// ----------------------------------------------------------------------------
// Each pjsr* function returns a JSON string, {error: "..."} on failure.
// ============================================================================

function pjsrNoise(viewId) {
  return (function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var v = View.viewById(viewId);
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + viewId});
  var img = v.image;
  var n = Math.min(img.numberOfChannels, 3);
  var names = img.isColor ? ["R","G","B"] : ["K"];
  var total = img.width * img.height;
  var chans = [];
  for (var c = 0; c < n; ++c) {
    img.selectedChannel = c;
    var r = img.noiseMRS();
    var sigma, frac = null;
    if (r && typeof r === "object" && r.length !== undefined) {
      sigma = r[0];
      if (r.length > 1 && isFinite(r[1])) frac = (r[1] > 1) ? r[1]/total : r[1];
    } else {
      sigma = r;
    }
    chans.push({ channel: c, name: names[c] || ("C"+c), sigma: sig(sigma), pixelFraction: frac === null ? null : sig(frac) });
  }
  img.resetSelections();
  return JSON.stringify({ viewId: viewId, method: "MRS", channels: chans });
})();
}

function pjsrGradient(viewId, gridSize, boxFraction) {
  return (function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var v = View.viewById(viewId);
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + viewId});
  var img = v.image;
  var w = img.width, h = img.height;
  var g = gridSize;
  var bw = Math.max(16, Math.round(w * boxFraction));
  var bh = Math.max(16, Math.round(h * boxFraction));
  var nch = Math.min(img.numberOfChannels, 3);
  var names = img.isColor ? ["R","G","B"] : ["K"];

  var boxMedian = function(x0, y0, c) {
    img.selectedChannel = c;
    img.selectedRect = new Rect(x0, y0, x0 + bw, y0 + bh);
    return img.median();
  };
  var clampX = function(x){ return Math.max(0, Math.min(w - bw, x)); };
  var clampY = function(y){ return Math.max(0, Math.min(h - bh, y)); };

  // Grid boxes + one explicit center box.
  var boxes = [];
  for (var j = 0; j < g; ++j)
    for (var i = 0; i < g; ++i) {
      var cx = (i + 0.5) * w / g, cy = (j + 0.5) * h / g;
      var x0 = clampX(Math.round(cx - bw/2)), y0 = clampY(Math.round(cy - bh/2));
      var meds = [];
      for (var c = 0; c < nch; ++c) meds.push(boxMedian(x0, y0, c));
      boxes.push({ i: i, j: j, x: sig(cx / w), y: sig(cy / h), medians: meds.map(sig) });
    }
  var cx0 = clampX(Math.round(w/2 - bw/2)), cy0 = clampY(Math.round(h/2 - bh/2));
  var centerMeds = [];
  for (var c = 0; c < nch; ++c) centerMeds.push(boxMedian(cx0, cy0, c));
  img.resetSelections();

  // Per-channel: corners, deviation, least-squares plane m = a + bx*x + by*y (x,y in [0,1]).
  var channels = [];
  for (var c = 0; c < nch; ++c) {
    var corners = [];
    var minM = Infinity, maxM = -Infinity;
    var S = [[0,0,0],[0,0,0],[0,0,0]], t = [0,0,0];
    for (var k = 0; k < boxes.length; ++k) {
      var b = boxes[k], m = b.medians[c];
      if ((b.i === 0 || b.i === g-1) && (b.j === 0 || b.j === g-1)) corners.push(m);
      if (m < minM) minM = m;
      if (m > maxM) maxM = m;
      var row = [1, b.x, b.y];
      for (var p = 0; p < 3; ++p) { for (var q = 0; q < 3; ++q) S[p][q] += row[p]*row[q]; t[p] += row[p]*m; }
    }
    // Solve 3x3 by Cramer.
    var det = function(M){ return M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1]) - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0]) + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]); };
    var D = det(S), plane = null;
    if (Math.abs(D) > 1e-30) {
      var Mi = function(col){ var M = [S[0].slice(),S[1].slice(),S[2].slice()]; for (var r = 0; r < 3; ++r) M[r][col] = t[r]; return M; };
      plane = { a: sig(det(Mi(0))/D), bx: sig(det(Mi(1))/D), by: sig(det(Mi(2))/D) };
    }
    var center = centerMeds[c], denom = Math.max(Math.abs(center), 1e-9);
    var cornerSpread = corners.length ? Math.max.apply(null, corners) - Math.min.apply(null, corners) : null;
    channels.push({
      channel: c, name: names[c] || ("C"+c),
      centerMedian: sig(center),
      cornerMedians: corners.map(sig),
      cornerSpread: sig(cornerSpread),
      cornerSpreadPctOfCenter: sig(cornerSpread === null ? null : 100*cornerSpread/denom),
      maxDeviationPct: sig(100*Math.max(maxM - center, center - minM)/denom),
      plane: plane
    });
  }
  return JSON.stringify({ viewId: viewId, gridSize: g, boxWidth: bw, boxHeight: bh, channels: channels, boxes: boxes });
})();
}

function pjsrNeutrality(viewId, mode, signalChannel, signalIndex, targetSamples) {
  return (function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var median = function(a){ if (!a.length) return null; var s = a.slice().sort(function(p,q){return p-q;}); var m = s.length >> 1; return (s.length % 2) ? s[m] : (s[m-1]+s[m])/2; };
  var v = View.viewById(viewId);
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + viewId});
  var img = v.image;
  if (!img.isColor) return JSON.stringify({error: "get_background_neutrality requires a color image"});
  var w = img.width, h = img.height;
  var stride = Math.max(1, Math.floor(Math.sqrt(w*h/targetSamples)));

  var R = [], G = [], B = [];
  var buf = [];
  for (var y = 0; y < h; y += stride) {
    for (var c = 0; c < 3; ++c) {
      img.selectedChannel = c;
      img.selectedRect = new Rect(0, y, w, y+1);
      img.getSamples(buf);
      var dst = (c === 0) ? R : (c === 1) ? G : B;
      for (var x = 0; x < w; x += stride) dst.push(buf[x]);
    }
  }
  img.resetSelections();
  var n = R.length;

  if (mode === "linear") {
    var L = new Array(n);
    for (var i = 0; i < n; ++i) L[i] = (R[i]+G[i]+B[i])/3;
    var Lmed = median(L);
    var bandR = [], bandG = [], bandB = [];
    for (var i = 0; i < n; ++i)
      if (Math.abs(L[i] - Lmed) <= 0.08*Lmed) { bandR.push(R[i]); bandG.push(G[i]); bandB.push(B[i]); }
    var mR = median(bandR), mG = median(bandG), mB = median(bandB);
    var mx = Math.max(mR,mG,mB), mn = Math.min(mR,mG,mB), avg = (mR+mG+mB)/3;
    return JSON.stringify({ viewId: viewId, mode: "linear", samples: n, stride: stride,
      luminanceMedian: sig(Lmed), bandCount: bandR.length,
      perChannelMedian: { R: sig(mR), G: sig(mG), B: sig(mB) },
      spreadPct: sig(avg > 0 ? 100*(mx-mn)/avg : null),
      note: "spreadPct <= 1 = neutral. Valid PRE-stretch only; use mode:poststretch after stretching." });
  }

  // poststretch
  var scIdx = signalIndex;
  var nearR = [], nearG = [], nearB = [], nearSat = [];
  var faint = [], bright = [];
  for (var i = 0; i < n; ++i) {
    var ch = [R[i], G[i], B[i]];
    var s = ch[scIdx];
    var others = (ch[0]+ch[1]+ch[2] - s)/2;
    var rex = s - others;
    if (Math.abs(rex) < 0.01) {
      nearR.push(R[i]); nearG.push(G[i]); nearB.push(B[i]);
      var mx = Math.max(ch[0],ch[1],ch[2]), mn = Math.min(ch[0],ch[1],ch[2]);
      if (mx > 0) nearSat.push((mx-mn)/mx);
    } else if (rex >= 0.02 && rex <= 0.05) faint.push(s);
    else if (rex > 0.05) bright.push(s);
  }
  var satMean = null;
  if (nearSat.length) { var t = 0; for (var i = 0; i < nearSat.length; ++i) t += nearSat[i]; satMean = t/nearSat.length; }
  return JSON.stringify({ viewId: viewId, mode: "poststretch", signalChannel: signalChannel, samples: n, stride: stride,
    nearNeutral: { count: nearR.length, perChannelMedian: { R: sig(median(nearR)), G: sig(median(nearG)), B: sig(median(nearB)) }, bgChroma: sig(satMean) },
    faint: { count: faint.length, signalMedian: sig(median(faint)) },
    bright: { count: bright.length, signalMedian: sig(median(bright)) },
    note: "bgChroma tracks neutrality post-stretch. faint/bright signalMedian: compare across before/after calls for the preservation ratio (~100% = preserved)." });
})();
}

function pjsrStars(viewId, maxStars) {
  return (function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var median = function(a){ if (!a.length) return null; var s = a.slice().sort(function(p,q){return p-q;}); var m = s.length >> 1; return (s.length % 2) ? s[m] : (s[m-1]+s[m])/2; };
  var v = View.viewById(viewId);
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + viewId});
  var img = v.image;
  var w = img.width, h = img.height;
  var dc = img.isColor ? 1 : 0; // detect on G: present in every star, avoids Bayer R/B noise extremes

  // Threshold: MAD-based, floored by MRS noise. On a stars-only layer median and
  // MAD are ~0, so the MAD term collapses to the noise floor and every noise bump
  // becomes a "star" (verified live: 60k capped candidates), the 30·sigmaMRS floor
  // keeps detection on real stars there.
  img.selectedChannel = dc;
  var med = img.median(), mad = img.MAD();
  var nr = img.noiseMRS();
  var sigma = (nr && typeof nr === "object" && nr.length !== undefined) ? nr[0] : nr;
  img.resetSelections();
  if (!isFinite(sigma) || sigma <= 0) sigma = 1.4826*mad;
  var threshold = med + Math.max(10*1.4826*mad, 30*sigma);

  var readRow = function(c, y, buf) {
    img.selectedChannel = c;
    img.selectedRect = new Rect(0, y, w, y+1);
    img.getSamples(buf);
  };

  // --- Detection scan: every 2nd row, x local maxima above threshold ---
  // Adaptive escalation: a sparse stars-only layer has a vanishing noise floor, so
  // even the noise-floored threshold catches tens of thousands of faint maxima
  // (verified live). If the scan caps, raise threshold x4 and rescan until it
  // completes, deterministic per image, so counts stay comparison-stable; the
  // final threshold is reported.
  var cands = [], buf = [], CAP = 50000, escalations = 0;
  for (;;) {
    cands.length = 0;
    var capped = false;
    for (var y = 0; y < h && !capped; y += 2) {
      readRow(dc, y, buf);
      for (var x = 1; x < w-1; ++x) {
        var p = buf[x];
        if (p > threshold && p >= buf[x-1] && p >= buf[x+1]) {
          cands.push({ x: x, y: y, v: p });
          if (cands.length >= CAP) { capped = true; break; }
        }
      }
    }
    if (!capped || escalations >= 8) break;
    threshold *= 4; ++escalations;
  }
  cands.sort(function(a,b){ return b.v - a.v; });

  // --- Spatial-hash greedy dedup (minSep) → distinct stars ---
  var minSep = 15, cell = {}, accepted = [];
  var key = function(cx, cy){ return cx + "," + cy; };
  for (var k = 0; k < cands.length; ++k) {
    var s = cands[k], cx = Math.floor(s.x/minSep), cy = Math.floor(s.y/minSep), clash = false;
    for (var dy = -1; dy <= 1 && !clash; ++dy)
      for (var dx = -1; dx <= 1 && !clash; ++dx) {
        var lst = cell[key(cx+dx, cy+dy)];
        if (lst) for (var q = 0; q < lst.length; ++q) {
          var o = lst[q];
          if ((o.x-s.x)*(o.x-s.x) + (o.y-s.y)*(o.y-s.y) < minSep*minSep) { clash = true; break; }
        }
      }
    if (!clash) { (cell[key(cx,cy)] = cell[key(cx,cy)] || []).push(s); accepted.push(s); }
  }

  // --- Moment measurement on the brightest maxStars ---
  var win = 12, fwhms = [], eccs = [], brightest = [], measured = 0;
  var readWindow = function(c, x0, y0, x1, y1, out) {
    img.selectedChannel = c;
    img.selectedRect = new Rect(x0, y0, x1, y1);
    img.getSamples(out);
  };
  var nMeasure = Math.min(accepted.length, maxStars);
  for (var k = 0; k < nMeasure; ++k) {
    var s = accepted[k];
    var x0 = Math.max(0, s.x - win), y0 = Math.max(0, s.y - win);
    var x1 = Math.min(w, s.x + win + 1), y1 = Math.min(h, s.y + win + 1);
    var ww = x1 - x0, wh = y1 - y0;
    var wdata = [];
    readWindow(dc, x0, y0, x1, y1, wdata);
    // refine to the true full-res peak inside the window
    var peak = -1, px = s.x, py = s.y;
    for (var j = 0; j < wh; ++j)
      for (var i = 0; i < ww; ++i) {
        var p = wdata[j*ww + i];
        if (p > peak) { peak = p; px = x0 + i; py = y0 + j; }
      }
    if (brightest.length < 5) brightest.push({ x: px, y: py, peak: sig(peak) });
    if (peak > 0.998) continue; // saturated: flat top corrupts moments
    // background = median of the window border ring
    var ring = [];
    for (var i = 0; i < ww; ++i) { ring.push(wdata[i]); ring.push(wdata[(wh-1)*ww + i]); }
    for (var j = 1; j < wh-1; ++j) { ring.push(wdata[j*ww]); ring.push(wdata[j*ww + ww-1]); }
    var bg = median(ring);
    var F = 0, Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0;
    for (var j = 0; j < wh; ++j)
      for (var i = 0; i < ww; ++i) {
        var f = wdata[j*ww + i] - bg;
        if (f <= 0) continue;
        F += f; Sx += f*i; Sy += f*j; Sxx += f*i*i; Syy += f*j*j; Sxy += f*i*j;
      }
    if (F <= 0) continue;
    var mx = Sx/F, my = Sy/F;
    var vx = Sxx/F - mx*mx, vy = Syy/F - my*my, cxy = Sxy/F - mx*my;
    if (vx <= 0 || vy <= 0) continue;
    fwhms.push(2.3548*Math.sqrt((vx+vy)/2));
    var tr2 = (vx+vy)/2, d = Math.sqrt(((vx-vy)/2)*((vx-vy)/2) + cxy*cxy);
    var l1 = tr2 + d, l2 = tr2 - d;
    if (l1 > 0 && l2 > 0) eccs.push(Math.sqrt(1 - l2/l1));
    ++measured;
  }

  // --- starPixelMedian: stride-grid max(R,G,B) > 0.005 (the R5 star-layer metric) ---
  var spStride = Math.max(2, Math.floor(Math.sqrt(w*h/250000)));
  var starPix = [], bR = [], bG = [], bB = [];
  for (var y = 0; y < h; y += spStride) {
    if (img.isColor) { readRow(0, y, bR); readRow(1, y, bG); readRow(2, y, bB); }
    else readRow(0, y, bR);
    for (var x = 0; x < w; x += spStride) {
      var val = img.isColor ? Math.max(bR[x], bG[x], bB[x]) : bR[x];
      if (val > 0.005) starPix.push(val);
    }
  }
  img.resetSelections();

  return JSON.stringify({ viewId: viewId,
    starCount: accepted.length, candidatesCapped: cands.length >= CAP, thresholdEscalations: escalations,
    measured: measured, threshold: sig(threshold),
    medianFWHM: sig(median(fwhms)), medianEccentricity: sig(median(eccs)),
    starPixelMedian: sig(median(starPix)), starPixelCount: starPix.length,
    brightestStars: brightest,
    note: "Comparison-stable, not photometric. starCount approximate (2px-row subsampling). starPixelMedian meaningful on a stars-only layer." });
})();
}

function pjsrStructureColor(viewId, rect, tileGrid, targetSamples) {
  return (function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var median = function(a){ if (!a.length) return null; var s = a.slice().sort(function(p,q){return p-q;}); var m = s.length >> 1; return (s.length % 2) ? s[m] : (s[m-1]+s[m])/2; };
  var v = View.viewById(viewId);
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + viewId});
  var img = v.image;
  if (!img.isColor) return JSON.stringify({error: "get_structure_color requires a color image"});

  var X0 = 0, Y0 = 0, X1 = img.width, Y1 = img.height;
  var rc = rect;
  if (rc) {
    X0 = Math.max(0, Math.min(img.width-1,  Math.trunc(rc[0])));
    Y0 = Math.max(0, Math.min(img.height-1, Math.trunc(rc[1])));
    X1 = Math.max(X0+2, Math.min(img.width,  Math.trunc(rc[2])));
    Y1 = Math.max(Y0+2, Math.min(img.height, Math.trunc(rc[3])));
  }
  var rw = X1-X0, rh = Y1-Y0;
  var stride = Math.max(1, Math.floor(Math.sqrt(rw*rh/targetSamples)));

  // ---- one stride-grid pass, row-bulk reads (exact samples, no interpolation)
  var gw = 0, gh = 0;
  var gR = [], gG = [], gB = [];
  var buf = [];
  for (var y = Y0; y < Y1; y += stride) {
    var rowR = [], rowG = [], rowB = [];
    for (var c = 0; c < 3; ++c) {
      img.selectedChannel = c;
      img.selectedRect = new Rect(X0, y, X1, y+1);
      img.getSamples(buf);
      var dst = (c === 0) ? rowR : (c === 1) ? rowG : rowB;
      for (var x = 0; x < rw; x += stride) dst.push(buf[x]);
    }
    gR.push(rowR); gG.push(rowG); gB.push(rowB);
    if (rowR.length > gw) gw = rowR.length;
    ++gh;
  }
  img.resetSelections();
  if (gh < 3 || gw < 3) return JSON.stringify({error: "Region too small to sample (need >= 3x3 grid samples)"});

  // ---- luminance grid + star rejection against 4 grid neighbours
  var L = [];
  for (var j = 0; j < gh; ++j) {
    var rowL = [];
    for (var i = 0; i < gR[j].length; ++i) rowL.push((gR[j][i]+gG[j][i]+gB[j][i])/3);
    L.push(rowL);
  }
  var px = [];              // { L, r, g, b } for non-star samples
  var nStarRejected = 0;
  for (var j2 = 1; j2 < gh-1; ++j2) {
    var row = gR[j2];
    for (var i2 = 1; i2 < row.length-1; ++i2) {
      if (i2 >= L[j2-1].length || i2 >= L[j2+1].length) continue;
      var c0 = L[j2][i2];
      if (!(c0 > 0)) continue;
      var nb = (L[j2][i2-1] + L[j2][i2+1] + L[j2-1][i2] + L[j2+1][i2]) / 4;
      if (nb > 0 && c0 > nb*1.25) { ++nStarRejected; continue; }   // bright spike = star
      px.push({ L: c0, r: gR[j2][i2], g: gG[j2][i2], b: gB[j2][i2] });
    }
  }
  if (px.length < 50) return JSON.stringify({error: "Too few non-star samples in region (" + px.length + ")"});

  // ---- 1) STRUCTURE COLOUR = bright population minus dark population
  px.sort(function(a,b){ return a.L - b.L; });
  var n = px.length, q1 = Math.floor(n*0.20), q3 = Math.floor(n*0.80);
  var dR=0,dG=0,dB=0,dL=0,dn=0, bR=0,bG=0,bB=0,bL=0,bn=0;
  for (var i3 = 0; i3 < q1; ++i3){ dR+=px[i3].r; dG+=px[i3].g; dB+=px[i3].b; dL+=px[i3].L; ++dn; }
  for (var i4 = q3; i4 < n; ++i4){ bR+=px[i4].r; bG+=px[i4].g; bB+=px[i4].b; bL+=px[i4].L; ++bn; }
  var Dr=dR/dn, Dg=dG/dn, Db=dB/dn, Dl=dL/dn;
  var Br=bR/bn, Bg=bG/bn, Bb=bB/bn, Bl=bL/bn;
  var sR=Br-Dr, sG=Bg-Dg, sB=Bb-Db;

  // ---- 2) SPATIAL CHROMA, per-tile, catches localized chroma death
  var TG = tileGrid;
  var tiles = [];
  for (var t = 0; t < TG*TG; ++t) tiles.push([]);
  var nExact = 0, nAll = 0, satAll = [];
  for (var j3 = 0; j3 < gh; ++j3) {
    for (var i5 = 0; i5 < gR[j3].length; ++i5) {
      var rr=gR[j3][i5], gg=gG[j3][i5], bb=gB[j3][i5];
      var mx = Math.max(rr, Math.max(gg, bb)), mn = Math.min(rr, Math.min(gg, bb));
      var sat = mx > 0 ? (mx-mn)/mx : 0;
      ++nAll; if (mx-mn <= 0) ++nExact;
      satAll.push(sat);
      var tx = Math.min(TG-1, Math.floor(i5 / Math.max(1, gR[j3].length/TG)));
      var ty = Math.min(TG-1, Math.floor(j3 / Math.max(1, gh/TG)));
      tiles[ty*TG+tx].push(sat);
    }
  }
  var tileSat = [], minT = null, minTi = -1;
  for (var t2 = 0; t2 < tiles.length; ++t2) {
    var m2 = tiles[t2].length ? median(tiles[t2]) : null;
    tileSat.push(m2 === null ? null : sig(m2));
    if (m2 !== null && (minT === null || m2 < minT)) { minT = m2; minTi = t2; }
  }
  var maxT = null;
  for (var t3 = 0; t3 < tileSat.length; ++t3) if (tileSat[t3] !== null && (maxT === null || tileSat[t3] > maxT)) maxT = tileSat[t3];

  return JSON.stringify({
    viewId: viewId,
    rect: [X0, Y0, X1, Y1],
    stride: stride,
    gridSamples: nAll,
    starSamplesRejected: nStarRejected,
    structure: {
      deltaRGB: [sig(sR), sig(sG), sig(sB)],
      RoverG: sig(sG !== 0 ? sR/sG : null),
      RoverB: sig(sB !== 0 ? sR/sB : null),
      darkPopulation:   { RGB: [sig(Dr), sig(Dg), sig(Db)], L: sig(Dl), n: dn },
      brightPopulation: { RGB: [sig(Br), sig(Bg), sig(Bb)], L: sig(Bl), n: bn },
      note: "Colour of the STRUCTURE, not the sky: bright minus dark population, split by luminance, stars excluded. Compare RoverG/RoverB across pipeline stages; a drop toward or below 1.0 on an Ha field means red structure is being neutralized. Region MEDIANS cannot see this."
    },
    spatialChroma: {
      medianSaturation: sig(median(satAll)),
      pctExactlyAchromatic: sig(100*nExact/nAll),
      tileGrid: TG,
      minTileSaturation: sig(minT),
      maxTileSaturation: sig(maxT),
      minTileIndex: minTi,
      minTileRowCol: minTi < 0 ? null : [Math.floor(minTi/TG), minTi%TG],
      tileMedianSaturation: tileSat,
      note: "Per-tile, because a scalar bgChroma cannot see localized chroma death (it averages deleted colour with retained colour). A minTileSaturation near zero, or pctExactlyAchromatic above ~1%, means an operation zeroed chroma in patches. NOTE: 8-bit sources make pctExactlyAchromatic quantization-limited; on float data it is exact."
    }
  });
})();
}

function pjsrRender(viewId, outputPath, stf, rect, downsample, quality) {
  return (function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var v = View.viewById(viewId);
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + viewId});
  var src = v.image;
  var warnings = [];
  var mode = stf;
  var mtf = function(m, x){ if (x <= 0) return 0; if (x >= 1) return 1; return ((m - 1)*x)/(((2*m - 1)*x) - m); };

  // Stretch parameters from the FULL image (crops share the full-field stretch).
  var htRows = null; // [[c0,m,c1] per HT row index]
  if (mode === "auto") {
    var meds = [], mads = [];
    var nch = Math.min(src.numberOfChannels, 3);
    for (var c = 0; c < nch; ++c) {
      src.selectedChannel = c;
      meds.push(src.median()); mads.push(src.MAD());
    }
    src.resetSelections();
    var med = 0, mad = 0;
    for (var c = 0; c < nch; ++c) { med += meds[c]/nch; mad += mads[c]/nch; }
    if (med < 2*1.4826*mad) {
      warnings.push("degenerate-median (med " + sig(med) + " < 2x1.4826xMAD " + sig(1.4826*mad) + ", mostly-empty layer): autostretch clamped to gentle fixed MTF - prefer stf:'asis' or render the recombined view; never judge a star layer on 'auto'");
      htRows = { 3: [0, 0.01, 1] };
    } else {
      var c0 = Math.max(0, Math.min(1, med - 2.8*1.4826*mad));
      var m = mtf(0.25, med - c0);
      htRows = { 3: [c0, m, 1] };
    }
  } else if (mode === "view") {
    var s = v.stf; // rows [m, c0, c1, r0, r1]
    var identity = true;
    for (var c = 0; c < 3; ++c)
      if (Math.abs(s[c][0] - 0.5) > 1e-6 || Math.abs(s[c][1]) > 1e-6 || Math.abs(s[c][2] - 1) > 1e-6) identity = false;
    if (identity) {
      warnings.push("view has no STF set - rendering as-is");
    } else {
      htRows = { 0: [s[0][1], s[0][0], s[0][2]], 1: [s[1][1], s[1][0], s[1][2]], 2: [s[2][1], s[2][0], s[2][2]] };
    }
  }

  // Temp hidden window; assign honors the source selectedRect (crop at copy).
  var r = rect;
  var x0 = 0, y0 = 0, x1 = src.width, y1 = src.height;
  if (r) {
    x0 = Math.max(0, Math.min(src.width - 1, Math.round(r[0])));
    y0 = Math.max(0, Math.min(src.height - 1, Math.round(r[1])));
    x1 = Math.max(x0 + 1, Math.min(src.width, Math.round(r[2])));
    y1 = Math.max(y0 + 1, Math.min(src.height, Math.round(r[3])));
  }
  var tmpId = "mcp_render_tmp";
  var ex = ImageWindow.windowById(tmpId);
  if (!ex.isNull) ex.forceClose();
  var tw = new ImageWindow(x1 - x0, y1 - y0, src.numberOfChannels, 32, true, src.isColor, tmpId);
  var tv = tw.mainView;
  tv.beginProcess();
  if (r) src.selectedRect = new Rect(x0, y0, x1, y1);
  tv.image.assign(src);
  src.resetSelections();
  tv.endProcess();

  try {
    if (htRows) {
      var P = new HistogramTransformation;
      var H = [[0,0.5,1,0,1],[0,0.5,1,0,1],[0,0.5,1,0,1],[0,0.5,1,0,1],[0,0.5,1,0,1]];
      for (var row in htRows) {
        var t = htRows[row];
        H[row|0] = [t[0], t[1], t[2], 0, 1];
      }
      P.H = H;
      P.executeOn(tv, false);
    }
    var dsf = downsample;
    if (dsf > 1) {
      var IR = new IntegerResample;
      IR.zoomFactor = -dsf;
      IR.executeOn(tv, false);
    }
    var bmp = tv.image.render();
    bmp.save(outputPath, quality);
    var ow = tv.image.width, oh = tv.image.height;
  } finally {
    tw.forceClose();
  }
  return JSON.stringify({ viewId: viewId, path: outputPath, width: ow, height: oh,
    stfMode: mode, stfApplied: !!htRows,
    stretch: htRows ? htRows : null,
    sourceRect: [x0, y0, x1, y1], downsample: downsample || 1,
    warnings: warnings });
})();
}

function pjsrDims(viewId) {
  return (function(){
  var v = View.viewById(viewId);
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + viewId});
  var img = v.image;
  return JSON.stringify({ viewId: viewId, width: img.width, height: img.height, isColor: img.isColor, channels: img.numberOfChannels });
})();
}

function compositeResult(json) {
   var parsed = JSON.parse(json);
   if (parsed && parsed.error) throw new Error(parsed.error);
   return { status: "success", outputs: { result: parsed }, message: "" };
}

function optionalRect(rect) {
   if (rect === null || rect === undefined) return null;
   if (!(rect instanceof Array) || rect.length !== 4) throw new Error("rect must be [x0, y0, x1, y1]");
   return rect.map(Number);
}

function handleGetNoise(command) {
   var p = command.parameters || {};
   return compositeResult(pjsrNoise(String(p.viewId)));
}

function handleGetBackgroundGradient(command) {
   var p = command.parameters || {};
   return compositeResult(pjsrGradient(String(p.viewId), Math.trunc(Number(p.gridSize)), Number(p.boxFraction)));
}

function handleGetBackgroundNeutrality(command) {
   var p = command.parameters || {};
   var signalIndex = { R: 0, G: 1, B: 2 }[p.signalChannel];
   if (signalIndex === undefined) throw new Error("signalChannel must be R, G or B");
   return compositeResult(pjsrNeutrality(String(p.viewId), String(p.mode), p.signalChannel, signalIndex,
                                         Math.trunc(Number(p.targetSamples))));
}

function handleGetStarMetrics(command) {
   var p = command.parameters || {};
   return compositeResult(pjsrStars(String(p.viewId), Math.trunc(Number(p.maxStars))));
}

function handleGetStructureColor(command) {
   var p = command.parameters || {};
   return compositeResult(pjsrStructureColor(String(p.viewId), optionalRect(p.rect),
                                             Math.trunc(Number(p.tileGrid)), Math.trunc(Number(p.targetSamples))));
}

function handleRenderView(command) {
   var p = command.parameters || {};
   var downsample = Number(p.downsample) > 1 ? Math.trunc(Number(p.downsample)) : 0;
   var quality = Number(p.quality) > 0 ? Math.min(100, Math.trunc(Number(p.quality))) : 100;
   return compositeResult(pjsrRender(String(p.viewId), String(p.outputPath), String(p.stf),
                                     optionalRect(p.rect), downsample, quality));
}

function handleGetViewDimensions(command) {
   var p = command.parameters || {};
   return compositeResult(pjsrDims(String(p.viewId)));
}

// ============================================================================
// Recipes
// ----------------------------------------------------------------------------
// Entry functions of the recipe scripts embedded with these handlers. Only
// these names can be called, with JSON arguments.
// ============================================================================

var RECIPE_ENTRY_POINTS = ["OSC_RGB_LINEAR", "CROP_EXTENT", "CROP_SELECT", "runFiles"];

function handleRunRecipe(command) {
   var parameters = command.parameters || {};
   var name = String(parameters.name);
   if (RECIPE_ENTRY_POINTS.indexOf(name) < 0)
      throw new Error("Unknown recipe: " + name + " (known: " + RECIPE_ENTRY_POINTS.join(", ") + ")");
   var entry = globalThis[name];
   if (typeof entry !== "function") throw new Error("Recipe " + name + " is not loaded");
   var args = parameters.args instanceof Array ? parameters.args : [];
   var value = entry.apply(null, args);
   var result = value;
   if (typeof value === "string") {
      try { result = JSON.parse(value); } catch (parseError) { result = value; }
   }
   return { status: "success", outputs: { result: result }, message: name + " finished" };
}

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

   // Measurement and rendering
   if (tool === "get_noise") return handleGetNoise(command);
   if (tool === "get_background_gradient") return handleGetBackgroundGradient(command);
   if (tool === "get_background_neutrality") return handleGetBackgroundNeutrality(command);
   if (tool === "get_star_metrics") return handleGetStarMetrics(command);
   if (tool === "get_structure_color") return handleGetStructureColor(command);
   if (tool === "render_view") return handleRenderView(command);
   if (tool === "get_view_dimensions") return handleGetViewDimensions(command);

   // Recipes
   if (tool === "run_recipe") return handleRunRecipe(command);

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

// Heartbeat, mirrors the native module (BridgePoller::WriteHeartbeat). The MCP
// server reads bridge/heartbeat.json's mtime to auto-detect which instances are
// live; the JSON payload is identity only. Written directly, mtime is the signal.
function writeHeartbeat() {
   try {
      var hb = "{\"slot\":" + BRIDGE_SLOT
             + ",\"pid\":" + CoreApplication.pid
             + ",\"version\":\"" + WATCHER_VERSION + "\"}";
      File.writeTextFile(BRIDGE_DIR + "/heartbeat.json", hb);
   } catch (e) {}
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
   var lastHeartbeat = 0;

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

      // Refresh heartbeat ~every 2 s (server auto-detect signal).
      if (Date.now() - lastHeartbeat >= 2000) {
         writeHeartbeat();
         lastHeartbeat = Date.now();
      }

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

   deleteFile(BRIDGE_DIR + "/heartbeat.json");   // signal "down" immediately
   console.noteln("[MCP Watcher] Stopped. Processed " + commandCount + " command(s).");
}

// ============================================================================
// Entry Point
// ============================================================================

runWatcher();
