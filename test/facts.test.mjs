// Fact guard unit tests, no PixInsight required. These assert the two behaviours
// that make the guard worth having: a verified defect is refused before it
// reaches PixInsight, and a legal-but-neutral call is left alone.
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkProcessCall,
  deadParamsFor,
  factsForProcess,
  formatBlocks,
  overrideEnabled,
} from "../build/facts/guard.js";
import { FACTS } from "../build/facts/facts.js";

const call = (processId, settings = {}, viewId = "img") => ({ processId, viewId, settings });

test("every fact that blocks tells the caller what to do instead", () => {
  for (const fact of FACTS) {
    if (fact.severity === "block") {
      assert.ok(fact.fix, `${fact.id} blocks without a fix`);
    }
    assert.ok(fact.verified.piVersion && fact.verified.date, `${fact.id} has no verification record`);
    assert.ok(fact.processes.length > 0, `${fact.id} applies to no process`);
  }
});

test("fact ids are unique", () => {
  const ids = FACTS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("SPCC narrowbandMode is refused, it deadlocks PixInsight", () => {
  const { blocks } = checkProcessCall(call("SpectrophotometricColorCalibration", { narrowbandMode: true }));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].fact.id, "spcc-narrowband-deadlock");
  const text = formatBlocks("SpectrophotometricColorCalibration", blocks);
  assert.match(text, /Refused/);
  assert.match(text, /filters\.xspd/);
});

test("SPCC in broadband mode is untouched", () => {
  const { blocks, warnings } = checkProcessCall(call("SpectrophotometricColorCalibration", { narrowbandMode: false }));
  assert.equal(blocks.length, 0);
  assert.equal(warnings.length, 0);
});

test("dead aliases are refused whatever the value, because the value cannot matter", () => {
  for (const value of [0.1, 0.9, true, null]) {
    const { blocks } = checkProcessCall(call("NoiseXTerminator", { denoise: value }));
    assert.equal(blocks.length, 1, `denoise=${JSON.stringify(value)} should be refused`);
    assert.deepEqual(blocks[0].params, ["denoise"]);
  }
});

test("the live NXT dials are not refused", () => {
  const { blocks } = checkProcessCall(
    call("NoiseXTerminator", { denoise_intensity_low_freq: 0.5, denoise_intensity_high_freq: 0.3 }),
  );
  assert.equal(blocks.length, 0);
});

test("process matching is case insensitive and covers the short name", () => {
  assert.equal(checkProcessCall(call("blurxterminator", { auto_nonstellar_psf: 3 })).blocks.length, 1);
  assert.equal(checkProcessCall(call("BXT", { nonstellar_psf_diameter: 3 })).blocks.length, 1);
});

test("PixelMath SameAsTarget is refused only in the global context", () => {
  const settings = { createNewImage: true, newImageColorSpace: 0 };
  assert.equal(checkProcessCall({ processId: "PixelMath", settings }).blocks.length, 1);
  assert.equal(checkProcessCall(call("PixelMath", settings, "someView")).blocks.length, 0);
});

test("MGC without a MARS database is refused, since it would silently no-op", () => {
  assert.equal(checkProcessCall(call("MultiscaleGradientCorrection", { useMARSDatabase: true })).blocks.length, 1);
  const configured = call("MultiscaleGradientCorrection", {
    useMARSDatabase: true,
    marsDatabaseFiles: [[true, "C:/db.xmars"]],
  });
  assert.equal(checkProcessCall(configured).blocks.length, 0);
});

test("HDRMT invertedIterations rejects a number, accepts a boolean", () => {
  assert.equal(checkProcessCall(call("HDRMultiscaleTransform", { invertedIterations: 3 })).blocks.length, 1);
  assert.equal(checkProcessCall(call("HDRMultiscaleTransform", { invertedIterations: true })).blocks.length, 0);
});

test("SCNR colorToRemove=0 warns rather than blocks, 0 is a legal value", () => {
  const { blocks, warnings } = checkProcessCall(call("SCNR", { colorToRemove: 0 }));
  assert.equal(blocks.length, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].fact.id, "scnr-colortoremove-is-red");
  assert.equal(checkProcessCall(call("SCNR", { colorToRemove: 1 })).warnings.length, 0);
});

test("a process with no facts is never blocked", () => {
  const { blocks, warnings } = checkProcessCall(call("Crop", { anything: 1 }));
  assert.equal(blocks.length, 0);
  assert.equal(warnings.length, 0);
});

test("dead parameter lookup is keyed lowercase for the parameter listing", () => {
  const dead = deadParamsFor("StarXTerminator");
  assert.ok(dead.has("starmask"));
  assert.ok(dead.has("linear"));
  assert.equal(dead.get("starmask").id, "sxt-nonexistent-params");
});

test("notes exist for the XT tools and never fire on a call", () => {
  assert.ok(factsForProcess("BlurXTerminator", "note").length > 0);
  const { blocks, warnings } = checkProcessCall(call("BlurXTerminator", { sharpen_stars: 0.5 }));
  assert.equal(blocks.length + warnings.length, 0);
});

test("the override is off unless a human sets the env var", () => {
  assert.equal(overrideEnabled(), false);
  process.env.PIXINSIGHT_MCP_ALLOW_UNSAFE = "1";
  assert.equal(overrideEnabled(), true);
  delete process.env.PIXINSIGHT_MCP_ALLOW_UNSAFE;
});
