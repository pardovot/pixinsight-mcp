// Helpers shared by the measurement and render verbs.

// Reported values keep six significant figures. Linear data has channel differences around 1e-5
// and grain around 1e-6, which a fixed number of decimals rounds to zero.
var SIGNIFICANT_DIGITS = 6;

// Scales a median absolute deviation to a Gaussian standard deviation.
var MAD_TO_SIGMA = 1.4826;

function significant(value) {
   return (typeof value === "number" && isFinite(value)) ? Number(value.toPrecision(SIGNIFICANT_DIGITS)) : value;
}

function median(values) {
   if (!values.length)
      return null;
   var sorted = values.slice().sort(function (left, right) { return left - right; });
   var middle = sorted.length >> 1;
   return (sorted.length % 2) ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Color images are measured on their first three channels, an alpha channel is ignored.
function measuredChannelCount(image) {
   return Math.min(image.numberOfChannels, 3);
}

function shortChannelName(image, channel) {
   var names = image.isColor ? ["R", "G", "B"] : ["K"];
   return names[channel] || "C" + channel;
}

// noiseMRS returns [sigma, sample count] or, on some images, sigma alone.
function noiseEstimate(image) {
   var estimate = image.noiseMRS();
   if (estimate && typeof estimate === "object" && estimate.length !== undefined)
      return { sigma: estimate[0], samples: estimate.length > 1 ? estimate[1] : null };
   return { sigma: estimate, samples: null };
}

// Reads one channel of a pixel rectangle into `buffer`, row major.
function readSamples(image, channel, left, top, right, bottom, buffer) {
   image.selectedChannel = channel;
   image.selectedRect = new Rect(left, top, right, bottom);
   image.getSamples(buffer);
}

function optionalRect(rect) {
   if (rect === null || rect === undefined)
      return null;
   if (!(rect instanceof Array) || rect.length !== 4)
      throw new Error("rect must be [x0, y0, x1, y1]");
   return rect.map(Number);
}

function requireColor(image, tool) {
   if (!image.isColor)
      throw new Error(tool + " requires a color image");
}
