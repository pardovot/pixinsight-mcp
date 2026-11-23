// Image windows: list, open, save, close and statistics.

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

// A file can hold several images, and each opens in a window of its own.
function handleOpenImage(command) {
   var path = command.parameters.filePath;
   if (!File.exists(path))
      throw new Error("No such file: " + path);
   var opened = ImageWindow.open(path);
   if (!opened.length)
      throw new Error("PixInsight could not open " + path);
   var images = Array.prototype.map.call(opened, function (window) {
      window.show();
      return describeWindow(window);
   });
   return success({ images: images }, "Opened " + images.map(function (image) { return image.id; }).join(", "));
}

function handleSaveImage(command) {
   var parameters = command.parameters;
   var path = parameters.filePath;
   if (File.exists(path) && !parameters.overwrite)
      throw new Error(path + " already exists, pass overwrite to replace it");
   requireFolderOf(path);
   var window = requireView(parameters.viewId).window;

   // XISF always gets an explicit codec. An empty hints string means "format defaults", and
   // those defaults are session mutable: one saveAs with a codec hint changes them, so a later
   // empty hint save inherits it (the same image wrote 16.95 MB with "", then 12.07 MB with ""
   // after a single zlib+sh save). Other writers reject an unknown codec hint, so they get none.
   var hints = /\.xisf$/i.test(path) ? "compression-codec " + parameters.compression : "";
   // saveAs returns false when the writer refuses, and says why only in the Process Console.
   if (!window.saveAs(path, false, false, false, false, hints))
      throw new Error("PixInsight could not save " + parameters.viewId + " to " + path +
                      ". Its reason is in the Process Console.");

   // PJSR has no File.size(), FileInfo carries the size.
   var bytes = File.exists(path) ? new FileInfo(path).size : -1;
   return success({ filePath: path, hints: hints, bytes: bytes },
                  "Saved " + parameters.viewId + " to " + path);
}

// A preview id is refused, since closing its window would close the whole image.
function handleCloseImage(command) {
   var view = requireView(command.parameters.viewId);
   if (view.isPreview)
      throw new Error(view.id + " is a preview of " + view.window.mainView.id +
         ". close_image closes whole image windows, pass the main view id to close the image");
   var viewId = view.id;
   view.window.forceClose();
   return success({}, "Closed " + viewId);
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
