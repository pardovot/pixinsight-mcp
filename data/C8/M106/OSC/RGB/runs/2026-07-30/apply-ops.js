// Replayable op applier for the M106 2026-07-30 run.
// APPLY_OPS(viewId, ops) applies an ordered op list; the same list replays at full res on the
// full-frame starless. RAMP_SLOPE(op) measures a curve op on a 1024-step ramp (the 3b slope guard
// must be measured, not read off the chord: Akima overshoots its chord by ~5%).

function __dupView(srcId, dstId, w, h) {
  var s = ImageWindow.windowById(srcId);
  if (s.isNull) throw new Error("no view " + srcId);
  var simg = s.mainView.image; simg.resetSelections();
  var old = ImageWindow.windowById(dstId); if (!old.isNull) old.forceClose();
  var nw = new ImageWindow(w, h, 3, 32, true, true, dstId);
  var v = nw.mainView;
  v.beginProcess(); v.image.assign(simg); v.endProcess();
  v.image.resetSelections();
  return v;
}

function __applyOne(view, o) {
  if (o.op === "HT") {
    var P = new HistogramTransformation;
    var H = P.H;
    H[0] = [o.c0[0], o.m, 1, 0, 1];
    H[1] = [o.c0[1], o.m, 1, 0, 1];
    H[2] = [o.c0[2], o.m, 1, 0, 1];
    H[3] = [0, 0.5, 1, 0, 1];
    H[4] = [0, 0.5, 1, 0, 1];
    P.H = H;
    P.executeOn(view);
  } else if (o.op === "HDRMT") {
    var Q = new HDRMultiscaleTransform;
    Q.numberOfLayers = o.layers;
    Q.numberOfIterations = o.iterations;
    Q.invertedIterations = true;
    Q.overdrive = o.overdrive;
    Q.medianTransform = false;
    Q.toLightness = o.toLightness;
    Q.toLuminanceOnly = false;
    Q.toIntensity = false;
    Q.luminanceMask = o.luminanceMask;
    Q.lightnessMask = false;
    Q.preserveHue = false;
    Q.deringing = o.deringing;
    Q.smallScaleDeringing = o.smallScaleDeringing || 0;
    Q.largeScaleDeringing = o.largeScaleDeringing || 0;
    Q.midtonesBalanceMode = 1;
    Q.midtonesBalance = 0.5;
    Q.executeOn(view);
  } else if (o.op === "CURVE") {
    var C = new CurvesTransformation;
    C[o.chan] = o.points;
    C[o.chan + "t"] = (o.type === undefined ? 0 : o.type);
    C.executeOn(view);
  } else if (o.op === "SCNR") {
    var S = new SCNR;
    S.colorToRemove = 0;          // green
    S.protectionMethod = 2;       // AverageNeutral
    S.amount = o.amount;
    S.preserveLightness = true;
    S.executeOn(view);
  } else {
    throw new Error("unknown op " + o.op);
  }
}

function APPLY_OPS(viewId, ops) {
  var w = ImageWindow.windowById(viewId);
  if (w.isNull) throw new Error("no view " + viewId);
  var v = w.mainView;
  for (var i = 0; i < ops.length; i++) __applyOne(v, ops[i]);
  v.image.resetSelections();
  return viewId;
}

function MAKE_VARIANT(srcId, dstId, w, h, ops) {
  var v = __dupView(srcId, dstId, w, h);
  for (var i = 0; i < ops.length; i++) __applyOne(v, ops[i]);
  v.image.resetSelections();
  return dstId;
}

// Measured slope profile of a curve op, on a 1024-step ramp.
function RAMP_SLOPE(o) {
  var N = 1024;
  var old = ImageWindow.windowById("__ramp"); if (!old.isNull) old.forceClose();
  var nw = new ImageWindow(N, 1, 3, 32, true, true, "__ramp");
  var v = nw.mainView;
  v.beginProcess();
  for (var i = 0; i < N; i++) { var x = i / (N - 1); for (var c = 0; c < 3; c++) v.image.setSample(x, i, 0, c); }
  v.endProcess();
  __applyOne(v, o);
  // Read back the channel the op actually drives, else a per-channel curve measures as identity.
  var ch = { R: 0, G: 1, B: 2 }[o.chan];
  if (ch === undefined) ch = 1;
  var y = [];
  for (var j = 0; j < N; j++) y.push(v.image.sample(j, 0, ch));
  nw.forceClose();
  var maxS = 0, maxAt = 0;
  for (var k = 1; k < N - 1; k++) {
    var s = (y[k + 1] - y[k - 1]) / (2 / (N - 1));
    if (s > maxS) { maxS = s; maxAt = k / (N - 1); }
  }
  function at(x) { var idx = Math.round(x * (N - 1)); return y[Math.max(0, Math.min(N - 1, idx))]; }
  return { maxSlope: +maxS.toPrecision(6), maxSlopeAt: +maxAt.toPrecision(4), at: at, y: y };
}

// Curve compression gate: average slope above the pivot for a curve lifting m -> m'.
function COMPRESSION(o, m) {
  var r = RAMP_SLOPE(o);
  var mp = r.at(m);
  return { m: m, mOut: +mp.toPrecision(6), avgSlopeAbove: +((1 - mp) / (1 - m)).toPrecision(6), maxSlope: r.maxSlope, maxSlopeAt: r.maxSlopeAt };
}

"apply-ops loaded";
