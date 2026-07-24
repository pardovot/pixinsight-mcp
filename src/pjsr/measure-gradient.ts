/**
 * get_background_gradient, grid-of-boxes background map + per-channel plane fit.
 *
 * Per-box per-channel medians are computed NATIVELY via Image selections
 * (selectedRect + selectedChannel, then median()), median is star-robust, so no
 * explicit signal exclusion is needed; a box sitting on nebula simply reads high
 * and shows up in maxDeviationPct (the caller interprets which boxes are sky).
 * Corner spread halving was the R8 gradient-correction verification signal.
 */
export function gradientScript(viewId: string, gridSize: number, boxFraction: number): string {
  const id = JSON.stringify(viewId);
  return `(function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var v = View.viewById(${id});
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + ${id}});
  var img = v.image;
  var w = img.width, h = img.height;
  var g = ${Math.trunc(gridSize)};
  var bw = Math.max(16, Math.round(w * ${boxFraction}));
  var bh = Math.max(16, Math.round(h * ${boxFraction}));
  var nch = Math.min(img.numberOfChannels, 3);
  var names = img.isColor ? ["R","G","B"] : ["K"];

  var boxMedian = function(x0, y0, c) {
    img.selectedChannel = c;
    img.selectedRect = new Rect(x0, y0, x0 + bw, y0 + bh);
    return img.median();
  };
  var clampX = function(x){ return Math.max(0, Math.min(w - bw, x)); };
  var clampY = function(y){ return Math.max(0, Math.min(h - bh, y)); };

  // Grid boxes + one explicit center box.
  var boxes = [];
  for (var j = 0; j < g; ++j)
    for (var i = 0; i < g; ++i) {
      var cx = (i + 0.5) * w / g, cy = (j + 0.5) * h / g;
      var x0 = clampX(Math.round(cx - bw/2)), y0 = clampY(Math.round(cy - bh/2));
      var meds = [];
      for (var c = 0; c < nch; ++c) meds.push(boxMedian(x0, y0, c));
      boxes.push({ i: i, j: j, x: sig(cx / w), y: sig(cy / h), medians: meds.map(sig) });
    }
  var cx0 = clampX(Math.round(w/2 - bw/2)), cy0 = clampY(Math.round(h/2 - bh/2));
  var centerMeds = [];
  for (var c = 0; c < nch; ++c) centerMeds.push(boxMedian(cx0, cy0, c));
  img.resetSelections();

  // Per-channel: corners, deviation, least-squares plane m = a + bx*x + by*y (x,y in [0,1]).
  var channels = [];
  for (var c = 0; c < nch; ++c) {
    var corners = [];
    var minM = Infinity, maxM = -Infinity;
    var S = [[0,0,0],[0,0,0],[0,0,0]], t = [0,0,0];
    for (var k = 0; k < boxes.length; ++k) {
      var b = boxes[k], m = b.medians[c];
      if ((b.i === 0 || b.i === g-1) && (b.j === 0 || b.j === g-1)) corners.push(m);
      if (m < minM) minM = m;
      if (m > maxM) maxM = m;
      var row = [1, b.x, b.y];
      for (var p = 0; p < 3; ++p) { for (var q = 0; q < 3; ++q) S[p][q] += row[p]*row[q]; t[p] += row[p]*m; }
    }
    // Solve 3x3 by Cramer.
    var det = function(M){ return M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1]) - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0]) + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]); };
    var D = det(S), plane = null;
    if (Math.abs(D) > 1e-30) {
      var Mi = function(col){ var M = [S[0].slice(),S[1].slice(),S[2].slice()]; for (var r = 0; r < 3; ++r) M[r][col] = t[r]; return M; };
      plane = { a: sig(det(Mi(0))/D), bx: sig(det(Mi(1))/D), by: sig(det(Mi(2))/D) };
    }
    var center = centerMeds[c], denom = Math.max(Math.abs(center), 1e-9);
    var cornerSpread = corners.length ? Math.max.apply(null, corners) - Math.min.apply(null, corners) : null;
    channels.push({
      channel: c, name: names[c] || ("C"+c),
      centerMedian: sig(center),
      cornerMedians: corners.map(sig),
      cornerSpread: sig(cornerSpread),
      cornerSpreadPctOfCenter: sig(cornerSpread === null ? null : 100*cornerSpread/denom),
      maxDeviationPct: sig(100*Math.max(maxM - center, center - minM)/denom),
      plane: plane
    });
  }
  return JSON.stringify({ viewId: ${id}, gridSize: g, boxWidth: bw, boxHeight: bh, channels: channels, boxes: boxes });
})()`;
}
