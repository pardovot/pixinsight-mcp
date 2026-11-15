// render_view: an optionally stretched, cropped and downsampled PNG or JPEG of a view.

// Auto stretch, the screen transfer function's formula: shadows clipped 2.8 MAD sigmas below the
// median, midtones set so the background lands at 0.25.
var AUTO_SHADOWS_SIGMAS = 2.8;
var AUTO_TARGET_BACKGROUND = 0.25;
// A median below this many MAD sigmas is a mostly empty layer (a stars only image), where the
// formula above blows up. Those get a gentle fixed midtones value instead.
var DEGENERATE_MEDIAN_SIGMAS = 2;
var DEGENERATE_MIDTONES = 0.01;
// HistogramTransformation rows are R, G, B, combined RGB/K, and alpha.
var HISTOGRAM_ROWS = 5;
var COMBINED_ROW = 3;
var IDENTITY_ROW = [0, 0.5, 1, 0, 1];
var RENDER_WINDOW_ID = "mcp_render_tmp";
// A view STF row within this of [0.5, 0, 1] counts as no STF.
var STF_IDENTITY_TOLERANCE = 1e-6;
var MAX_QUALITY = 100;

function midtonesTransfer(midtones, value) {
   if (value <= 0)
      return 0;
   if (value >= 1)
      return 1;
   return ((midtones - 1) * value) / (((2 * midtones - 1) * value) - midtones);
}

// The stretch for each HistogramTransformation row as [shadows, midtones, highlights], or null
// to render as is. Computed on the full image, so a crop shares the full field stretch.
function renderStretch(view, mode, warnings) {
   var image = view.image;
   if (mode === "auto") {
      var channelCount = measuredChannelCount(image);
      var medians = [];
      var deviations = [];
      try {
         for (var channel = 0; channel < channelCount; ++channel) {
            image.selectedChannel = channel;
            medians.push(image.median());
            deviations.push(image.MAD());
         }
      } finally {
         image.resetSelections();
      }
      var background = 0;
      var deviation = 0;
      for (var channel = 0; channel < channelCount; ++channel) {
         background += medians[channel] / channelCount;
         deviation += deviations[channel] / channelCount;
      }
      var stretch = {};
      if (background < DEGENERATE_MEDIAN_SIGMAS * MAD_TO_SIGMA * deviation) {
         warnings.push("degenerate median: " + significant(background) + " is under " + DEGENERATE_MEDIAN_SIGMAS +
                       " MAD sigmas (" + significant(DEGENERATE_MEDIAN_SIGMAS * MAD_TO_SIGMA * deviation) +
                       "), a mostly empty layer, so the autostretch is clamped to a gentle fixed midtones value. " +
                       "Prefer stf:'asis' or render the recombined view, and never judge a star layer on 'auto'");
         stretch[COMBINED_ROW] = [0, DEGENERATE_MIDTONES, 1];
      } else {
         var shadows = Math.max(0, Math.min(1, background - AUTO_SHADOWS_SIGMAS * MAD_TO_SIGMA * deviation));
         stretch[COMBINED_ROW] = [shadows, midtonesTransfer(AUTO_TARGET_BACKGROUND, background - shadows), 1];
      }
      return stretch;
   }
   if (mode === "view") {
      // view.stf rows are [midtones, shadows, highlights, low range, high range], one per channel.
      // A mono view keeps its STF in the first row, and HistogramTransformation stretches a mono
      // image by the combined row alone.
      var stf = view.stf;
      var viewStretch = {};
      var identity = true;
      for (var stfRow = 0; stfRow < measuredChannelCount(image); ++stfRow) {
         var midtones = stf[stfRow][0];
         var shadowsClip = stf[stfRow][1];
         var highlightsClip = stf[stfRow][2];
         if (Math.abs(midtones - 0.5) > STF_IDENTITY_TOLERANCE || Math.abs(shadowsClip) > STF_IDENTITY_TOLERANCE ||
             Math.abs(highlightsClip - 1) > STF_IDENTITY_TOLERANCE)
            identity = false;
         viewStretch[image.isColor ? stfRow : COMBINED_ROW] = [shadowsClip, midtones, highlightsClip];
      }
      if (identity) {
         warnings.push("view has no STF set, rendering as is");
         return null;
      }
      return viewStretch;
   }
   return null;
}

function renderRegion(image, rect) {
   if (!rect)
      return { left: 0, top: 0, right: image.width, bottom: image.height };
   var left = Math.max(0, Math.min(image.width - 1, Math.round(rect[0])));
   var top = Math.max(0, Math.min(image.height - 1, Math.round(rect[1])));
   return {
      left: left,
      top: top,
      right: Math.max(left + 1, Math.min(image.width, Math.round(rect[2]))),
      bottom: Math.max(top + 1, Math.min(image.height, Math.round(rect[3])))
   };
}

function renderView(view, outputPath, mode, rect, downsample, quality) {
   var source = view.image;
   var warnings = [];
   var stretch = renderStretch(view, mode, warnings);
   var region = renderRegion(source, rect);

   // A hidden float copy of the region, so the view itself is never touched. assign copies only
   // the source's selected rectangle.
   var existing = ImageWindow.windowById(RENDER_WINDOW_ID);
   if (!existing.isNull)
      existing.forceClose();
   var renderWindow = new ImageWindow(region.right - region.left, region.bottom - region.top,
                                source.numberOfChannels, 32, true, source.isColor, RENDER_WINDOW_ID);
   var copy = renderWindow.mainView;
   var width, height;
   try {
      copy.beginProcess();
      try {
         if (rect)
            source.selectedRect = new Rect(region.left, region.top, region.right, region.bottom);
         copy.image.assign(source);
      } finally {
         source.resetSelections();
         copy.endProcess();
      }
      if (stretch) {
         var transformation = new HistogramTransformation();
         var rows = [];
         for (var row = 0; row < HISTOGRAM_ROWS; ++row)
            rows.push(IDENTITY_ROW.slice());
         for (var stretchRow in stretch)
            rows[Number(stretchRow)] = [stretch[stretchRow][0], stretch[stretchRow][1], stretch[stretchRow][2], 0, 1];
         transformation.H = rows;
         transformation.executeOn(copy, false);
      }
      if (downsample > 1) {
         var resample = new IntegerResample();
         resample.zoomFactor = -downsample;
         resample.executeOn(copy, false);
      }
      copy.image.render().save(outputPath, quality);
      width = copy.image.width;
      height = copy.image.height;
   } finally {
      renderWindow.forceClose();
   }
   return {
      viewId: view.id, path: outputPath, width: width, height: height,
      stfMode: mode, stfApplied: !!stretch, stretch: stretch,
      sourceRect: [region.left, region.top, region.right, region.bottom],
      downsample: downsample || 1,
      warnings: warnings
   };
}

function handleRenderView(command) {
   var parameters = command.parameters;
   var view = requireView(parameters.viewId);
   var downsample = Number(parameters.downsample) > 1 ? Math.trunc(Number(parameters.downsample)) : 0;
   var quality = Number(parameters.quality) > 0 ? Math.min(MAX_QUALITY, Math.trunc(Number(parameters.quality))) : MAX_QUALITY;
   var result = renderView(view, String(parameters.outputPath), String(parameters.stf),
                           optionalRect(parameters.rect), downsample, quality);
   return success(result, "Rendered " + view.id + " to " + result.path);
}
