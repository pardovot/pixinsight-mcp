// Crop selector for the process-v2 variant search. eval, then CROP_SELECT(viewId, opts).
//
// Framing is PRIMARY. The statistical gate is a FILTER over candidates, never the thing that picks
// the position. Added 2026-07-30 after the M106 run 1: the gate scores sky p25, lum p50,
// grainRelSky and structure RoverG/RoverB, none of which says anything about where the object sits,
// so a crop can score 1.7% and still be 92% empty sky with the galaxy as a corner sliver. Picking
// among gate-passing candidates by eye then put the delivered crop 230 px x / 275 px y off the
// object: it clipped the top of the galaxy and left dead sky at the bottom. Re-measured, the
// properly centred rect scored 6.64% vs the delivered 6.27%, so centring cost nothing. There was no
// trade-off, only a missing criterion.
//
// Returns { extent, size, rect, match, gate, ref }. It does NOT refuse a breach; the driver decides
// and records. See SKILL.md section 3.

var CS_TERMS = ["skyP25", "lumP50", "grainRelSky", "RoverG", "RoverB"];

function __csRect(img, x0, y0, x1, y1, target) {
  var W = x1 - x0, H = y1 - y0;
  var stride = Math.max(1, Math.floor(Math.sqrt(W * H / target)));
  var lum = [], rr = [], gg = [], bb = [], d2 = [];
  for (var y = y0; y < y1; y += stride) {
    for (var x = x0; x < x1; x += stride) {
      var r = img.sample(x, y, 0), g = img.sample(x, y, 1), b = img.sample(x, y, 2);
      var L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum.push(L); rr.push(r); gg.push(g); bb.push(b);
      if (x + 2 < x1) {
        var r2 = img.sample(x + 2, y, 0), g2 = img.sample(x + 2, y, 1), b2 = img.sample(x + 2, y, 2);
        d2.push(Math.abs(L - (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2)));
      }
    }
  }
  function pct(a, p) { var s = a.slice().sort(function (u, v) { return u - v; }); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }
  function pctS(s, p) { return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }
  function mad(a) { var m = pct(a, 50), d = []; for (var q = 0; q < a.length; q++) d.push(Math.abs(a[q] - m)); return pct(d, 50); }
  var sl = lum.slice().sort(function (u, v) { return u - v; });
  var n = lum.length;
  var loT = pctS(sl, 10), loU = pctS(sl, 40), hiT = pctS(sl, 70), hiU = pctS(sl, 95);
  var dk = [0, 0, 0], dn = 0, bk = [0, 0, 0], bn = 0;
  for (var m = 0; m < n; m++) {
    var Lm = lum[m], mxm = Math.max(rr[m], gg[m], bb[m]);
    if (Lm >= loT && Lm <= loU) { dk[0] += rr[m]; dk[1] += gg[m]; dk[2] += bb[m]; dn++; }
    else if (Lm >= hiT && Lm <= hiU && mxm < 0.9) { bk[0] += rr[m]; bk[1] += gg[m]; bk[2] += bb[m]; bn++; }
  }
  var dR = bk[0] / bn - dk[0] / dn, dG = bk[1] / bn - dk[1] / dn, dB = bk[2] / bn - dk[2] / dn;
  function sig(x) { return (x && isFinite(x)) ? +x.toPrecision(6) : (isFinite(x) ? 0 : x); }
  return {
    skyP25: sig(pctS(sl, 25)), lumP50: sig(pctS(sl, 50)),
    grainRelSky: sig(mad(d2) / pctS(sl, 25)),
    RoverG: sig(dR / dG), RoverB: sig(dR / dB),
    p75: sig(pctS(sl, 75)), p95: sig(pctS(sl, 95)), p99: sig(pctS(sl, 99)),
    n: n, stride: stride
  };
}

// Object extent from the marginal flux profile above sky. Use ~5% of the peak marginal: 10% clips
// the arms, 2% saturates to the whole frame as the halo merges into the noise floor (measured on
// M106, where 5% gave x 1992-3996 / y 1504-2756, agreeing with the 10% contour and the core).
function CROP_EXTENT(img, sky, frac, stride) {
  frac = frac || 0.05; stride = stride || 4;
  var W = img.width, H = img.height;
  var col = [], row = [], i;
  for (i = 0; i < Math.ceil(W / stride); i++) col.push(0);
  for (i = 0; i < Math.ceil(H / stride); i++) row.push(0);
  for (var y = 0; y < H; y += stride) {
    for (var x = 0; x < W; x += stride) {
      var L = 0.2126 * img.sample(x, y, 0) + 0.7152 * img.sample(x, y, 1) + 0.0722 * img.sample(x, y, 2);
      var e = L - sky;
      if (e > 0) { col[Math.floor(x / stride)] += e; row[Math.floor(y / stride)] += e; }
    }
  }
  function span(a) {
    var mx = 0, k;
    for (k = 0; k < a.length; k++) if (a[k] > mx) mx = a[k];
    var t = mx * frac, lo = 0, hi = a.length - 1;
    for (k = 0; k < a.length; k++) if (a[k] >= t) { lo = k; break; }
    for (k = a.length - 1; k >= 0; k--) if (a[k] >= t) { hi = k; break; }
    return [lo * stride, hi * stride];
  }
  var ex = span(col), ey = span(row);
  return { x: ex, y: ey, cx: Math.round((ex[0] + ex[1]) / 2), cy: Math.round((ey[0] + ey[1]) / 2), frac: frac };
}

function CROP_SELECT(viewId, opts) {
  opts = opts || {};
  var win = ImageWindow.windowById(viewId);
  if (win.isNull) throw new Error("no view " + viewId);
  var img = win.mainView.image;
  img.resetSelections();
  var W = img.width, H = img.height;

  // Full-frame reference, computed ONCE. Recomputing it per candidate was pure waste in run 1.
  var ref = __csRect(img, 0, 0, W, H, opts.refTarget || 40000);

  var ext = CROP_EXTENT(img, ref.skyP25, opts.extentFrac || 0.05, opts.extentStride || 4);

  // Size from the measured object, not a fixed 1500x1000: the crop must actually hold the object
  // plus a sky margin. The margin is what buys the gate: the gate terms are sky statistics, so a
  // crop framed tight on the object scores WORSE the tighter it is framed. Measured on M106
  // (margin -> gate worst): 0.25 -> 9.5%, 0.40 -> 7.1%, 0.55 -> 5.3%, 0.70 -> 5.0% (passes).
  // Hence the 0.70 default. Caps are frame-relative so `margin` keeps controlling the size instead
  // of silently saturating on an absolute pixel clamp.
  var mg = opts.margin === undefined ? 0.70 : opts.margin;
  var cw = opts.cw || Math.round((ext.x[1] - ext.x[0]) * (1 + 2 * mg));
  var ch = opts.ch || Math.round((ext.y[1] - ext.y[0]) * (1 + 2 * mg));
  var maxFrac = opts.maxFrac === undefined ? 0.80 : opts.maxFrac;
  cw = Math.max(1200, Math.min(cw, W, Math.round(W * maxFrac)));
  ch = Math.max(800, Math.min(ch, H, Math.round(H * maxFrac)));

  // Candidates: centred on the object, then a bounded jitter so the gate can refine WITHOUT
  // letting it walk off the object. maxShift defaults to 10% of the crop size.
  var sh = opts.maxShift === undefined ? 0.10 : opts.maxShift;
  var sx = Math.round(cw * sh), sy = Math.round(ch * sh);
  var steps = opts.steps || 2;
  function clampX(v) { return Math.max(0, Math.min(v, W - cw)); }
  function clampY(v) { return Math.max(0, Math.min(v, H - ch)); }
  var cands = [], ix, iy;
  for (ix = -steps; ix <= steps; ix++) {
    for (iy = -steps; iy <= steps; iy++) {
      var x0 = clampX(ext.cx - Math.round(cw / 2) + Math.round(ix * sx / steps));
      var y0 = clampY(ext.cy - Math.round(ch / 2) + Math.round(iy * sy / steps));
      var dup = false;
      for (var d = 0; d < cands.length; d++) if (cands[d][0] === x0 && cands[d][1] === y0) { dup = true; break; }
      if (!dup) cands.push([x0, y0]);
    }
  }

  var scored = [];
  for (var c = 0; c < cands.length; c++) {
    var mrect = __csRect(img, cands[c][0], cands[c][1], cands[c][0] + cw, cands[c][1] + ch, opts.target || 16000);
    var per = {}, worst = 0;
    for (var t = 0; t < CS_TERMS.length; t++) {
      var k = CS_TERMS[t];
      var dev = Math.abs(mrect[k] - ref[k]) / Math.abs(ref[k]);
      per[k] = +dev.toFixed(4);
      if (dev > worst) worst = dev;
    }
    // Off-centre penalty keeps framing primary: the gate refines within the jitter box, it does
    // not get to trade framing away for a better number.
    var offx = (cands[c][0] + cw / 2 - ext.cx) / cw, offy = (cands[c][1] + ch / 2 - ext.cy) / ch;
    var off = Math.sqrt(offx * offx + offy * offy);
    scored.push({ rect: [cands[c][0], cands[c][1], cands[c][0] + cw, cands[c][1] + ch],
                  worst: +worst.toFixed(4), per: per, offCentre: +off.toFixed(4),
                  score: +(worst + off).toFixed(4), m: mrect });
  }
  scored.sort(function (a, b) { return a.score - b.score; });
  var best = scored[0];

  var lim = opts.gate === undefined ? 0.05 : opts.gate;
  var breached = [];
  for (var g = 0; g < CS_TERMS.length; g++) if (best.per[CS_TERMS[g]] > lim) breached.push(CS_TERMS[g]);

  return {
    extent: ext, size: [cw, ch], rect: best.rect,
    match: { worst: best.worst, per: best.per, offCentre: best.offCentre },
    gate: { limit: lim, ok: breached.length === 0, breached: breached },
    ref: ref, crop: best.m, candidates: scored.length
  };
}

"crop-select loaded";
