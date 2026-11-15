// get_background_gradient: background medians on a grid of boxes, the corner spread, and a
// least squares plane through them.

var MIN_GRADIENT_BOX = 16;
// Below this determinant the plane fit is singular and no plane is reported.
var SINGULAR_DETERMINANT = 1e-30;
// Keeps percentages finite on a background median of zero.
var MIN_CENTER_MEDIAN = 1e-9;

function determinant3(matrix) {
   return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
          matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
          matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}

// Solves normal * [a, bx, by] = rightSide by Cramer's rule, or returns null when singular.
function solvePlane(normal, rightSide) {
   var determinant = determinant3(normal);
   if (Math.abs(determinant) <= SINGULAR_DETERMINANT)
      return null;
   var withColumn = function (column) {
      var matrix = [normal[0].slice(), normal[1].slice(), normal[2].slice()];
      for (var row = 0; row < 3; ++row)
         matrix[row][column] = rightSide[row];
      return matrix;
   };
   return {
      a: significant(determinant3(withColumn(0)) / determinant),
      bx: significant(determinant3(withColumn(1)) / determinant),
      by: significant(determinant3(withColumn(2)) / determinant)
   };
}

function measureGradient(view, gridSize, boxFraction) {
   var image = view.image;
   var width = image.width;
   var height = image.height;
   var boxWidth = Math.max(MIN_GRADIENT_BOX, Math.round(width * boxFraction));
   var boxHeight = Math.max(MIN_GRADIENT_BOX, Math.round(height * boxFraction));
   var channelCount = measuredChannelCount(image);

   var boxMedian = function (left, top, channel) {
      image.selectedChannel = channel;
      image.selectedRect = new Rect(left, top, left + boxWidth, top + boxHeight);
      return image.median();
   };
   var clampLeft = function (left) { return Math.max(0, Math.min(width - boxWidth, left)); };
   var clampTop = function (top) { return Math.max(0, Math.min(height - boxHeight, top)); };

   var boxes = [];
   var centerMedians = [];
   try {
      for (var row = 0; row < gridSize; ++row)
         for (var column = 0; column < gridSize; ++column) {
            var centerX = (column + 0.5) * width / gridSize;
            var centerY = (row + 0.5) * height / gridSize;
            var left = clampLeft(Math.round(centerX - boxWidth / 2));
            var top = clampTop(Math.round(centerY - boxHeight / 2));
            var medians = [];
            for (var channel = 0; channel < channelCount; ++channel)
               medians.push(boxMedian(left, top, channel));
            boxes.push({ column: column, row: row, x: significant(centerX / width), y: significant(centerY / height),
                         medians: medians.map(significant) });
         }
      var centerLeft = clampLeft(Math.round(width / 2 - boxWidth / 2));
      var centerTop = clampTop(Math.round(height / 2 - boxHeight / 2));
      for (var channel = 0; channel < channelCount; ++channel)
         centerMedians.push(boxMedian(centerLeft, centerTop, channel));
   } finally {
      image.resetSelections();
   }

   // Plane: median = a + bx * x + by * y, with x and y the box center in [0, 1].
   var channels = [];
   for (var channel = 0; channel < channelCount; ++channel) {
      var corners = [];
      var lowest = Infinity;
      var highest = -Infinity;
      var normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      var rightSide = [0, 0, 0];
      for (var index = 0; index < boxes.length; ++index) {
         var box = boxes[index];
         var value = box.medians[channel];
         var onEdgeColumn = box.column === 0 || box.column === gridSize - 1;
         var onEdgeRow = box.row === 0 || box.row === gridSize - 1;
         if (onEdgeColumn && onEdgeRow)
            corners.push(value);
         if (value < lowest)
            lowest = value;
         if (value > highest)
            highest = value;
         var terms = [1, box.x, box.y];
         for (var termRow = 0; termRow < 3; ++termRow) {
            for (var termColumn = 0; termColumn < 3; ++termColumn)
               normal[termRow][termColumn] += terms[termRow] * terms[termColumn];
            rightSide[termRow] += terms[termRow] * value;
         }
      }
      var center = centerMedians[channel];
      var scale = Math.max(Math.abs(center), MIN_CENTER_MEDIAN);
      var cornerSpread = corners.length ? Math.max.apply(null, corners) - Math.min.apply(null, corners) : null;
      channels.push({
         channel: channel,
         name: shortChannelName(image, channel),
         centerMedian: significant(center),
         cornerMedians: corners.map(significant),
         cornerSpread: significant(cornerSpread),
         cornerSpreadPctOfCenter: significant(cornerSpread === null ? null : 100 * cornerSpread / scale),
         maxDeviationPct: significant(100 * Math.max(highest - center, center - lowest) / scale),
         plane: solvePlane(normal, rightSide)
      });
   }
   return { viewId: view.id, gridSize: gridSize, boxWidth: boxWidth, boxHeight: boxHeight,
            channels: channels, boxes: boxes };
}

function handleGetBackgroundGradient(command) {
   var view = requireView(command.parameters.viewId);
   var result = measureGradient(view, Math.trunc(Number(command.parameters.gridSize)),
                                Number(command.parameters.boxFraction));
   return success(result, view.id + ": background gradient");
}
