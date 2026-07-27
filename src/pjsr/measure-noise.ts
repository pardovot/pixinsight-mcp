/**
 * get_noise, per-channel MRS (multiresolution support) noise estimate.
 *
 * Why MRS and not stdDev: stdDev is signal-dominated on astro images (a measured
 * box-stdDev "noise rise" was a false alarm; noiseMRS() showed uniform ~8.5e-6).
 * noiseMRS() returns [sigma, count] on current PI builds; scalar handled defensively.
 */
export function noiseScript(viewId: string): string {
  const id = JSON.stringify(viewId);
  return `(function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var v = View.viewById(${id});
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + ${id}});
  var img = v.image;
  var n = Math.min(img.numberOfChannels, 3);
  var names = img.isColor ? ["R","G","B"] : ["K"];
  var total = img.width * img.height;
  var chans = [];
  for (var c = 0; c < n; ++c) {
    img.selectedChannel = c;
    var r = img.noiseMRS();
    var sigma, frac = null;
    if (r && typeof r === "object" && r.length !== undefined) {
      sigma = r[0];
      if (r.length > 1 && isFinite(r[1])) frac = (r[1] > 1) ? r[1]/total : r[1];
    } else {
      sigma = r;
    }
    chans.push({ channel: c, name: names[c] || ("C"+c), sigma: sig(sigma), pixelFraction: frac === null ? null : sig(frac) });
  }
  img.resetSelections();
  return JSON.stringify({ viewId: ${id}, method: "MRS", channels: chans });
})()`;
}
