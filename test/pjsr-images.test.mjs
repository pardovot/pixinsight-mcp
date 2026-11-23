// The image handlers from the bundle, run in a Node context with substitutes for the PixInsight
// classes they use.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const bundlePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "pjsr", "mcp-handlers.js");

test("open_image shows every image a file holds", () => {
  let shown = 0;
  const window = (id) => ({
    filePath: "C:/in/pair.xisf",
    show: () => { ++shown; },
    mainView: { id, image: { width: 8, height: 4, numberOfChannels: 1, isColor: false, bitsPerSample: 32 } },
  });
  const context = createContext({ File: { exists: () => true }, ImageWindow: { open: () => [window("light"), window("light_mask")] } });
  runInContext(fs.readFileSync(bundlePath, "utf8"), context);

  const result = context.handleOpenImage({ parameters: { filePath: "C:/in/pair.xisf" } });
  assert.deepEqual([...result.outputs.images].map((image) => image.id), ["light", "light_mask"]);
  assert.equal(shown, 2);
});

test("save_image names the codec for XISF only, and fails on a missing folder or when PixInsight does not save", () => {
  let accepted = true;
  const main = { id: "M31", isNull: false, window: { saveAs: () => accepted } };
  const files = {
    exists: () => false,
    extractDrive: () => "C:",
    extractDirectory: (filePath) => filePath.slice(2, filePath.lastIndexOf("/")),
    directoryExists: (folder) => folder === "C:/out",
  };
  const context = createContext({ View: { viewById: () => main }, File: files });
  runInContext(fs.readFileSync(bundlePath, "utf8"), context);
  const save = (filePath) => context.handleSaveImage({ parameters: { viewId: "M31", filePath, overwrite: false, compression: "zstd+sh" } });

  assert.equal(save("C:/out/m31.xisf").outputs.hints, "compression-codec zstd+sh");
  assert.equal(save("C:/out/m31.tiff").outputs.hints, "");
  assert.throws(() => save("C:/missing/m31.xisf"), /No such folder: C:\/missing/);
  accepted = false;
  assert.throws(() => save("C:/out/m31.xisf"), /could not save M31/);
});

test("close_image refuses a preview and closes a main view's window", () => {
  let closed = 0;
  const window = { forceClose: () => { ++closed; } };
  const main = { id: "M31", isNull: false, isPreview: false, window };
  const preview = { id: "Preview01", isNull: false, isPreview: true, window };
  window.mainView = main;
  const views = { "M31": main, "M31->Preview01": preview };
  const context = createContext({ View: { viewById: (id) => views[id] } });
  runInContext(fs.readFileSync(bundlePath, "utf8"), context);

  assert.throws(() => context.handleCloseImage({ parameters: { viewId: "M31->Preview01" } }), /Preview01 is a preview of M31/);
  assert.equal(closed, 0);
  assert.equal(context.handleCloseImage({ parameters: { viewId: "M31" } }).status, "success");
  assert.equal(closed, 1);
});
