/*
 * OSC-RGB linear stage, one-shot replay-style recipe.
 * Chain (R8 Rho Oph + R11 M31 validated): headroom guard -> BXT correct-only -> [SPFC ->
 * MGC/MARS, decline-detected] -> GradientCorrection fallback -> SPCC broadband -> BXT sharpen ->
 * NXT -> SXT split. End-state checks only (gradient flat, no clipping, SXT produced stars);
 * per-step medians are recorded for failure triage but nothing gates mid-run.
 *
 * Run via the MCP watcher (run_script) or the Script Editor:
 *   (0,eval)(File.readTextFile("<repo>/recipes/osc-rgb-linear.js"));
 *   OSC_RGB_LINEAR({ src: "path/to/linear_master.xisf", out: "optional/save/dir" });
 * Returns a JSON string report. Leaves <base>_starless and <base>_stars open for the
 * nonlinear stage.
 *
 * cfg:
 *   src          REQUIRED path to the linear, plate-solved OSC master (color, 3ch)
 *   out          optional dir; saves <base>_linear.xisf + starless/stars when set
 *   baseName     view id base, default "osc"
 *   xspd         filters.xspd path (default: derived from the PixInsight install)
 *   mars         .xmars path, array of paths, or dir; default: probe the per-OS XMARS dir.
 *                No MARS found => skip SPFC (only MGC needs it) and go straight to GC.
 *   filterPrefix SPFC/SPCC filter curve family, default "Sony Color Sensor" (IMX571 etc.)
 *   gradientScale MGC gradient scale, default 1024
 *   bxtNonstellar/bxtStars  sharpen amounts, default 0.8 / 0.2
 *   nxtDenoise/nxtDetail    default 0.8 / 0.15
 *   goldenCrop   optional {x0,y0,w,h}: adds per-channel medians of starless+stars in that
 *                rect to the report (regression fingerprint for the golden test)
 *   gradRelMax / clipHiMax  check thresholds, defaults 0.6 / 5e-4
 *
 * Rules this file obeys (same as replay.js): no '#' directives (V8 eval reads '#' as
 * private-field syntax), every line under ~255 chars (PI's preprocessor truncates).
 */

function OSC_RGB_LINEAR(cfg) {
   if (!cfg || !cfg.src) throw new Error("cfg.src required");
   var base = cfg.baseName || "osc";
   var report = { recipe: "osc-rgb-linear", rev: 1, src: cfg.src, steps: [], checks: {} };

   // ---------- path derivation (cross-platform: probe, never hardcode) ----------
   function firstExisting(cands) {
      for (var i = 0; i < cands.length; i++) if (cands[i] && File.exists(cands[i])) return cands[i];
      return null;
   }
   function env(name) {
      try { if (typeof System !== "undefined" && System.getEnvironmentVariable) return System.getEnvironmentVariable(name); } catch (e) {}
      try { return getEnvironmentVariable(name); } catch (e2) { return ""; }
   }
   var xspdCands = [cfg.xspd];
   try {
      xspdCands.push(CoreApplication.dirPath + "/../library/filters.xspd");
      xspdCands.push(CoreApplication.dirPath + "/../../library/filters.xspd");
   } catch (e) { /* CoreApplication unavailable, per-platform fallbacks below */ }
   var pf = env("ProgramFiles");
   if (pf) xspdCands.push(pf + "/PixInsight/library/filters.xspd");     // Windows
   xspdCands.push("/Applications/PixInsight/library/filters.xspd");     // macOS [unverified]
   xspdCands.push("/opt/PixInsight/library/filters.xspd");              // Linux [unverified]
   var xspd = firstExisting(xspdCands);
   if (!xspd) throw new Error("filters.xspd not found; pass cfg.xspd");
   function findMars() {
      if (cfg.mars) {
         var m = cfg.mars;
         if (typeof m === "string" && m.length > 6 && m.substring(m.length - 6) === ".xmars") return [m];
         if (m instanceof Array) return m;
         // else treat as a directory, fall through to the scan with it first
      }
      var dirs = [];
      if (cfg.mars && typeof cfg.mars === "string") dirs.push(cfg.mars);
      var appData = env("APPDATA");                                    // Windows
      if (appData) dirs.push(appData + "/Pleiades/XMARS");
      var home = File.homeDirectory;
      dirs.push(home + "/Library/Application Support/Pleiades/XMARS"); // macOS [unverified]
      dirs.push(home + "/.local/share/Pleiades/XMARS");                // Linux [unverified]
      for (var d = 0; d < dirs.length; d++) {
         try {
            var hits = searchDirectory(dirs[d] + "/*.xmars");
            if (hits && hits.length) return hits;
         } catch (e) { /* dir missing, keep probing */ }
      }
      return [];
   }
   var marsFiles = findMars();
   report.marsFiles = marsFiles;

   // ---------- helpers ----------
   function grabCurve(name) {
      var txt = File.readTextFile(xspd);
      var i = txt.indexOf('name="' + name + '"'); if (i < 0) throw new Error("curve missing in filters.xspd: " + name);
      var d = txt.indexOf('data="', i), e = txt.indexOf('"', d + 6);
      return txt.substring(d + 6, e);
   }
   function med(v) { var m = v.image.median(); return m; }
   function step(name, fn, v) {
      fn();
      report.steps.push({ step: name, medianAfter: +med(v).toFixed(7) });
   }
   function rectMedians(img, r) {
      var out = [];
      for (var c = 0; c < 3; c++) {
         img.selectedRect = r; img.selectedChannel = c;
         out.push(+img.median().toFixed(7));
         img.resetSelections();
      }
      return out;
   }

   // ---------- open + input guards ----------
   var wins = ImageWindow.open(cfg.src);
   if (!wins.length) throw new Error("open failed: " + cfg.src);
   for (var wi = 1; wi < wins.length; wi++) wins[wi].forceClose(); // e.g. autocrop mask windows
   var w = wins[0]; w.show();
   var v = w.mainView; v.id = base;
   var img = v.image;
   if (img.numberOfChannels < 3) { w.forceClose(); throw new Error("input is not a color image"); }
   if (!w.hasAstrometricSolution) { w.forceClose(); throw new Error("no astrometric solution; plate-solve first (ImageSolver), recipe needs WCS for SPFC/MGC/SPCC"); }
   var med0 = med(v);
   if (med0 > 0.05) { w.forceClose(); throw new Error("median " + med0.toFixed(4) + " looks nonlinear; recipe takes LINEAR input"); }
   report.steps.push({ step: "open", medianAfter: +med0.toFixed(7) });

   // ---------- headroom guard (R11: BXT sharpen needs ~(FWHMb/FWHMa)^2 headroom, 3x held) ----------
   var mx = img.maximum();
   if (mx > 0.95) {
      var P0 = new PixelMath; P0.expression = "$T*(1/3)"; P0.useSingleExpression = true; P0.createNewImage = false;
      P0.executeOn(v);
      report.steps.push({ step: "headroom_x0.333", medianAfter: +med(v).toFixed(7) });
   } else {
      report.steps.push({ step: "headroom_skipped_max_" + mx.toFixed(3) });
   }

   // ---------- process factories ----------
   var FP = cfg.filterPrefix || "Sony Color Sensor";
   // auto_nonstellar_psf is a DEAD alias in current BXT; auto_nonstellar_radius is live. Set both.
   function fBxtCorrect() { var P = new BlurXTerminator; P.correct_only = true; P.auto_nonstellar_psf = true; P.auto_nonstellar_radius = true; return P; }
   function fSpfc() {
      var P = new SpectrophotometricFluxCalibration; P.narrowbandMode = false;
      P.redFilterName = FP + " R"; P.redFilterTrCurve = grabCurve(FP + " R");
      P.greenFilterName = FP + " G"; P.greenFilterTrCurve = grabCurve(FP + " G");
      P.blueFilterName = FP + " B"; P.blueFilterTrCurve = grabCurve(FP + " B");
      P.grayFilterName = FP + " G"; P.grayFilterTrCurve = grabCurve(FP + " G");
      P.deviceQECurveName = "Ideal QE curve"; P.deviceQECurve = grabCurve("Ideal QE curve");
      P.autoLimitMagnitude = true; P.generateGraphs = false; P.generateTextFiles = false; P.generateStarMaps = false;
      return P;
   }
   function fMgc() {
      var P = new MultiscaleGradientCorrection; P.useMARSDatabase = true;
      var t = []; for (var i = 0; i < marsFiles.length; i++) t.push([true, marsFiles[i]]);
      P.marsDatabaseFiles = t;
      P.structureSeparation = 3; P.modelSmoothness = 1; P.gradientScale = cfg.gradientScale || 1024; P.showGradientModel = false;
      return P;
   }
   function fGc() { var P = new GradientCorrection; P.protection = true; P.protectionThreshold = 0.1; P.protectionAmount = 0.5; P.scale = 5; P.smoothness = 0.4; return P; }
   function fSpcc() {
      var P = new SpectrophotometricColorCalibration; P.narrowbandMode = false;
      P.redFilterName = FP + " R"; P.redFilterTrCurve = grabCurve(FP + " R");
      P.greenFilterName = FP + " G"; P.greenFilterTrCurve = grabCurve(FP + " G");
      P.blueFilterName = FP + " B"; P.blueFilterTrCurve = grabCurve(FP + " B");
      P.deviceQECurveName = "Ideal QE curve"; P.deviceQECurve = grabCurve("Ideal QE curve");
      // white reference stays at the default (Average Spiral Galaxy), the documented natural-color standard
      P.neutralizeBackground = true; P.applyCalibration = true; P.autoLimitMagnitude = true;
      P.generateGraphs = false; P.generateStarMaps = false; P.generateTextFiles = false;
      return P;
   }
   function fBxtSharpen() {
      var P = new BlurXTerminator; P.correct_only = false; P.auto_nonstellar_psf = true; P.auto_nonstellar_radius = true;
      P.sharpen_nonstellar = (cfg.bxtNonstellar !== undefined) ? cfg.bxtNonstellar : 0.8;
      P.sharpen_stars = (cfg.bxtStars !== undefined) ? cfg.bxtStars : 0.2;
      return P;
   }
   function fNxt() {
      var P = new NoiseXTerminator;
      P.denoise = (cfg.nxtDenoise !== undefined) ? cfg.nxtDenoise : 0.8;
      P.detail = (cfg.nxtDetail !== undefined) ? cfg.nxtDetail : 0.15;
      return P;
   }
   function fSxt() { var P = new StarXTerminator; P.stars = true; P.unscreen = false; P.unscreen_stars = false; return P; }

   // ---------- the chain ----------
   step("bxt_correct_only", function() { fBxtCorrect().executeOn(v); }, v);

   // gradient: MGC when MARS is on disk (SPFC first, MGC hard-requires it), else GC directly.
   // MGC DECLINE TRAP (R8, dec -24): outside MARS coverage executeOn returns false OR leaves
   // stats byte-identical, no exception. Detect both, fall back to GradientCorrection.
   report.mgc = { attempted: false, declined: false, fallback: null };
   if (marsFiles.length) {
      step("spfc", function() { fSpfc().executeOn(v); }, v);
      report.mgc.attempted = true;
      var medBefore = med(v);
      var ok = false;
      try { ok = fMgc().executeOn(v); } catch (e) { ok = false; report.mgc.error = e.message; }
      var medAfter = med(v);
      if (!ok || Math.abs(medAfter - medBefore) < 1e-12) {
         report.mgc.declined = true; report.mgc.fallback = "GradientCorrection";
         step("gradient_correction_fallback", function() { fGc().executeOn(v); }, v);
      } else {
         report.steps.push({ step: "mgc", medianAfter: +medAfter.toFixed(7) });
      }
   } else {
      report.mgc.fallback = "GradientCorrection";
      step("gradient_correction_no_mars", function() { fGc().executeOn(v); }, v);
   }

   step("spcc", function() { fSpcc().executeOn(v); }, v);
   step("bxt_sharpen", function() { fBxtSharpen().executeOn(v); }, v);
   step("nxt", function() { fNxt().executeOn(v); }, v);
   // explicit codec: XISF format hints are session-sticky, an unhinted save is non-deterministic
   if (cfg.out) w.saveAs(cfg.out + "/" + base + "_linear.xisf", false, false, false, false, "compression-codec zlib+sh");

   step("sxt_split", function() { fSxt().executeOn(v); }, v);
   v.id = base + "_starless";
   var wStars = ImageWindow.windowById(base + "_stars");
   if (wStars.isNull) throw new Error("SXT did not produce " + base + "_stars");

   // ---------- end-state checks (the only gate) ----------
   var sImg = v.image, W = sImg.width, H = sImg.height;
   var bw = Math.floor(W * 0.1), bh = Math.floor(H * 0.1);
   var ix = Math.floor(W * 0.05), iy = Math.floor(H * 0.05);
   var corners = [
      rectMedians(sImg, new Rect(ix, iy, ix + bw, iy + bh)),
      rectMedians(sImg, new Rect(W - ix - bw, iy, W - ix, iy + bh)),
      rectMedians(sImg, new Rect(ix, H - iy - bh, ix + bw, H - iy)),
      rectMedians(sImg, new Rect(W - ix - bw, H - iy - bh, W - ix, H - iy))
   ];
   var center = rectMedians(sImg, new Rect((W - bw) >> 1, (H - bh) >> 1, (W + bw) >> 1, (H + bh) >> 1));
   var cLum = [], k;
   for (k = 0; k < 4; k++) cLum.push((corners[k][0] + corners[k][1] + corners[k][2]) / 3);
   var cMin = Math.min(cLum[0], cLum[1], cLum[2], cLum[3]), cMax = Math.max(cLum[0], cLum[1], cLum[2], cLum[3]);
   var ctr = (center[0] + center[1] + center[2]) / 3;
   var skyRef = Math.min(ctr, cMin);
   var rampRel = skyRef > 0 ? (cMax - cMin) / skyRef : 999;
   var gradRelMax = (cfg.gradRelMax !== undefined) ? cfg.gradRelMax : 0.6;
   report.checks.gradient = { cornerMedians: cLum.map(function(x){ return +x.toFixed(7); }), center: +ctr.toFixed(7),
      rampRel: +rampRel.toFixed(4), pass: rampRel <= gradRelMax };

   // sampled clip fractions on the starless + lit fraction on the stars layer
   function sampleStats(image) {
      var sw = image.width, sh = image.height, stride = Math.max(1, Math.floor(Math.sqrt(sw * sh / 100000)));
      var n = 0, hi = 0, lo = 0, lit = 0, pk = 0;
      for (var y = 0; y < sh; y += stride) for (var x = 0; x < sw; x += stride) {
         var r = image.sample(x, y, 0), g = image.sample(x, y, 1), b = image.sample(x, y, 2);
         var m = Math.max(r, g, b); n++;
         if (m >= 0.999) hi++;
         if (m <= 0) lo++;
         if (m > 0.02) lit++;
         if (m > pk) pk = m;
      }
      return { n: n, fracHi: hi / n, fracLo: lo / n, fracLit: lit / n, peak: pk };
   }
   var ss = sampleStats(sImg);
   var clipHiMax = (cfg.clipHiMax !== undefined) ? cfg.clipHiMax : 5e-4;
   report.checks.clipping = { fracHi: +ss.fracHi.toFixed(6), fracLo: +ss.fracLo.toFixed(6),
      pass: ss.fracHi <= clipHiMax && ss.fracLo <= 1e-5 };
   var st = sampleStats(wStars.mainView.image);
   report.checks.stars = { peak: +st.peak.toFixed(4), fracLit: +st.fracLit.toFixed(5),
      pass: st.peak > 0.05 && st.fracLit > 0 };
   report.checks.ok = report.checks.gradient.pass && report.checks.clipping.pass && report.checks.stars.pass;

   if (cfg.goldenCrop) {
      var gc = cfg.goldenCrop, gr = new Rect(gc.x0, gc.y0, gc.x0 + gc.w, gc.y0 + gc.h);
      report.goldenCrop = { rect: [gc.x0, gc.y0, gc.w, gc.h],
         starless: rectMedians(sImg, gr), stars: rectMedians(wStars.mainView.image, gr) };
   }

   if (cfg.out) {
      v.window.saveAs(cfg.out + "/" + base + "_linear_starless.xisf", false, false, false, false, "compression-codec zlib+sh");
      wStars.saveAs(cfg.out + "/" + base + "_linear_stars.xisf", false, false, false, false, "compression-codec zlib+sh");
   }
   report.views = { starless: base + "_starless", stars: base + "_stars" };
   return JSON.stringify(report);
}
"osc-rgb-linear recipe loaded";
