// Image windows: list, open, save, close and statistics.

// The codecs the save_image tool offers. A typo from a direct caller is rejected instead of
// left to the writer.
var SAVE_CODECS = ["zlib", "zlib+sh", "zstd", "zstd+sh", "lz4", "lz4+sh", "lz4hc", "lz4hc+sh", "none"];

// Compressed by default. On a 6159x7396 float RGB master: 521.7 MB -> 384.2 MB.
var DEFAULT_SAVE_CODEC = "zlib+sh";

function describeWindow(window) {
   var image = window.mainView.image;
   return {
      id: window.mainView.id,
      filePath: window.filePath || null,
      width: image.width,
      height: image.height,
      channels: image.numberOfChannels,
      isColor: image.isColor,
      bitDepth: image.bitsPerSample
   };
}

function handleListOpenImages() {
   var images = Array.prototype.map.call(ImageWindow.windows, describeWindow);
   return success({ images: images }, images.length + " open image(s)");
}

function handleOpenImage(command) {
   var path = command.parameters.filePath;
   if (!File.exists(path))
      throw new Error("No such file: " + path);
   var opened = ImageWindow.open(path);
   if (!opened.length)
      throw new Error("PixInsight could not open " + path);
   opened[0].show();
   var info = describeWindow(opened[0]);
   return success({ id: info.id, width: info.width, height: info.height, channels: info.channels },
                  "Opened " + info.id);
}

function handleSaveImage(command) {
   var parameters = command.parameters;
   var path = parameters.filePath;
   var codec = parameters.compression || DEFAULT_SAVE_CODEC;
   if (SAVE_CODECS.indexOf(codec) < 0)
      throw new Error("Unknown compression codec " + codec + ", expected one of " + SAVE_CODECS.join(", "));
   if (File.exists(path) && !parameters.overwrite)
      throw new Error(path + " already exists, pass overwrite to replace it");
   var window = requireView(parameters.viewId).window;

   // XISF always gets an explicit codec. An empty hints string means "format defaults", and
   // those defaults are session mutable: one saveAs with a codec hint changes them, so a later
   // empty hint save inherits it (the same image wrote 16.95 MB with "", then 12.07 MB with ""
   // after a single zlib+sh save). Other writers reject an unknown codec hint, so they get none.
   var hints = /\.xisf$/i.test(path) ? "compression-codec " + codec : "";
   window.saveAs(path, false, false, false, false, hints);

   // PJSR has no File.size(), FileInfo carries the size.
   var bytes = File.exists(path) ? new FileInfo(path).size : -1;
   return success({ filePath: path, hints: hints, bytes: bytes },
                  "Saved " + parameters.viewId + " to " + path);
}

function handleCloseImage(command) {
   var view = requireView(command.parameters.viewId);
   view.window.forceClose();
   return success({}, "Closed " + view.id);
}

function handleGetImageStatistics(command) {
   var view = requireView(command.parameters.viewId);
   var image = view.image;
   var names = image.isColor ? ["Red", "Green", "Blue"] : ["Gray"];
   var statistics = [];
   try {
      for (var channel = 0; channel < image.numberOfChannels; ++channel) {
         image.selectedChannel = channel;
         statistics.push({
            channel: channel,
            channelName: names[channel] || "Channel " + channel,
            mean: image.mean(),
            median: image.median(),
            stdDev: image.stdDev(),
            min: image.minimum(),
            max: image.maximum()
         });
      }
   } finally {
      image.resetSelections();
   }
   return success({ statistics: statistics }, view.id + ": " + statistics.length + " channel(s)");
}
