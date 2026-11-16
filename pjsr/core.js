// Shared helpers for the bridge handlers, which run inside PixInsight 1.9.4+.
//
// scripts/build-pjsr-bundle.mjs joins the files in pjsr/ into build/pjsr/mcp-handlers.js. For each
// command the MCP server writes a short driver script that includes the bundle and calls
// dispatchCommand (pjsr/dispatch.js), and PixInsight runs it in the user's session. Drivers run on
// the legacy engine, except a Script run of a script that declares #engine v8, so the bundle is
// written for both.

// The legacy engine does not define globalThis, so the global object is captured here. Process
// classes are looked up on it by name.
var GLOBAL_SCOPE = Function("return this")();

// A main view or a preview, by id. Every handler that takes a viewId goes through here, so a
// missing view always fails with the same message.
function requireView(viewId) {
   var view = View.viewById(String(viewId || ""));
   if (!view || view.isNull)
      throw new Error("No open view named " + viewId);
   return view;
}

// The folder a file is about to be written in must exist: a writer that finds none shows a modal
// error, which holds every later command until someone closes it.
function requireFolderOf(filePath) {
   var folder = File.extractDrive(filePath) + File.extractDirectory(filePath);
   if (!File.directoryExists(folder))
      throw new Error("No such folder: " + folder);
}

function success(outputs, message) {
   return { status: "success", outputs: outputs, message: message };
}
