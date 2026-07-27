/**
 * get_background_neutrality, two mode-specific metrics:
 *
 *  linear     , the validated pre-stretch metric: per-channel medians over the
 *                diffuse-sky band (luminance within ±8% of median L), spread% of
 *                those medians. ≤1% = neutral (run-verified gate).
 *  poststretch, the ±8% band metric LIES after stretch/neutralization (it catches
 *                protected nebula-edge pixels). Honest metrics instead:
 *                (a) bgChroma = mean saturation of the near-neutral population
 *                    (|rex| < 0.01), rex ≡ signalChannel − mean(other two);
 *                (b) faint/bright signal-channel medians (rex ∈ [0.02,0.05] / > 0.05)
 *                    so a caller can compute the preservation ratio across a
 *                    before/after pair of calls.
 *
 * Sampling: row-bulk reads (selection + getSamples) on a stride grid, exact
 * values, no interpolation, ~150k samples regardless of image size.
 */
export function neutralityScript(
  viewId: string,
  mode: "linear" | "poststretch",
  signalChannel: "R" | "G" | "B",
  targetSamples: number
): string {
  const id = JSON.stringify(viewId);
  const sc = { R: 0, G: 1, B: 2 }[signalChannel];
  return `(function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var median = function(a){ if (!a.length) return null; var s = a.slice().sort(function(p,q){return p-q;}); var m = s.length >> 1; return (s.length % 2) ? s[m] : (s[m-1]+s[m])/2; };
  var v = View.viewById(${id});
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + ${id}});
  var img = v.image;
  if (!img.isColor) return JSON.stringify({error: "get_background_neutrality requires a color image"});
  var w = img.width, h = img.height;
  var stride = Math.max(1, Math.floor(Math.sqrt(w*h/${Math.trunc(targetSamples)})));

  var R = [], G = [], B = [];
  var buf = [];
  for (var y = 0; y < h; y += stride) {
    for (var c = 0; c < 3; ++c) {
      img.selectedChannel = c;
      img.selectedRect = new Rect(0, y, w, y+1);
      img.getSamples(buf);
      var dst = (c === 0) ? R : (c === 1) ? G : B;
      for (var x = 0; x < w; x += stride) dst.push(buf[x]);
    }
  }
  img.resetSelections();
  var n = R.length;

  if (${JSON.stringify(mode)} === "linear") {
    var L = new Array(n);
    for (var i = 0; i < n; ++i) L[i] = (R[i]+G[i]+B[i])/3;
    var Lmed = median(L);
    var bandR = [], bandG = [], bandB = [];
    for (var i = 0; i < n; ++i)
      if (Math.abs(L[i] - Lmed) <= 0.08*Lmed) { bandR.push(R[i]); bandG.push(G[i]); bandB.push(B[i]); }
    var mR = median(bandR), mG = median(bandG), mB = median(bandB);
    var mx = Math.max(mR,mG,mB), mn = Math.min(mR,mG,mB), avg = (mR+mG+mB)/3;
    return JSON.stringify({ viewId: ${id}, mode: "linear", samples: n, stride: stride,
      luminanceMedian: sig(Lmed), bandCount: bandR.length,
      perChannelMedian: { R: sig(mR), G: sig(mG), B: sig(mB) },
      spreadPct: sig(avg > 0 ? 100*(mx-mn)/avg : null),
      note: "spreadPct <= 1 = neutral. Valid PRE-stretch only; use mode:poststretch after stretching." });
  }

  // poststretch
  var scIdx = ${sc};
  var nearR = [], nearG = [], nearB = [], nearSat = [];
  var faint = [], bright = [];
  for (var i = 0; i < n; ++i) {
    var ch = [R[i], G[i], B[i]];
    var s = ch[scIdx];
    var others = (ch[0]+ch[1]+ch[2] - s)/2;
    var rex = s - others;
    if (Math.abs(rex) < 0.01) {
      nearR.push(R[i]); nearG.push(G[i]); nearB.push(B[i]);
      var mx = Math.max(ch[0],ch[1],ch[2]), mn = Math.min(ch[0],ch[1],ch[2]);
      if (mx > 0) nearSat.push((mx-mn)/mx);
    } else if (rex >= 0.02 && rex <= 0.05) faint.push(s);
    else if (rex > 0.05) bright.push(s);
  }
  var satMean = null;
  if (nearSat.length) { var t = 0; for (var i = 0; i < nearSat.length; ++i) t += nearSat[i]; satMean = t/nearSat.length; }
  return JSON.stringify({ viewId: ${id}, mode: "poststretch", signalChannel: ${JSON.stringify(signalChannel)}, samples: n, stride: stride,
    nearNeutral: { count: nearR.length, perChannelMedian: { R: sig(median(nearR)), G: sig(median(nearG)), B: sig(median(nearB)) }, bgChroma: sig(satMean) },
    faint: { count: faint.length, signalMedian: sig(median(faint)) },
    bright: { count: bright.length, signalMedian: sig(median(bright)) },
    note: "bgChroma tracks neutrality post-stretch. faint/bright signalMedian: compare across before/after calls for the preservation ratio (~100% = preserved)." });
})()`;
}
