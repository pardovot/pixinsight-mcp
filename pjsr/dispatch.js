// Routes a bridge command to its handler. The MCP server sends verbs and data, never code.

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
   get_structure_color: handleGetStructureColor,
   render_view: handleRenderView,
   export_container: handleExportContainer,
   run_script: handleRunScript
};

function dispatchCommand(command) {
   if (!command.parameters)
      command.parameters = {};
   if (!Object.prototype.hasOwnProperty.call(ROUTES, command.tool))
      throw new Error("Unknown tool: " + command.tool);
   var result = ROUTES[command.tool](command);
   if (!result.outputs)
      result.outputs = {};
   return result;
}
