// get_structure_color: the color of the structure (bright minus dark population, stars
// excluded) and saturation per tile, which region medians cannot show.

// A sample brighter than this multiple of its four grid neighbours is a star and is skipped.
var STAR_SPIKE_RATIO = 1.25;
var MIN_STRUCTURE_SAMPLES = 50;
var MIN_GRID_SIDE = 3;
// The dark and bright populations are the lowest and highest fifth by luminance.
var DARK_POPULATION_QUANTILE = 0.2;
var BRIGHT_POPULATION_QUANTILE = 0.8;
// A rect is clamped to the image and kept at least this many pixels wide and high.
var MIN_REGION_SIDE = 2;

function structureRegion(image, rect) {
   if (!rect)
      return { left: 0, top: 0, right: image.width, bottom: image.height };
   var left = Math.max(0, Math.min(image.width - 1, Math.trunc(rect[0])));
   var top = Math.max(0, Math.min(image.height - 1, Math.trunc(rect[1])));
   return {
      left: left,
      top: top,
      right: Math.max(left + MIN_REGION_SIDE, Math.min(image.width, Math.trunc(rect[2]))),
      bottom: Math.max(top + MIN_REGION_SIDE, Math.min(image.height, Math.trunc(rect[3])))
   };
}

// RGB grids sampled with a stride that gives about `targetSamples` points in the region.
function sampleRegionGrid(image, region, targetSamples) {
   var regionWidth = region.right - region.left;
   var regionHeight = region.bottom - region.top;
   var stride = Math.max(1, Math.floor(Math.sqrt(regionWidth * regionHeight / targetSamples)));
   var grids = [[], [], []];
   var widest = 0;
   var buffer = [];
   try {
      for (var y = region.top; y < region.bottom; y += stride) {
         for (var channel = 0; channel < 3; ++channel) {
            readSamples(image, channel, region.left, y, region.right, y + 1, buffer);
            var row = [];
            for (var x = 0; x < regionWidth; x += stride)
               row.push(buffer[x]);
            grids[channel].push(row);
         }
         widest = Math.max(widest, grids[0][grids[0].length - 1].length);
      }
   } finally {
      image.resetSelections();
   }
   if (grids[0].length < MIN_GRID_SIDE || widest < MIN_GRID_SIDE)
      throw new Error("Region too small to sample, it needs a grid of at least " + MIN_GRID_SIDE + "x" + MIN_GRID_SIDE + " samples");
   return { reds: grids[0], greens: grids[1], blues: grids[2], stride: stride };
}

// Interior grid samples that are not star spikes, as { luminance, red, green, blue }.
function structureSamples(grid) {
   var luminance = grid.reds.map(function (row, rowIndex) {
      return row.map(function (red, column) {
         return (red + grid.greens[rowIndex][column] + grid.blues[rowIndex][column]) / 3;
      });
   });
   var samples = [];
   var rejected = 0;
   for (var row = 1; row < luminance.length - 1; ++row)
      for (var column = 1; column < grid.reds[row].length - 1; ++column) {
         if (column >= luminance[row - 1].length || column >= luminance[row + 1].length)
            continue;
         var value = luminance[row][column];
         if (!(value > 0))
            continue;
         var neighbours = (luminance[row][column - 1] + luminance[row][column + 1] +
                           luminance[row - 1][column] + luminance[row + 1][column]) / 4;
         if (neighbours > 0 && value > neighbours * STAR_SPIKE_RATIO) {
            ++rejected;
            continue;
         }
         samples.push({ luminance: value, red: grid.reds[row][column], green: grid.greens[row][column],
                        blue: grid.blues[row][column] });
      }
   if (samples.length < MIN_STRUCTURE_SAMPLES)
      throw new Error("Too few samples that are not stars in the region (" + samples.length + ")");
   return { samples: samples, rejected: rejected };
}

function populationMean(samples, start, end) {
   var red = 0, green = 0, blue = 0, luminance = 0, count = 0;
   for (var index = start; index < end; ++index) {
      red += samples[index].red;
      green += samples[index].green;
      blue += samples[index].blue;
      luminance += samples[index].luminance;
      ++count;
   }
   return { red: red / count, green: green / count, blue: blue / count, luminance: luminance / count, count: count };
}

function describePopulation(population) {
   return {
      RGB: [significant(population.red), significant(population.green), significant(population.blue)],
      luminance: significant(population.luminance),
      count: population.count
   };
}

function tileSaturation(grid, tileGrid) {
   var tiles = [];
   for (var tile = 0; tile < tileGrid * tileGrid; ++tile)
      tiles.push([]);
   var achromatic = 0;
   var all = [];
   var rowCount = grid.reds.length;
   for (var row = 0; row < rowCount; ++row) {
      var columnCount = grid.reds[row].length;
      for (var column = 0; column < columnCount; ++column) {
         var red = grid.reds[row][column];
         var green = grid.greens[row][column];
         var blue = grid.blues[row][column];
         var highest = Math.max(red, Math.max(green, blue));
         var lowest = Math.min(red, Math.min(green, blue));
         var saturation = highest > 0 ? (highest - lowest) / highest : 0;
         if (highest - lowest <= 0)
            ++achromatic;
         all.push(saturation);
         var tileColumn = Math.min(tileGrid - 1, Math.floor(column / Math.max(1, columnCount / tileGrid)));
         var tileRow = Math.min(tileGrid - 1, Math.floor(row / Math.max(1, rowCount / tileGrid)));
         tiles[tileRow * tileGrid + tileColumn].push(saturation);
      }
   }

   var tileMedians = [];
   var minimum = null;
   var minimumIndex = -1;
   for (var tile = 0; tile < tiles.length; ++tile) {
      var tileMedian = tiles[tile].length ? median(tiles[tile]) : null;
      tileMedians.push(tileMedian === null ? null : significant(tileMedian));
      if (tileMedian !== null && (minimum === null || tileMedian < minimum)) {
         minimum = tileMedian;
         minimumIndex = tile;
      }
   }
   var maximum = null;
   for (var tile = 0; tile < tileMedians.length; ++tile)
      if (tileMedians[tile] !== null && (maximum === null || tileMedians[tile] > maximum))
         maximum = tileMedians[tile];

   return { sampleCount: all.length, summary: {
      medianSaturation: significant(median(all)),
      pctExactlyAchromatic: significant(100 * achromatic / all.length),
      tileGrid: tileGrid,
      minTileSaturation: significant(minimum),
      maxTileSaturation: significant(maximum),
      minTileIndex: minimumIndex,
      minTileRowCol: minimumIndex < 0 ? null : [Math.floor(minimumIndex / tileGrid), minimumIndex % tileGrid],
      tileMedianSaturation: tileMedians,
      note: "Per tile, because a single bgChroma cannot see chroma lost in patches (it averages deleted color with retained color). " +
            "A minTileSaturation near zero, or pctExactlyAchromatic above about 1%, means an operation zeroed chroma in patches. " +
            "On 8 bit sources pctExactlyAchromatic is limited by quantization, on float data it is exact."
   } };
}

function handleGetStructureColor(command) {
   var parameters = command.parameters;
   var view = requireView(parameters.viewId);
   var image = view.image;
   requireColor(image, "get_structure_color");
   var region = structureRegion(image, optionalRect(parameters.rect));
   var grid = sampleRegionGrid(image, region, Math.trunc(Number(parameters.targetSamples)));
   var structure = structureSamples(grid);
   var samples = structure.samples;
   samples.sort(function (left, right) { return left.luminance - right.luminance; });
   var dark = populationMean(samples, 0, Math.floor(samples.length * DARK_POPULATION_QUANTILE));
   var bright = populationMean(samples, Math.floor(samples.length * BRIGHT_POPULATION_QUANTILE), samples.length);
   var deltaRed = bright.red - dark.red;
   var deltaGreen = bright.green - dark.green;
   var deltaBlue = bright.blue - dark.blue;
   var chroma = tileSaturation(grid, Math.trunc(Number(parameters.tileGrid)));

   return success({
      viewId: view.id,
      rect: [region.left, region.top, region.right, region.bottom],
      stride: grid.stride,
      gridSamples: chroma.sampleCount,
      starSamplesRejected: structure.rejected,
      structure: {
         deltaRGB: [significant(deltaRed), significant(deltaGreen), significant(deltaBlue)],
         RoverG: significant(deltaGreen !== 0 ? deltaRed / deltaGreen : null),
         RoverB: significant(deltaBlue !== 0 ? deltaRed / deltaBlue : null),
         darkPopulation: describePopulation(dark),
         brightPopulation: describePopulation(bright),
         note: "Color of the structure, not the sky: bright minus dark population, split by luminance, stars excluded. " +
               "Compare RoverG/RoverB across pipeline stages, a drop toward or below 1.0 on an Ha field means red structure " +
               "is being neutralized. Region medians cannot see this."
      },
      spatialChroma: chroma.summary
   }, view.id + ": structure color");
}
