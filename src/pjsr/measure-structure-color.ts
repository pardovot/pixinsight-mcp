/**
 * get_structure_color, the two chroma measurements that R12 (M16) proved were missing.
 *
 * WHY THIS EXISTS. On R12 the agent twice concluded "colour was preserved" from region MEDIANS
 * and from bgChroma, and both times was wrong: it had inverted strongly red Ha structure to cyan
 * and shipped it. Two independent blind spots:
 *
 *  1. structure, a region's MEDIAN is the SKY. The nebulosity is structure INSIDE that region, so
 *     averaging buries it. On a field with a global cast the sky dominates the median completely.
 *     The honest measure is the colour of the structure itself:
 *         (bright population - dark population), split by LUMINANCE, stars excluded.
 *     Splitting by luminance rather than by colour matters: splitting by colour is circular.
 *     R12: structure R/G was 1.547 in the linear input and 0.917 in the delivered image, while the
 *     region median barely moved.
 *
 *  2. spatialChroma, bgChroma is a magnitude-only SCALAR and cannot see localized chroma death.
 *     It read 0.0252 ("better than the 0.05 reference") while 72.5% of one corner sat at exactly
 *     R=G=B, because averaging deleted colour with retained colour lands on "good". Any operation
 *     that pulls pixels toward luminance (the background-work.md teal gate, a desaturation mask)
 *     can zero chroma in patches, and only a per-tile check finds it.
 *
 * Sampling: one stride-grid pass shared by both metrics. Star rejection compares each grid sample
 * against its 4 grid neighbours (at a typical stride a star occupies at most one sample), so a
 * bright spike is dropped rather than counted as "structure".
 */
export function structureColorScript(
  viewId: string,
  rect: [number, number, number, number] | null,
  tileGrid: number,
  targetSamples: number
): string {
  const id = JSON.stringify(viewId);
  const r = rect ? JSON.stringify(rect) : "null";
  return `(function(){
  var sig = function(x){ return (typeof x === "number" && isFinite(x)) ? Number(x.toPrecision(6)) : x; };
  var median = function(a){ if (!a.length) return null; var s = a.slice().sort(function(p,q){return p-q;}); var m = s.length >> 1; return (s.length % 2) ? s[m] : (s[m-1]+s[m])/2; };
  var v = View.viewById(${id});
  if (!v || v.isNull) return JSON.stringify({error: "Image not found: " + ${id}});
  var img = v.image;
  if (!img.isColor) return JSON.stringify({error: "get_structure_color requires a color image"});

  var X0 = 0, Y0 = 0, X1 = img.width, Y1 = img.height;
  var rc = ${r};
  if (rc) {
    X0 = Math.max(0, Math.min(img.width-1,  Math.trunc(rc[0])));
    Y0 = Math.max(0, Math.min(img.height-1, Math.trunc(rc[1])));
    X1 = Math.max(X0+2, Math.min(img.width,  Math.trunc(rc[2])));
    Y1 = Math.max(Y0+2, Math.min(img.height, Math.trunc(rc[3])));
  }
  var rw = X1-X0, rh = Y1-Y0;
  var stride = Math.max(1, Math.floor(Math.sqrt(rw*rh/${Math.trunc(targetSamples)})));

  // ---- one stride-grid pass, row-bulk reads (exact samples, no interpolation)
  var gw = 0, gh = 0;
  var gR = [], gG = [], gB = [];
  var buf = [];
  for (var y = Y0; y < Y1; y += stride) {
    var rowR = [], rowG = [], rowB = [];
    for (var c = 0; c < 3; ++c) {
      img.selectedChannel = c;
      img.selectedRect = new Rect(X0, y, X1, y+1);
      img.getSamples(buf);
      var dst = (c === 0) ? rowR : (c === 1) ? rowG : rowB;
      for (var x = 0; x < rw; x += stride) dst.push(buf[x]);
    }
    gR.push(rowR); gG.push(rowG); gB.push(rowB);
    if (rowR.length > gw) gw = rowR.length;
    ++gh;
  }
  img.resetSelections();
  if (gh < 3 || gw < 3) return JSON.stringify({error: "Region too small to sample (need >= 3x3 grid samples)"});

  // ---- luminance grid + star rejection against 4 grid neighbours
  var L = [];
  for (var j = 0; j < gh; ++j) {
    var rowL = [];
    for (var i = 0; i < gR[j].length; ++i) rowL.push((gR[j][i]+gG[j][i]+gB[j][i])/3);
    L.push(rowL);
  }
  var px = [];              // { L, r, g, b } for non-star samples
  var nStarRejected = 0;
  for (var j2 = 1; j2 < gh-1; ++j2) {
    var row = gR[j2];
    for (var i2 = 1; i2 < row.length-1; ++i2) {
      if (i2 >= L[j2-1].length || i2 >= L[j2+1].length) continue;
      var c0 = L[j2][i2];
      if (!(c0 > 0)) continue;
      var nb = (L[j2][i2-1] + L[j2][i2+1] + L[j2-1][i2] + L[j2+1][i2]) / 4;
      if (nb > 0 && c0 > nb*1.25) { ++nStarRejected; continue; }   // bright spike = star
      px.push({ L: c0, r: gR[j2][i2], g: gG[j2][i2], b: gB[j2][i2] });
    }
  }
  if (px.length < 50) return JSON.stringify({error: "Too few non-star samples in region (" + px.length + ")"});

  // ---- 1) STRUCTURE COLOUR = bright population minus dark population
  px.sort(function(a,b){ return a.L - b.L; });
  var n = px.length, q1 = Math.floor(n*0.20), q3 = Math.floor(n*0.80);
  var dR=0,dG=0,dB=0,dL=0,dn=0, bR=0,bG=0,bB=0,bL=0,bn=0;
  for (var i3 = 0; i3 < q1; ++i3){ dR+=px[i3].r; dG+=px[i3].g; dB+=px[i3].b; dL+=px[i3].L; ++dn; }
  for (var i4 = q3; i4 < n; ++i4){ bR+=px[i4].r; bG+=px[i4].g; bB+=px[i4].b; bL+=px[i4].L; ++bn; }
  var Dr=dR/dn, Dg=dG/dn, Db=dB/dn, Dl=dL/dn;
  var Br=bR/bn, Bg=bG/bn, Bb=bB/bn, Bl=bL/bn;
  var sR=Br-Dr, sG=Bg-Dg, sB=Bb-Db;

  // ---- 2) SPATIAL CHROMA, per-tile, catches localized chroma death
  var TG = ${Math.trunc(tileGrid)};
  var tiles = [];
  for (var t = 0; t < TG*TG; ++t) tiles.push([]);
  var nExact = 0, nAll = 0, satAll = [];
  for (var j3 = 0; j3 < gh; ++j3) {
    for (var i5 = 0; i5 < gR[j3].length; ++i5) {
      var rr=gR[j3][i5], gg=gG[j3][i5], bb=gB[j3][i5];
      var mx = Math.max(rr, Math.max(gg, bb)), mn = Math.min(rr, Math.min(gg, bb));
      var sat = mx > 0 ? (mx-mn)/mx : 0;
      ++nAll; if (mx-mn <= 0) ++nExact;
      satAll.push(sat);
      var tx = Math.min(TG-1, Math.floor(i5 / Math.max(1, gR[j3].length/TG)));
      var ty = Math.min(TG-1, Math.floor(j3 / Math.max(1, gh/TG)));
      tiles[ty*TG+tx].push(sat);
    }
  }
  var tileSat = [], minT = null, minTi = -1;
  for (var t2 = 0; t2 < tiles.length; ++t2) {
    var m2 = tiles[t2].length ? median(tiles[t2]) : null;
    tileSat.push(m2 === null ? null : sig(m2));
    if (m2 !== null && (minT === null || m2 < minT)) { minT = m2; minTi = t2; }
  }
  var maxT = null;
  for (var t3 = 0; t3 < tileSat.length; ++t3) if (tileSat[t3] !== null && (maxT === null || tileSat[t3] > maxT)) maxT = tileSat[t3];

  return JSON.stringify({
    viewId: ${id},
    rect: [X0, Y0, X1, Y1],
    stride: stride,
    gridSamples: nAll,
    starSamplesRejected: nStarRejected,
    structure: {
      deltaRGB: [sig(sR), sig(sG), sig(sB)],
      RoverG: sig(sG !== 0 ? sR/sG : null),
      RoverB: sig(sB !== 0 ? sR/sB : null),
      darkPopulation:   { RGB: [sig(Dr), sig(Dg), sig(Db)], L: sig(Dl), n: dn },
      brightPopulation: { RGB: [sig(Br), sig(Bg), sig(Bb)], L: sig(Bl), n: bn },
      note: "Colour of the STRUCTURE, not the sky: bright minus dark population, split by luminance, stars excluded. Compare RoverG/RoverB across pipeline stages; a drop toward or below 1.0 on an Ha field means red structure is being neutralized. Region MEDIANS cannot see this."
    },
    spatialChroma: {
      medianSaturation: sig(median(satAll)),
      pctExactlyAchromatic: sig(100*nExact/nAll),
      tileGrid: TG,
      minTileSaturation: sig(minT),
      maxTileSaturation: sig(maxT),
      minTileIndex: minTi,
      minTileRowCol: minTi < 0 ? null : [Math.floor(minTi/TG), minTi%TG],
      tileMedianSaturation: tileSat,
      note: "Per-tile, because a scalar bgChroma cannot see localized chroma death (it averages deleted colour with retained colour). A minTileSaturation near zero, or pctExactlyAchromatic above ~1%, means an operation zeroed chroma in patches. NOTE: 8-bit sources make pctExactlyAchromatic quantization-limited; on float data it is exact."
    }
  });
})()`;
}
