// Shared helpers for the bridge handlers, which run inside PixInsight (V8 PJSR, 1.9.4+).
//
// scripts/build-pjsr-bundle.mjs joins the files in pjsr/ into build/pjsr/mcp-handlers.js. For each
// command the MCP server writes a short driver script that includes the bundle and calls
// dispatchCommand (pjsr/dispatch.js), and PixInsight runs it in the user's session.

// PixInsight's V8 build does not define globalThis, so the global object is captured here.
// Process classes are looked up on it by name.
var GLOBAL_SCOPE = Function("return this")();

// A main view or a preview, by id. Every handler that takes a viewId goes through here, so a
// missing view always fails with the same message.
function requireView(viewId) {
   var view = View.viewById(String(viewId || ""));
   if (!view || view.isNull)
      throw new Error("No open view named " + viewId);
   return view;
}

function success(outputs, message) {
   return { status: "success", outputs: outputs, message: message };
}
