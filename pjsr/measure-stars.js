// get_star_metrics: star count, FWHM and eccentricity from image moments, and the median star
// pixel level. Comparison stable between calls on one image, not photometric.

// Detection threshold: the MAD term, floored by the MRS noise term. On a stars only layer the
// median and MAD are about zero, and without the noise floor every noise bump is a candidate.
var THRESHOLD_MAD_SIGMAS = 10;
var THRESHOLD_NOISE_SIGMAS = 30;
// A sparse stars only layer still yields tens of thousands of faint maxima. When a scan reaches
// the cap the threshold rises by the factor and the scan repeats, so counts stay deterministic.
var CANDIDATE_CAP = 50000;
var THRESHOLD_ESCALATION = 4;
var MAX_ESCALATIONS = 8;
// Detection scans every second row.
var DETECTION_ROW_STEP = 2;
// Maxima closer than this (pixels) belong to one star.
var MIN_STAR_SEPARATION = 15;
// Half size of the window a star's moments are measured in.
var STAR_WINDOW_RADIUS = 12;
// A peak above this is saturated, and its flat top corrupts the moments.
var SATURATED_PEAK = 0.998;
// FWHM of a Gaussian in units of its standard deviation.
var FWHM_PER_SIGMA = 2.3548;
var BRIGHTEST_REPORTED = 5;
// Star pixel median: grid samples whose brightest channel exceeds the level.
var STAR_PIXEL_LEVEL = 0.005;
var STAR_PIXEL_SAMPLES = 250000;

function detectionThreshold(image, channel) {
   image.selectedChannel = channel;
   var background = image.median();
   var deviation = image.MAD();
   var sigma = noiseEstimate(image).sigma;
   image.resetSelections();
   if (!isFinite(sigma) || sigma <= 0)
      sigma = MAD_TO_SIGMA * deviation;
   return background + Math.max(THRESHOLD_MAD_SIGMAS * MAD_TO_SIGMA * deviation, THRESHOLD_NOISE_SIGMAS * sigma);
}

// Local maxima along rows, brightest first.
function findCandidates(image, channel, threshold) {
   var width = image.width;
   var candidates = [];
   var row = [];
   var escalations = 0;
   for (;;) {
      candidates.length = 0;
      var capped = false;
      for (var y = 0; y < image.height && !capped; y += DETECTION_ROW_STEP) {
         readSamples(image, channel, 0, y, width, y + 1, row);
         for (var x = 1; x < width - 1; ++x) {
            var value = row[x];
            if (value > threshold && value >= row[x - 1] && value >= row[x + 1]) {
               candidates.push({ x: x, y: y, value: value });
               if (candidates.length >= CANDIDATE_CAP) {
                  capped = true;
                  break;
               }
            }
         }
      }
      if (!capped || escalations >= MAX_ESCALATIONS)
         break;
      threshold *= THRESHOLD_ESCALATION;
      ++escalations;
   }
   image.resetSelections();
   candidates.sort(function (left, right) { return right.value - left.value; });
   return { candidates: candidates, threshold: threshold, escalations: escalations,
            capped: candidates.length >= CANDIDATE_CAP };
}

// Greedy separation in brightness order, through a hash of MIN_STAR_SEPARATION sized cells.
function separateStars(candidates) {
   var cells = {};
   var stars = [];
   var cellKey = function (cellX, cellY) { return cellX + "," + cellY; };
   var minDistanceSquared = MIN_STAR_SEPARATION * MIN_STAR_SEPARATION;
   for (var index = 0; index < candidates.length; ++index) {
      var candidate = candidates[index];
      var cellX = Math.floor(candidate.x / MIN_STAR_SEPARATION);
      var cellY = Math.floor(candidate.y / MIN_STAR_SEPARATION);
      var clash = false;
      for (var offsetY = -1; offsetY <= 1 && !clash; ++offsetY)
         for (var offsetX = -1; offsetX <= 1 && !clash; ++offsetX) {
            var neighbours = cells[cellKey(cellX + offsetX, cellY + offsetY)];
            if (!neighbours)
               continue;
            for (var other = 0; other < neighbours.length; ++other) {
               var deltaX = neighbours[other].x - candidate.x;
               var deltaY = neighbours[other].y - candidate.y;
               if (deltaX * deltaX + deltaY * deltaY < minDistanceSquared) {
                  clash = true;
                  break;
               }
            }
         }
      if (!clash) {
         var key = cellKey(cellX, cellY);
         (cells[key] = cells[key] || []).push(candidate);
         stars.push(candidate);
      }
   }
   return stars;
}

// Background subtracted second moments of each star window.
function measureStarShapes(image, channel, stars, maxStars) {
   var fwhms = [];
   var eccentricities = [];
   var brightest = [];
   var measured = 0;
   var count = Math.min(stars.length, maxStars);
   for (var index = 0; index < count; ++index) {
      var star = stars[index];
      var left = Math.max(0, star.x - STAR_WINDOW_RADIUS);
      var top = Math.max(0, star.y - STAR_WINDOW_RADIUS);
      var right = Math.min(image.width, star.x + STAR_WINDOW_RADIUS + 1);
      var bottom = Math.min(image.height, star.y + STAR_WINDOW_RADIUS + 1);
      var windowWidth = right - left;
      var windowHeight = bottom - top;
      var pixels = [];
      readSamples(image, channel, left, top, right, bottom, pixels);

      // The detection row may miss the true peak, which is searched for in the window.
      var peak = -1;
      var peakX = star.x;
      var peakY = star.y;
      for (var row = 0; row < windowHeight; ++row)
         for (var column = 0; column < windowWidth; ++column) {
            var value = pixels[row * windowWidth + column];
            if (value > peak) {
               peak = value;
               peakX = left + column;
               peakY = top + row;
            }
         }
      if (brightest.length < BRIGHTEST_REPORTED)
         brightest.push({ x: peakX, y: peakY, peak: significant(peak) });
      if (peak > SATURATED_PEAK)
         continue;

      // Background: median of the window's border.
      var border = [];
      for (var column = 0; column < windowWidth; ++column) {
         border.push(pixels[column]);
         border.push(pixels[(windowHeight - 1) * windowWidth + column]);
      }
      for (var row = 1; row < windowHeight - 1; ++row) {
         border.push(pixels[row * windowWidth]);
         border.push(pixels[row * windowWidth + windowWidth - 1]);
      }
      var background = median(border);

      var flux = 0, sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
      for (var row = 0; row < windowHeight; ++row)
         for (var column = 0; column < windowWidth; ++column) {
            var signal = pixels[row * windowWidth + column] - background;
            if (signal <= 0)
               continue;
            flux += signal;
            sumX += signal * column;
            sumY += signal * row;
            sumXX += signal * column * column;
            sumYY += signal * row * row;
            sumXY += signal * column * row;
         }
      if (flux <= 0)
         continue;
      var meanX = sumX / flux;
      var meanY = sumY / flux;
      var varianceX = sumXX / flux - meanX * meanX;
      var varianceY = sumYY / flux - meanY * meanY;
      var covariance = sumXY / flux - meanX * meanY;
      if (varianceX <= 0 || varianceY <= 0)
         continue;
      fwhms.push(FWHM_PER_SIGMA * Math.sqrt((varianceX + varianceY) / 2));
      // Eccentricity from the eigenvalues of the covariance matrix.
      var halfTrace = (varianceX + varianceY) / 2;
      var spread = Math.sqrt(((varianceX - varianceY) / 2) * ((varianceX - varianceY) / 2) + covariance * covariance);
      var major = halfTrace + spread;
      var minor = halfTrace - spread;
      if (major > 0 && minor > 0)
         eccentricities.push(Math.sqrt(1 - minor / major));
      ++measured;
   }
   image.resetSelections();
   return { fwhms: fwhms, eccentricities: eccentricities, brightest: brightest, measured: measured };
}

function starPixelLevels(image) {
   var stride = Math.max(2, Math.floor(Math.sqrt(image.width * image.height / STAR_PIXEL_SAMPLES)));
   var levels = [];
   var rows = [[], [], []];
   var channelCount = image.isColor ? 3 : 1;
   for (var y = 0; y < image.height; y += stride) {
      for (var channel = 0; channel < channelCount; ++channel)
         readSamples(image, channel, 0, y, image.width, y + 1, rows[channel]);
      for (var x = 0; x < image.width; x += stride) {
         var level = image.isColor ? Math.max(rows[0][x], rows[1][x], rows[2][x]) : rows[0][x];
         if (level > STAR_PIXEL_LEVEL)
            levels.push(level);
      }
   }
   image.resetSelections();
   return levels;
}

function handleGetStarMetrics(command) {
   var view = requireView(command.parameters.viewId);
   var image = view.image;
   // Detection runs on green in color images: every star is present there, and it avoids the
   // noise extremes of the sparser red and blue Bayer channels.
   var channel = image.isColor ? 1 : 0;
   var detection, stars, shapes, levels;
   try {
      detection = findCandidates(image, channel, detectionThreshold(image, channel));
      stars = separateStars(detection.candidates);
      shapes = measureStarShapes(image, channel, stars, Math.trunc(Number(command.parameters.maxStars)));
      levels = starPixelLevels(image);
   } finally {
      image.resetSelections();
   }
   return success({
      viewId: view.id,
      starCount: stars.length,
      candidatesCapped: detection.capped,
      thresholdEscalations: detection.escalations,
      measured: shapes.measured,
      threshold: significant(detection.threshold),
      medianFWHM: significant(median(shapes.fwhms)),
      medianEccentricity: significant(median(shapes.eccentricities)),
      starPixelMedian: significant(median(levels)),
      starPixelLevel: STAR_PIXEL_LEVEL,
      starPixelCount: levels.length,
      brightestStars: shapes.brightest,
      note: "Stable for comparison, not photometric. starCount is approximate, detection reads one row in " + DETECTION_ROW_STEP +
            ". starPixelMedian is meaningful on a stars only layer."
   }, view.id + ": " + stars.length + " star(s)");
}
