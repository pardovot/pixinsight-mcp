// get_noise: multiresolution support (MRS) noise estimate per channel.

function handleGetNoise(command) {
   var view = requireView(command.parameters.viewId);
   var image = view.image;
   var pixelCount = image.width * image.height;
   var channels = [];
   try {
      for (var channel = 0; channel < measuredChannelCount(image); ++channel) {
         image.selectedChannel = channel;
         var estimate = noiseEstimate(image);
         // The sample count is the share of pixels MRS kept as noise, as a count or a fraction.
         var fraction = null;
         if (estimate.samples !== null && isFinite(estimate.samples))
            fraction = estimate.samples > 1 ? estimate.samples / pixelCount : estimate.samples;
         channels.push({
            channel: channel,
            name: shortChannelName(image, channel),
            sigma: significant(estimate.sigma),
            pixelFraction: fraction === null ? null : significant(fraction)
         });
      }
   } finally {
      image.resetSelections();
   }
   return success({ viewId: view.id, method: "MRS", channels: channels }, view.id + ": MRS noise");
}
