// v3 profiler: stride-grid profile + per-tile hue/sat map. eval, then runFiles(list, scales?)
// v3 (2026-07-30): magnitude-sensitive fields emit SIGNIFICANT FIGURES, not fixed decimals. At 5-6
// dp the linear-stage values (deltas ~1e-5, grain ~1e-6) rounded to 1 sig fig or to 0.00000, which
// made a structure ratio unauditable and looked like a real 3.495-vs-4.750 discrepancy.
function __pfProfileView(view) {
  var img = view.image;
  var W = img.width, H = img.height;
  var target = 40000;
  var stride = Math.max(1, Math.floor(Math.sqrt(W * H / target)));
  var G = 6; // tile grid
  var tiles = [];
  for (var t = 0; t < G * G; t++) tiles.push({ n: 0, sat: 0, r: 0, g: 0, b: 0, ach: 0 });
  var lum = [], rr = [], gg = [], bb = [], d2 = [], d8 = [];
  var nAch = 0, nSatLo = 0, nClipLo = 0, nClipHi = 0, n = 0;
  for (var y = 0; y < H; y += stride) {
    for (var x = 0; x < W; x += stride) {
      var r = img.sample(x, y, 0), g = img.sample(x, y, 1), b = img.sample(x, y, 2);
      var L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum.push(L); rr.push(r); gg.push(g); bb.push(b); n++;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var sat = mx > 0 ? (mx - mn) / mx : 0;
      var ti = Math.min(G - 1, Math.floor(y / H * G)) * G + Math.min(G - 1, Math.floor(x / W * G));
      var T = tiles[ti];
      T.n++; T.sat += sat; T.r += r; T.g += g; T.b += b;
      if (r === g && g === b) { nAch++; T.ach++; }
      if (mx > 0 && sat < 0.01) nSatLo++;
      if (L <= 0.001) nClipLo++;
      if (mx >= 0.999) nClipHi++;
      if (x + 2 < W) {
        var r2 = img.sample(x + 2, y, 0), g2 = img.sample(x + 2, y, 1), b2 = img.sample(x + 2, y, 2);
        d2.push(Math.abs(L - (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2)));
      }
      if (x + 8 < W) {
        var r8 = img.sample(x + 8, y, 0), g8 = img.sample(x + 8, y, 1), b8 = img.sample(x + 8, y, 2);
        d8.push(Math.abs(L - (0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8)));
      }
    }
  }
  // Scale-free rounding: keeps 6 significant figures whether the value is 0.2 or 2e-6.
  function sig(x) { return (x && isFinite(x)) ? +x.toPrecision(6) : (isFinite(x) ? 0 : x); }
  function pct(a, p) { var s = a.slice().sort(function(u, v) { return u - v; }); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }
  function pctS(s, p) { return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }
  var sl = lum.slice().sort(function(u, v) { return u - v; });
  var PP = [1, 5, 25, 50, 75, 95, 99, 99.9];
  var pl = {}, pr = {}, pg = {}, pb = {};
  var sr = rr.slice().sort(function(u,v){return u-v;}), sg = gg.slice().sort(function(u,v){return u-v;}), sb = bb.slice().sort(function(u,v){return u-v;});
  for (var i = 0; i < PP.length; i++) {
    var k = "p" + String(PP[i]).replace(".", "_");
    pl[k] = sig(pctS(sl, PP[i])); pr[k] = sig(pctS(sr, PP[i]));
    pg[k] = sig(pctS(sg, PP[i])); pb[k] = sig(pctS(sb, PP[i]));
  }
  var edges = [0, 0.05, 0.1, 0.2, 0.4, 0.7, 1.001];
  var bands = [];
  for (var e = 0; e < edges.length - 1; e++) bands.push({ lo: edges[e], hi: edges[e + 1], n: 0, sat: 0, ach: 0 });
  for (var j = 0; j < n; j++) {
    var Lj = lum[j];
    for (var e2 = 0; e2 < bands.length; e2++) {
      if (Lj >= bands[e2].lo && Lj < bands[e2].hi) {
        var mxj = Math.max(rr[j], gg[j], bb[j]), mnj = Math.min(rr[j], gg[j], bb[j]);
        bands[e2].n++;
        bands[e2].sat += mxj > 0 ? (mxj - mnj) / mxj : 0;
        if (rr[j] === gg[j] && gg[j] === bb[j]) bands[e2].ach++;
        break;
      }
    }
  }
  var bandOut = [];
  for (var e3 = 0; e3 < bands.length; e3++) {
    var B = bands[e3];
    bandOut.push({ lo: B.lo, n: B.n, meanSat: B.n ? +(B.sat / B.n).toFixed(4) : null, fracAch: B.n ? +(B.ach / B.n).toFixed(4) : null });
  }
  var loT = pctS(sl, 10), loU = pctS(sl, 40), hiT = pctS(sl, 70), hiU = pctS(sl, 95);
  var dk = [0, 0, 0], dn = 0, bk = [0, 0, 0], bn = 0;
  for (var m = 0; m < n; m++) {
    var Lm = lum[m], mxm = Math.max(rr[m], gg[m], bb[m]);
    if (Lm >= loT && Lm <= loU) { dk[0] += rr[m]; dk[1] += gg[m]; dk[2] += bb[m]; dn++; }
    else if (Lm >= hiT && Lm <= hiU && mxm < 0.9) { bk[0] += rr[m]; bk[1] += gg[m]; bk[2] += bb[m]; bn++; }
  }
  var dR = bk[0] / bn - dk[0] / dn, dG = bk[1] / bn - dk[1] / dn, dB = bk[2] / bn - dk[2] / dn;
  function madOf(a) { var med = pct(a, 50); var dev = []; for (var q = 0; q < a.length; q++) dev.push(Math.abs(a[q] - med)); return pct(dev, 50); }
  var sky = pctS(sl, 25);
  var tileSat = [], tileRB = [], minTileSat = 1, minTileIdx = -1, maxAchFrac = 0;
  for (var t2 = 0; t2 < tiles.length; t2++) {
    var TT = tiles[t2];
    var ms = TT.n ? TT.sat / TT.n : 0;
    var lvl = TT.n ? (TT.r + TT.g + TT.b) / (3 * TT.n) : 0;
    tileSat.push(+ms.toFixed(3));
    tileRB.push(TT.n && lvl > 0 ? +(((TT.r - TT.b) / TT.n) / lvl).toFixed(3) : 0);
    if (TT.n > 50 && ms < minTileSat) { minTileSat = ms; minTileIdx = t2; }
    if (TT.n && TT.ach / TT.n > maxAchFrac) maxAchFrac = TT.ach / TT.n;
  }
  return {
    W: W, H: H, n: n,
    pctLum: pl, pctR: pr, pctG: pg, pctB: pb,
    bands: bandOut,
    structure: { dR: sig(dR), dG: sig(dG), dB: sig(dB), RoverG: sig(dR / dG), RoverB: sig(dR / dB) },
    tiles: { grid: G, sat: tileSat, rbBias: tileRB, minTileSat: sig(minTileSat), minTileIdx: minTileIdx, maxTileAchFrac: sig(maxAchFrac) },
    grainD2mad: sig(madOf(d2)), textureD8med: sig(pct(d8, 50)),
    grainRelSky: sig(madOf(d2) / sky), skyP25: sig(sky),
    fracAch: sig(nAch / n), fracSatLt01: sig(nSatLo / n),
    fracClipLo: sig(nClipLo / n), fracClipHi: sig(nClipHi / n)
  };
}
function __pfDownsampled(srcView, f, tag) {
  var simg = srcView.image;
  var w = new ImageWindow(simg.width, simg.height, simg.numberOfChannels, 32, true, simg.numberOfChannels > 1, "pf_tmp_" + tag);
  var v = w.mainView;
  v.beginProcess();
  v.image.assign(simg);
  v.endProcess();
  var P = new IntegerResample;
  P.zoomFactor = -f;
  P.executeOn(v);
  return w;
}
function runFiles(list, scales) {
  if (!scales) scales = [1, 2, 4, 8];
  var results = [];
  for (var i = 0; i < list.length; i++) {
    var path = list[i][0], name = list[i][1];
    var wins = ImageWindow.open(path);
    var win = wins[0];
    // WBPP masters spawn extra *crop_mask* windows on open; leaking one per file pollutes the
    // session and makes later view lookups ambiguous.
    for (var wi = 1; wi < wins.length; wi++) wins[wi].forceClose();
    var view = win.mainView;
    view.image.resetSelections();
    var out = { image: name, scales: {} };
    for (var fi = 0; fi < scales.length; fi++) {
      var f = scales[fi];
      if (f === 1) { out.scales["s1"] = __pfProfileView(view); continue; }
      var dw = __pfDownsampled(view, f, name.replace(/[^A-Za-z0-9]/g, "") + f);
      out.scales["s" + f] = __pfProfileView(dw.mainView);
      dw.forceClose();
    }
    win.forceClose();
    results.push(out);
  }
  return JSON.stringify(results);
}
"profiler v3 loaded";
