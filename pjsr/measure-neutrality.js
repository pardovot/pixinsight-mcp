// get_background_neutrality: background color balance, measured differently before and after a
// stretch.

// Linear mode measures the pixels within this fraction of the median luminance.
var NEUTRAL_LUMINANCE_BAND = 0.08;
// Post stretch, a pixel whose signal channel exceeds the mean of the other two by less than this
// is near neutral background.
var NEAR_NEUTRAL_EXCESS = 0.01;
// Signal excess ranges that classify a pixel as faint or bright signal.
var FAINT_EXCESS_MIN = 0.02;
var FAINT_EXCESS_MAX = 0.05;

var SIGNAL_CHANNELS = { R: 0, G: 1, B: 2 };

// RGB samples on a regular grid with about `targetSamples` points.
function sampleColorGrid(image, targetSamples) {
   var width = image.width;
   var height = image.height;
   var stride = Math.max(1, Math.floor(Math.sqrt(width * height / targetSamples)));
   var samples = [[], [], []];
   var row = [];
   try {
      for (var y = 0; y < height; y += stride)
         for (var channel = 0; channel < 3; ++channel) {
            readSamples(image, channel, 0, y, width, y + 1, row);
            for (var x = 0; x < width; x += stride)
               samples[channel].push(row[x]);
         }
   } finally {
      image.resetSelections();
   }
   return { reds: samples[0], greens: samples[1], blues: samples[2], stride: stride };
}

function linearNeutrality(viewId, grid) {
   var count = grid.reds.length;
   var luminance = new Array(count);
   for (var index = 0; index < count; ++index)
      luminance[index] = (grid.reds[index] + grid.greens[index] + grid.blues[index]) / 3;
   var luminanceMedian = median(luminance);
   var band = [[], [], []];
   for (var index = 0; index < count; ++index)
      if (Math.abs(luminance[index] - luminanceMedian) <= NEUTRAL_LUMINANCE_BAND * luminanceMedian) {
         band[0].push(grid.reds[index]);
         band[1].push(grid.greens[index]);
         band[2].push(grid.blues[index]);
      }
   var red = median(band[0]);
   var green = median(band[1]);
   var blue = median(band[2]);
   var highest = Math.max(red, green, blue);
   var lowest = Math.min(red, green, blue);
   var average = (red + green + blue) / 3;
   return {
      viewId: viewId, mode: "linear", samples: count, stride: grid.stride,
      luminanceMedian: significant(luminanceMedian), luminanceBand: NEUTRAL_LUMINANCE_BAND, bandCount: band[0].length,
      perChannelMedian: { R: significant(red), G: significant(green), B: significant(blue) },
      spreadPct: significant(average > 0 ? 100 * (highest - lowest) / average : null),
      note: "spreadPct <= 1 is neutral. Valid before a stretch only, use mode:poststretch after one."
   };
}

function poststretchNeutrality(viewId, grid, signalChannel) {
   var signalIndex = SIGNAL_CHANNELS[signalChannel];
   var near = [[], [], []];
   var nearSaturation = [];
   var faint = [];
   var bright = [];
   for (var index = 0; index < grid.reds.length; ++index) {
      var pixel = [grid.reds[index], grid.greens[index], grid.blues[index]];
      var signal = pixel[signalIndex];
      var others = (pixel[0] + pixel[1] + pixel[2] - signal) / 2;
      var excess = signal - others;
      if (Math.abs(excess) < NEAR_NEUTRAL_EXCESS) {
         near[0].push(pixel[0]);
         near[1].push(pixel[1]);
         near[2].push(pixel[2]);
         var highest = Math.max(pixel[0], pixel[1], pixel[2]);
         var lowest = Math.min(pixel[0], pixel[1], pixel[2]);
         if (highest > 0)
            nearSaturation.push((highest - lowest) / highest);
      } else if (excess >= FAINT_EXCESS_MIN && excess <= FAINT_EXCESS_MAX) {
         faint.push(signal);
      } else if (excess > FAINT_EXCESS_MAX) {
         bright.push(signal);
      }
   }
   var saturationMean = null;
   if (nearSaturation.length) {
      var total = 0;
      for (var index = 0; index < nearSaturation.length; ++index)
         total += nearSaturation[index];
      saturationMean = total / nearSaturation.length;
   }
   return {
      viewId: viewId, mode: "poststretch", signalChannel: signalChannel, samples: grid.reds.length,
      stride: grid.stride,
      excessLimits: { nearNeutral: NEAR_NEUTRAL_EXCESS, faint: [FAINT_EXCESS_MIN, FAINT_EXCESS_MAX] },
      nearNeutral: {
         count: near[0].length,
         perChannelMedian: { R: significant(median(near[0])), G: significant(median(near[1])), B: significant(median(near[2])) },
         bgChroma: significant(saturationMean)
      },
      faint: { count: faint.length, signalMedian: significant(median(faint)) },
      bright: { count: bright.length, signalMedian: significant(median(bright)) },
      note: "bgChroma tracks neutrality after a stretch. Compare the faint and bright signalMedian across before and after calls " +
            "for the preservation ratio, about 100% is preserved."
   };
}

function handleGetBackgroundNeutrality(command) {
   var parameters = command.parameters;
   if (!Object.prototype.hasOwnProperty.call(SIGNAL_CHANNELS, parameters.signalChannel))
      throw new Error("signalChannel must be R, G or B");
   var view = requireView(parameters.viewId);
   requireColor(view.image, "get_background_neutrality");
   var grid = sampleColorGrid(view.image, Math.trunc(Number(parameters.targetSamples)));
   var result = parameters.mode === "linear"
      ? linearNeutrality(view.id, grid)
      : poststretchNeutrality(view.id, grid, parameters.signalChannel);
   return success(result, view.id + ": " + result.mode + " neutrality");
}
