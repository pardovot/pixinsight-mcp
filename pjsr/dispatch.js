// Routes a bridge command to its handler. The MCP server sends verbs and data, never code.

// Commands older than this are refused. The MCP server abandons a command after its timeout,
// and PixInsight runs queued requests only when its main thread is free, so a save or close
// could otherwise fire long after the session that sent it gave up. Matches STALE_FILE_MS in
// src/bridge/client.ts.
var STALE_COMMAND_MS = 10 * 60 * 1000;
var MS_PER_MINUTE = 60 * 1000;

var ROUTES = {
   list_open_images: handleListOpenImages,
   open_image: handleOpenImage,
   save_image: handleSaveImage,
   close_image: handleCloseImage,
   get_image_statistics: handleGetImageStatistics,
   run_process: handleRunProcess,
   get_process_parameters: handleGetProcessParameters,
   get_history: handleGetHistory,
   get_full_history: handleGetFullHistory,
   undo: handleUndo,
   redo: handleRedo,
   snapshot: handleSnapshot,
   restore: handleRestore,
   get_noise: handleGetNoise,
   get_background_gradient: handleGetBackgroundGradient,
   get_background_neutrality: handleGetBackgroundNeutrality,
   get_star_metrics: handleGetStarMetrics,
   get_structure_color: handleGetStructureColor
};

function dispatchCommand(command) {
   if (command.timestamp) {
      var age = Date.now() - Date.parse(command.timestamp);
      if (isFinite(age) && age > STALE_COMMAND_MS)
         throw new Error("Stale command refused (queued " + Math.round(age / MS_PER_MINUTE) +
                         " min ago, limit " + (STALE_COMMAND_MS / MS_PER_MINUTE) + "), " +
                         "its client is gone, re-issue the command if still wanted.");
   }
   if (!command.parameters)
      command.parameters = {};
   if (!Object.prototype.hasOwnProperty.call(ROUTES, command.tool))
      throw new Error("Unknown tool: " + command.tool);
   var result = ROUTES[command.tool](command);
   if (!result.outputs)
      result.outputs = {};
   return result;
}
